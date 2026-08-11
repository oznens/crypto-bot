'use strict';

const assert = require('assert');
const Risk = require('../core/risk_engine');
const Circuit = require('../core/trading_circuit_breaker');

const now = Date.now();
const state = {
  equity: 10000,
  open: [
    { symbol: 'BTC_USDT', side: 'LONG', riskUSD: 300, status: 'open' },
    { symbol: 'ETH_USDT', side: 'LONG', riskUSD: 100, status: 'open' }
  ],
  closed: Array.from({ length: 4 }, (_, i) => ({ r: -0.5, closedAt: now - i * 1000 }))
};

const decision = Risk.evaluateTrade(state, { symbol: 'SOL_USDT', side: 'LONG', riskUSD: 100 }, {
  weeklyStopR: 0,
  enforceTotalRisk: false,
  enforceDirectionalRisk: false,
  enforceCorrelation: false,
  now
});
assert.equal(decision.allowed, true);

const deeplyLosing = { ...state, closed: Array.from({ length: 6 }, (_, i) => ({ r: -1, closedAt: now - i * 1000 })) };
const circuit = Circuit.evaluate(deeplyLosing, { dailyLossEnabled: false, losingStreakEnabled: false, now });
assert.equal(circuit.blocked, false);
assert.equal(circuit.dailyLossEnabled, false);
assert.equal(circuit.dailyLossLimitR, null);
assert.equal(circuit.losingStreakEnabled, false);

console.log('yigital_risk_policy tests passed');
