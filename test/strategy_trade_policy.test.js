'use strict';

const assert = require('assert');
const Policy = require('../core/strategy_trade_policy');

const allocation = {
  version: '7.0',
  allocations: [
    { model: 'ACTIVE_MODEL', status: 'ACTIVE', riskMultiplier: 1.2, score: 82, portfolioWeightPct: 60 },
    { model: 'WATCH_MODEL', status: 'WATCH', riskMultiplier: 0.5, score: 44, portfolioWeightPct: 0 },
    { model: 'PAUSED_MODEL', status: 'PAUSED', riskMultiplier: 0, score: 20, reason: 'negatif beklenti' },
    { model: 'TOO_HIGH', status: 'ACTIVE', riskMultiplier: 3 },
    { model: 'TOO_LOW', status: 'WATCH', riskMultiplier: 0.01 }
  ]
};

const active = Policy.decide(allocation, 'ACTIVE_MODEL');
assert.equal(active.allowed, true);
assert.equal(active.status, 'ACTIVE');
assert.equal(active.multiplier, 1.2);
assert.equal(active.score, 82);
assert.equal(active.portfolioWeightPct, 60);
assert.equal(Policy.adjustedRiskPct(0.01, active), 0.012);

const watch = Policy.decide(allocation, 'WATCH_MODEL');
assert.equal(watch.allowed, true);
assert.equal(watch.status, 'WATCH');
assert.equal(watch.multiplier, 0.5);
assert.equal(Policy.adjustedRiskPct(0.01, watch), 0.005);

const paused = Policy.decide(allocation, 'PAUSED_MODEL');
assert.equal(paused.allowed, false);
assert.equal(paused.multiplier, 0);
assert.equal(Policy.adjustedRiskPct(0.01, paused), 0);

const unknown = Policy.decide(allocation, 'UNKNOWN_MODEL');
assert.equal(unknown.allowed, true);
assert.equal(unknown.status, 'UNRANKED');
assert.equal(unknown.multiplier, 0.5);

assert.equal(Policy.decide(null, 'ANY').multiplier, 0.5);
assert.equal(Policy.decide(allocation, 'TOO_HIGH').multiplier, 1.25);
assert.equal(Policy.decide(allocation, 'TOO_LOW').multiplier, 0.25);
assert.equal(Policy.adjustedRiskPct(null, active), 0);
assert.equal(Policy.allocationRow(allocation, 'MISSING'), null);

console.log('strategy_trade_policy tests passed');
