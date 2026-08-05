'use strict';

const fs = require('fs');
const path = require('path');
const Analysis = require('../analysis');
const TradePolicy = require('../core/paper_trade_policy');
const Ensemble = require('../core/strategy_ensemble');
const { detect: detectRegime } = require('../core/regime_detector');
const { createExecutionAdapter } = require('../core/strategy_execution_adapter');

const statePath = process.env.PAPER_STATE
  ? path.resolve(process.env.PAPER_STATE)
  : path.join(__dirname, '..', 'paper_state.json');
const docsPath = path.join(__dirname, '..', 'docs', 'paper_state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (_) { return {}; }
}

function writeState(state) {
  const serialized = JSON.stringify(state, null, 1);
  fs.writeFileSync(statePath, serialized);
  if (!process.env.PAPER_STATE) {
    fs.mkdirSync(path.dirname(docsPath), { recursive: true });
    fs.writeFileSync(docsPath, serialized);
  }
}

const initialState = readState();
const execution = createExecutionAdapter({
  allocation: initialState.strategyAllocation || null,
  calculatePosition: TradePolicy.calculatePosition
});
const telemetry = {
  version: '26.0', evaluated: 0, accepted: 0, rejected: 0,
  long: 0, short: 0, conflictRejected: 0, portfolioBlocked: 0,
  portfolioReduced: 0, lastDecision: null
};

const originalAnalyze = Analysis.analyze;
Analysis.analyze = function ensembleAnalyze(candles, options) {
  const result = originalAnalyze.call(this, candles, options);
  const candidates = Ensemble.candidatesFromAnalysis(result);
  const decision = Ensemble.evaluate(candidates, {
    regime: detectRegime(candles),
    minConsensus: Number(process.env.PAPER_ENSEMBLE_MIN_CONSENSUS || 0.58),
    minScore: Number(process.env.PAPER_ENSEMBLE_MIN_SCORE || 55)
  });

  telemetry.evaluated++;
  telemetry.lastDecision = {
    decision: decision.decision,
    winnerModel: decision.winnerModel,
    consensus: decision.consensus,
    reason: decision.reason
  };

  if (!result?.setup) {
    execution.setModel('UNKNOWN');
    execution.setRiskMultiplier(1);
    return { ...result, ensemble: decision };
  }

  const portfolioMultiplier = Number.isFinite(Number(result.setup.portfolioRiskMultiplier))
    ? Number(result.setup.portfolioRiskMultiplier)
    : 1;
  execution.setRiskMultiplier(portfolioMultiplier);
  if (portfolioMultiplier <= 0) telemetry.portfolioBlocked++;
  else if (portfolioMultiplier < 1) telemetry.portfolioReduced++;

  if (!decision.accepted || decision.decision !== result.setup.side || portfolioMultiplier <= 0) {
    telemetry.rejected++;
    if (decision.conflictPenalty > 0.35) telemetry.conflictRejected++;
    execution.setModel(decision.winnerModel || result.setup.model || 'UNKNOWN');
    return {
      ...result,
      setup: null,
      rejectedSetup: result.setup,
      ensemble: decision,
      portfolioReason: portfolioMultiplier <= 0 ? 'CORRELATION_EXPOSURE_LIMIT' : null
    };
  }

  telemetry.accepted++;
  if (decision.decision === 'LONG') telemetry.long++;
  if (decision.decision === 'SHORT') telemetry.short++;
  const model = decision.winnerModel || result.setup.model || 'UNKNOWN';
  execution.setModel(model);
  return {
    ...result,
    setup: {
      ...result.setup,
      model,
      confidence: Math.round((Number(result.setup.confidence) + decision.blendedConfidence) / 2),
      ensemble: decision
    },
    ensemble: decision
  };
};

TradePolicy.calculatePosition = function ensembleAwarePosition(args) {
  return execution.calculate(args);
};

let persisted = false;
function persist() {
  if (persisted) return;
  persisted = true;
  const state = readState();
  state.strategyExecution = execution.snapshot();
  state.strategyEnsemble = { ...telemetry, generatedAt: Date.now() };
  writeState(state);
}
process.once('beforeExit', persist);
process.once('exit', persist);

require('../paper_engine');
