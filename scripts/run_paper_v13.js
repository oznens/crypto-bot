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

const statePath = process.env.PAPER_STATE
  ? path.resolve(process.env.PAPER_STATE)
  : path.join(__dirname, '..', 'paper_state.json');
const docsPath = path.join(__dirname, '..', 'docs', 'paper_state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (_) { return {}; }
}

const initialState = readState();
const circuitDecision = CircuitBreaker.evaluate(initialState, {
  dailyLossLimitR: Number(process.env.PAPER_DAILY_LOSS_LIMIT_R || 3),
  maxLosingStreak: Number(process.env.PAPER_MAX_LOSING_STREAK || 4),
  cooldownMs: Number(process.env.PAPER_COOLDOWN_MS || 21600000)
});
const telemetry = {
  version: '33.0', generatedAt: null,
  contextEvaluated: 0, contextAccepted: 0, contextRejected: 0,
  dataQualityEvaluated: 0, dataQualityRejected: 0,
  circuitBlocked: circuitDecision.blocked,
  killzoneConfirmed: 0, smtConfirmed: 0, liquidityTargets: 0,
  correlationEvaluated: 0, correlationBlocked: 0, correlationReduced: 0,
  adaptiveEvaluated: 0, adaptiveChanged: 0,
  lastDataQuality: null, lastContext: null, lastCorrelation: null, lastExit: null
};

const originalAnalyze = Analysis.analyze;
Analysis.analyze = function v33Analyze(candles, options = {}) {
  const quality = DataQuality.evaluate(candles, {
    minBars: Number(process.env.PAPER_MIN_QUALITY_BARS || 50),
    maxGapMultiplier: Number(process.env.PAPER_MAX_GAP_MULTIPLIER || 2.5)
  });
  telemetry.dataQualityEvaluated++;
  telemetry.lastDataQuality = { symbol: options.symbol || 'UNKNOWN', interval: options.interval || null, ...quality };
  if (!quality.valid) {
    telemetry.dataQualityRejected++;
    return {
      candles,
      setup: null,
      dataQuality: quality,
      rejectedReason: quality.reason
    };
  }

  const raw = originalAnalyze.call(this, candles, options);
  let result = Context.enhance(raw, { peerCandles: options.peerCandles });
  if (raw?.setup) {
    telemetry.contextEvaluated++;
    if (result?.setup) telemetry.contextAccepted++; else telemetry.contextRejected++;
    if (result?.strategyContext?.killzone?.valid) telemetry.killzoneConfirmed++;
    if (result?.strategyContext?.smt?.confirmed) telemetry.smtConfirmed++;
    if (result?.strategyContext?.liquidity?.valid) telemetry.liquidityTargets++;
    telemetry.lastContext = result?.strategyContext || null;
  }

  if (result?.setup) {
    const symbol = options.symbol || result.setup.symbol || raw?.symbol || 'UNKNOWN';
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
        portfolioRiskMultiplier,
        portfolioCorrelation: correlation,
        circuitBreaker: circuitDecision
      },
      portfolioCorrelation: correlation,
      circuitBreaker: circuitDecision
    };
  }
  return result;
};

const originalExcursion = TradePolicy.applyExcursion;
TradePolicy.applyExcursion = function v33Excursion(trade, candle, options) {
  const base = originalExcursion(trade, candle, options);
  telemetry.adaptiveEvaluated++;
  const decision = AdaptiveExit.apply(trade, candle, { regime: trade.regime });
  if (decision.action !== 'HOLD') telemetry.adaptiveChanged++;
  telemetry.lastExit = { tradeId: trade.id, action: decision.action, reason: decision.reason, stop: trade.sl };
  return { ...base, adaptiveExit: decision };
};

function persist() {
  const state = readState();
  telemetry.generatedAt = Date.now();
  state.strategyContextExecution = telemetry;
  CircuitBreaker.apply(state, circuitDecision, telemetry.generatedAt);
  const serialized = JSON.stringify(state, null, 1);
  fs.writeFileSync(statePath, serialized);
  if (!process.env.PAPER_STATE) {
    fs.mkdirSync(path.dirname(docsPath), { recursive: true });
    fs.writeFileSync(docsPath, serialized);
  }
}

process.once('exit', persist);
require('./run_paper_v9');
