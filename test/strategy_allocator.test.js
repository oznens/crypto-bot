'use strict';

const assert = require('assert');
const A = require('../core/strategy_allocator');

function trades(model, values, offset = 0) {
  return values.map((resultR, i) => ({ model, resultR, closedAt: offset + 1000 + i }));
}

const decaying = [
  ...trades('DECAY', Array(30).fill(0.4), 0),
  ...trades('DECAY', Array(20).fill(-0.4), 100)
];
const rows = [
  ...trades('STRONG', Array(30).fill(0).map((_, i) => i % 3 === 0 ? -0.5 : 1)),
  ...trades('WEAK', Array(30).fill(-0.25)),
  ...trades('NEW', [1, -0.5, 0.2]),
  ...decaying
];
const result = A.buildAllocation(rows, { minTrades: 20, now: 123 });
const strong = result.allocations.find(x => x.model === 'STRONG');
const weak = result.allocations.find(x => x.model === 'WEAK');
const fresh = result.allocations.find(x => x.model === 'NEW');
const decay = result.allocations.find(x => x.model === 'DECAY');

assert.equal(result.version, '16.0');
assert.equal(result.generatedAt, 123);
assert.equal(strong.status, 'ACTIVE');
assert.ok(strong.riskMultiplier >= 0.7 && strong.riskMultiplier <= 1.25);
assert.ok(strong.portfolioWeightPct > 0);
assert.equal(weak.status, 'PAUSED');
assert.equal(weak.riskMultiplier, 0);
assert.equal(fresh.status, 'WATCH');
assert.equal(fresh.riskMultiplier, 0.5);
assert.equal(decay.decay.status, 'DECAY_SEVERE');
assert.equal(decay.status, 'PAUSED');
assert.equal(A.multiplierFor(result, 'MISSING'), 0.5);
assert.ok(Math.abs(result.allocations.reduce((s, x) => s + x.portfolioWeightPct, 0) - 100) < 0.1);

console.log('strategy_allocator tests passed');
