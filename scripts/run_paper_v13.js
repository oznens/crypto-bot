'use strict';

const fs = require('fs');
const path = require('path');
const Analysis = require('../analysis');
const TradePolicy = require('../core/paper_trade_policy');
const Context = require('../core/strategy_context_pipeline');
const AdaptiveExit = require('../core/adaptive_exit_engine');

const statePath = process.env.PAPER_STATE
  ? path.resolve(process.env.PAPER_STATE)
  : path.join(__dirname, '..', 'paper_state.json');
const docsPath = path.join(__dirname, '..', 'docs', 'paper_state.json');

const telemetry = {
  version: '13.0', generatedAt: null,
  contextEvaluated: 0, contextAccepted: 0, contextRejected: 0,
  killzoneConfirmed: 0, smtConfirmed: 0, liquidityTargets: 0,
  adaptiveEvaluated: 0, adaptiveChanged: 0,
  lastContext: null, lastExit: null
};

const originalAnalyze = Analysis.analyze;
Analysis.analyze = function v13Analyze(...args) {
  const raw = originalAnalyze.apply(this, args);
  const result = Context.enhance(raw, { peerCandles: args[1]?.peerCandles });
  if (raw?.setup) {
    telemetry.contextEvaluated++;
    if (result?.setup) telemetry.contextAccepted++; else telemetry.contextRejected++;
    if (result?.strategyContext?.killzone?.valid) telemetry.killzoneConfirmed++;
    if (result?.strategyContext?.smt?.confirmed) telemetry.smtConfirmed++;
    if (result?.strategyContext?.liquidity?.valid) telemetry.liquidityTargets++;
    telemetry.lastContext = result?.strategyContext || null;
  }
  return result;
};

const originalExcursion = TradePolicy.applyExcursion;
TradePolicy.applyExcursion = function v13Excursion(trade, candle, options) {
  const base = originalExcursion(trade, candle, options);
  telemetry.adaptiveEvaluated++;
  const decision = AdaptiveExit.apply(trade, candle, { regime: trade.regime });
  if (decision.action !== 'HOLD') telemetry.adaptiveChanged++;
  telemetry.lastExit = { tradeId: trade.id, action: decision.action, reason: decision.reason, stop: trade.sl };
  return { ...base, adaptiveExit: decision };
};

function persist() {
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (_) { return; }
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
