'use strict';

const assert = require('assert');
const { createExecutionAdapter } = require('../core/strategy_execution_adapter');

function baseCalculate(args) {
  const riskDist = Math.abs(args.entry - args.stop);
  const plannedRiskUSD = args.equity * args.riskPct;
  return {
    valid: true,
    qty: plannedRiskUSD / riskDist,
    plannedRiskUSD,
    actualRiskUSD: plannedRiskUSD,
    riskDist
  };
}

const allocation = {
  version: '24.0',
  allocations: [
    { model: 'ACTIVE', status: 'ACTIVE', riskMultiplier: 1.2, score: 80 },
    { model: 'WATCH', status: 'WATCH', riskMultiplier: 0.5, score: 40 },
    { model: 'PAUSED', status: 'PAUSED', riskMultiplier: 0, score: 10 }
  ]
};

const adapter = createExecutionAdapter({ allocation, calculatePosition: baseCalculate });

adapter.setModel('ACTIVE');
const active = adapter.calculate({ equity: 10000, riskPct: 0.01, entry: 100, stop: 99 });
assert.equal(active.valid, true);
assert.equal(active.adjustedRiskPct, 0.012);
assert.equal(active.plannedRiskUSD, 120);
assert.equal(active.strategyDecision.status, 'ACTIVE');

adapter.setModel('WATCH');
adapter.setRiskMultiplier(0.5);
const watch = adapter.calculate({ equity: 10000, riskPct: 0.01, entry: 100, stop: 99 });
assert.equal(watch.adjustedRiskPct, 0.0025);
assert.equal(watch.plannedRiskUSD, 25);
assert.equal(watch.contextRiskMultiplier, 0.5);

adapter.setModel('PAUSED');
const paused = adapter.calculate({ equity: 10000, riskPct: 0.01, entry: 100, stop: 99 });
assert.equal(paused.valid, false);
assert.equal(paused.reason, 'STRATEGY_PAUSED');
assert.equal(paused.actualRiskUSD, 0);

adapter.setModel('UNKNOWN');
adapter.setRiskMultiplier(0);
const blocked = adapter.calculate({ equity: 10000, riskPct: 0.01, entry: 100, stop: 99 });
assert.equal(blocked.valid, false);
assert.equal(blocked.reason, 'PORTFOLIO_CONTEXT_BLOCKED');

adapter.setModel('UNKNOWN');
const unknown = adapter.calculate({ equity: 10000, riskPct: 0.01, entry: 100, stop: 99 });
assert.equal(unknown.adjustedRiskPct, 0.005);

const snapshot = adapter.snapshot(12345);
assert.equal(snapshot.version, '26.0');
assert.equal(snapshot.generatedAt, 12345);
assert.equal(snapshot.evaluated, 5);
assert.equal(snapshot.allowed, 3);
assert.equal(snapshot.paused, 2);
assert.equal(snapshot.active, 1);
assert.equal(snapshot.watch, 1);
assert.equal(snapshot.unranked, 1);
assert.ok(snapshot.reducedRisk >= 2);
assert.equal(snapshot.contextReducedRisk, 1);
assert.equal(snapshot.lastDecision.model, 'UNKNOWN');

assert.throws(() => createExecutionAdapter(), /calculatePosition/);
console.log('strategy_execution_adapter tests passed');
