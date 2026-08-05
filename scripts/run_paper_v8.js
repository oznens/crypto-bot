'use strict';

const fs = require('fs');
const path = require('path');
const Analysis = require('../analysis');
const TradePolicy = require('../core/paper_trade_policy');
const { createExecutionAdapter } = require('../core/strategy_execution_adapter');

const statePath = process.env.PAPER_STATE
  ? path.resolve(process.env.PAPER_STATE)
  : path.join(__dirname, '..', 'paper_state.json');
const docsPath = path.join(__dirname, '..', 'docs', 'paper_state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (_) { return {}; }
}

function writeTelemetry(snapshot) {
  const state = readState();
  state.strategyExecution = snapshot;
  const serialized = JSON.stringify(state, null, 1);
  fs.writeFileSync(statePath, serialized);
  if (!process.env.PAPER_STATE) {
    fs.mkdirSync(path.dirname(docsPath), { recursive: true });
    fs.writeFileSync(docsPath, serialized);
  }
}

const initialState = readState();
const adapter = createExecutionAdapter({
  allocation: initialState.strategyAllocation || null,
  calculatePosition: TradePolicy.calculatePosition
});

const originalAnalyze = Analysis.analyze;
Analysis.analyze = function patchedAnalyze(...args) {
  const result = originalAnalyze.apply(this, args);
  adapter.setModel(result?.setup?.model || 'UNKNOWN');
  return result;
};

TradePolicy.calculatePosition = function strategyAwareCalculate(args) {
  return adapter.calculate(args);
};

let persisted = false;
function persist() {
  if (persisted) return;
  persisted = true;
  writeTelemetry(adapter.snapshot());
}

process.once('beforeExit', persist);
process.once('exit', persist);

require('../paper_engine');
