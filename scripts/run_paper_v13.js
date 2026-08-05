'use strict';

const fs = require('fs');
const path = require('path');
const Analysis = require('../analysis');
const TradePolicy = require('../core/paper_trade_policy');
const Context = require('../core/strategy_context_pipeline');
const AdaptiveExit = require('../core/adaptive_exit_engine');
const PortfolioCorrelation = require('../core/portfolio_correlation_engine');

const statePath = process.env.PAPER_STATE
  ? path.resolve(process.env.PAPER_STATE)
  : path.join(__dirname, '..', 'paper_state.json');
const docsPath = path.join(__dirname, '..', 'docs', 'paper_state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (_) { return {}; }
}

const initialState = readState();
const telemetry = {
  version: '26.0', generatedAt: null,
  contextEvaluated: 0, contextAccepted: 0, contextRejected: 0,
  killzoneConfirmed: 0, smtConfirmed: 0, liquidityTargets: 0,
  correlationEvaluated: 0, correlationBlocked: 0, correlationReduced: 0,
  adaptiveEvaluated: 0, adaptiveChanged: 0,
  lastContext: null, lastCorrelation: null, lastExit: null
};

const originalAnalyze = Analysis.analyze;
Analysis.analyze = function v26Analyze(...args) {
  const raw = originalAnalyze.apply(this, args);
  let result = Context.enhance(raw, { peerCandles: args[1]?.peerCandles });
  if (raw?.setup) {
    telemetry.contextEvaluated++;
    if (result?.setup) telemetry.contextAccepted++; else telemetry.contextRejected++;
    if (result?.strategyContext?.killzone?.valid) telemetry.killzoneConfirmed++;
    if (result?.strategyContext?.smt?.confirmed) telemetry.smtConfirmed++;
    if (result?.strategyContext?.liquidity?.valid) telemetry.liquidityTargets++;
    telemetry.lastContext = result?.strategyContext || null;
  }

  if (result?.setup) {
    const symbol = args[1]?.symbol || result.setup.symbol || raw?.symbol || 'UNKNOWN';
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
    result = {
      ...result,
      setup: {
        ...result.setup,
        portfolioRiskMultiplier: correlation.riskMultiplier,
        portfolioCorrelation: correlation
      },
      portfolioCorrelation: correlation
    };
  }
  return result;
};

const originalExcursion = TradePolicy.applyExcursion;
TradePolicy.applyExcursion = function v26Excursion(trade, candle, options) {
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
  const serialized = JSON.stringify(state, null, 1);
  fs.writeFileSync(statePath, serialized);
  if (!process.env.PAPER_STATE) {
    fs.mkdirSync(path.dirname(docsPath), { recursive: true });
    fs.writeFileSync(docsPath, serialized);
  }
}

process.once('exit', persist);
require('./run_paper_v9');
