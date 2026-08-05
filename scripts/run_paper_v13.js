'use strict';

const fs = require('fs');
const path = require('path');
const Analysis = require('../analysis');
const TradePolicy = require('../core/paper_trade_policy');
const Context = require('../core/strategy_context_pipeline');
const AdaptiveExit = require('../core/adaptive_exit_engine');
const PortfolioCorrelation = require('../core/portfolio_correlation_engine');
const DataQuality = require('../core/market_data_quality_engine');
const CircuitBreaker = require('../core/trading_circuit_breaker');
const SetupJournal = require('../core/setup_journal');

const statePath = process.env.PAPER_STATE
  ? path.resolve(process.env.PAPER_STATE)
  : path.join(__dirname, '..', 'paper_state.json');
const docsPath = path.join(__dirname, '..', 'docs', 'paper_state.json');
const journalPath = path.join(__dirname, '..', 'docs', 'setup_journal.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (_) { return {}; }
}

function normalizeSymbol(value) {
  return String(value || 'UNKNOWN').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function snapshot(candles) {
  return {
    candles: (candles || []).slice(-132).map(c => [
      Math.round(Number(c.t) / 1000), Number(c.o), Number(c.h), Number(c.l), Number(c.c)
    ])
  };
}

const initialState = readState();
const setupJournal = Array.isArray(initialState.setupJournal) ? initialState.setupJournal : [];
const circuitDecision = CircuitBreaker.evaluate(initialState, {
  dailyLossLimitR: Number(process.env.PAPER_DAILY_LOSS_LIMIT_R || 3),
  maxLosingStreak: Number(process.env.PAPER_MAX_LOSING_STREAK || 4),
  cooldownMs: Number(process.env.PAPER_COOLDOWN_MS || 21600000)
});
const telemetry = {
  version: '34.0', generatedAt: null,
  contextEvaluated: 0, contextAccepted: 0, contextRejected: 0,
  dataQualityEvaluated: 0, dataQualityRejected: 0,
  circuitBlocked: circuitDecision.blocked,
  killzoneConfirmed: 0, smtConfirmed: 0, liquidityTargets: 0,
  correlationEvaluated: 0, correlationBlocked: 0, correlationReduced: 0,
  adaptiveEvaluated: 0, adaptiveChanged: 0,
  journalRecorded: 0,
  lastDataQuality: null, lastContext: null, lastCorrelation: null, lastExit: null, lastJournal: null
};

function recordCandidate(input) {
  const row = SetupJournal.upsert(setupJournal, input, { limit: 1000 });
  telemetry.journalRecorded++;
  telemetry.lastJournal = {
    id: row.id,
    symbol: row.symbol,
    tf: row.tf,
    status: row.status,
    reason: row.reason
  };
  return row;
}

const originalAnalyze = Analysis.analyze;
Analysis.analyze = function v34Analyze(candles, options = {}) {
  const symbol = normalizeSymbol(options.symbol);
  const timeframe = options.interval || null;
  const anchor = candles?.length ? Number(candles[candles.length - 1].t) : Date.now();
  const quality = DataQuality.evaluate(candles, {
    minBars: Number(process.env.PAPER_MIN_QUALITY_BARS || 50),
    maxGapMultiplier: Number(process.env.PAPER_MAX_GAP_MULTIPLIER || 2.5)
  });
  telemetry.dataQualityEvaluated++;
  telemetry.lastDataQuality = { symbol, interval: timeframe, ...quality };
  if (!quality.valid) {
    telemetry.dataQualityRejected++;
    recordCandidate({
      symbol, tf: timeframe, model: 'DATA_QUALITY', anchor,
      status: 'REJECTED', decision: 'NO_TRADE', reason: quality.reason,
      context: { version:'34.0', accepted:false, reason:quality.reason, dataQuality:quality },
      marketPrice: candles?.at(-1)?.c,
      snapshot: snapshot(candles)
    });
    return { candles, setup: null, dataQuality: quality, rejectedReason: quality.reason };
  }

  const raw = originalAnalyze.call(this, candles, options);
  let result = Context.enhance(raw, { peerCandles: options.peerCandles });
  let journalRow = null;
  if (raw?.setup) {
    telemetry.contextEvaluated++;
    if (result?.setup) telemetry.contextAccepted++; else telemetry.contextRejected++;
    if (result?.strategyContext?.killzone?.valid) telemetry.killzoneConfirmed++;
    if (result?.strategyContext?.smt?.confirmed) telemetry.smtConfirmed++;
    if (result?.strategyContext?.liquidity?.valid) telemetry.liquidityTargets++;
    telemetry.lastContext = result?.strategyContext || null;

    journalRow = recordCandidate({
      symbol, tf: timeframe, lowerTf: options.ltf?.interval || null,
      model: raw.setup.model || 'UNKNOWN', anchor,
      status: result?.setup ? 'WATCHING' : 'REJECTED',
      decision: result?.setup ? 'SETUP_ACCEPTED' : 'NO_TRADE',
      reason: result?.setup ? 'EXECUTION_CONFIRMATION_PENDING' : (result?.strategyContext?.reason || raw.rejectedReason || 'CONTEXT_REJECTED'),
      setup: result?.setup || raw.setup,
      context: result?.strategyContext || null,
      marketPrice: raw.lastPrice || candles?.at(-1)?.c,
      snapshot: snapshot(candles)
    });
  }

  if (result?.setup) {
    const correlation = PortfolioCorrelation.evaluate(
      initialState.open || [],
      symbol,
      result.setup.side,
      {
        maxSameGroup: Number(process.env.PAPER_MAX_SAME_GROUP || 1),
        maxRelated: Number(process.env.PAPER_MAX_RELATED_GROUP || 3)
      }
    );
    telemetry.correlationEvaluated++;
    if (!correlation.valid) telemetry.correlationBlocked++;
    else if (correlation.riskMultiplier < 1) telemetry.correlationReduced++;
    telemetry.lastCorrelation = { symbol, side: result.setup.side, ...correlation };
    const portfolioRiskMultiplier = circuitDecision.blocked ? 0 : correlation.riskMultiplier;
    result = {
      ...result,
      setup: {
        ...result.setup,
        setupJournalId: journalRow?.id || null,
        portfolioRiskMultiplier,
        portfolioCorrelation: correlation,
        circuitBreaker: circuitDecision
      },
      portfolioCorrelation: correlation,
      circuitBreaker: circuitDecision
    };

    if (journalRow) {
      const blocked = circuitDecision.blocked || !correlation.valid || portfolioRiskMultiplier <= 0;
      SetupJournal.upsert(setupJournal, {
        id: journalRow.id,
        symbol, tf: timeframe, anchor,
        status: blocked ? 'REJECTED' : 'WATCHING',
        decision: blocked ? 'NO_TRADE' : 'EXECUTION_PENDING',
        reason: circuitDecision.blocked ? circuitDecision.reason : !correlation.valid ? correlation.reason : 'RISK_AND_ENTRY_CHECK_PENDING',
        setup: result.setup,
        context: { ...(result.strategyContext || {}), dataQuality:quality },
        marketPrice: result.lastPrice || candles?.at(-1)?.c,
        snapshot: journalRow.snapshot
      }, { limit:1000 });
    }
  }
  return result;
};

const originalExcursion = TradePolicy.applyExcursion;
TradePolicy.applyExcursion = function v34Excursion(trade, candle, options) {
  const base = originalExcursion(trade, candle, options);
  telemetry.adaptiveEvaluated++;
  const decision = AdaptiveExit.apply(trade, candle, { regime: trade.regime });
  if (decision.action !== 'HOLD') telemetry.adaptiveChanged++;
  telemetry.lastExit = { tradeId: trade.id, action: decision.action, reason: decision.reason, stop: trade.sl };
  return { ...base, adaptiveExit: decision };
};

function matchJournal(trade) {
  const symbol = normalizeSymbol(trade.symbol);
  const candidates = setupJournal.filter(row =>
    normalizeSymbol(row.symbol) === symbol &&
    String(row.tf || '') === String(trade.tf || '') &&
    (!row.setup?.model || !trade.model || row.setup.model === trade.model) &&
    Number(row.firstSeenAt || 0) <= Number(trade.openedAt || Date.now())
  );
  return candidates.sort((a,b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))[0] || null;
}

function persist() {
  const state = readState();
  telemetry.generatedAt = Date.now();

  for (const trade of [...(state.open || []), ...(state.closed || [])]) {
    const row = matchJournal(trade);
    const journalId = row?.id || SetupJournal.makeId({
      symbol: normalizeSymbol(trade.symbol), tf:trade.tf, model:trade.model, anchor:trade.openedAt
    });
    SetupJournal.linkTrade(setupJournal, journalId, trade);
  }

  state.setupJournal = setupJournal;
  state.setupJournalSummary = SetupJournal.summary(setupJournal);
  state.strategyContextExecution = telemetry;
  CircuitBreaker.apply(state, circuitDecision, telemetry.generatedAt);
  const serialized = JSON.stringify(state, null, 1);
  fs.writeFileSync(statePath, serialized);
  if (!process.env.PAPER_STATE) {
    fs.mkdirSync(path.dirname(docsPath), { recursive: true });
    fs.writeFileSync(docsPath, serialized);
    fs.writeFileSync(journalPath, JSON.stringify({
      version:'34.0', generatedAt:telemetry.generatedAt,
      summary:state.setupJournalSummary,
      setups:setupJournal
    }, null, 1));
  }
}

process.once('exit', persist);
require('./run_paper_v9');
