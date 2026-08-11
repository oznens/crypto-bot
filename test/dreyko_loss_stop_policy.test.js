'use strict';

const assert = require('assert');
const Risk = require('../core/risk_engine');
const Circuit = require('../core/trading_circuit_breaker');

const now = Date.now();
const closed = Array.from({ length: 6 }, (_, i) => ({ r: -1, closedAt: now - i * 1000 }));
const state = { equity: 10000, open: [], closed };

const risk = Risk.evaluateTrade(state, { symbol: 'BTC_USDT', side: 'LONG', riskUSD: 100 }, {
  maxTotalRiskPct: 0.04,
  maxDirectionalRiskPct: 0.03,
  maxCorrelatedTrades: 2,
  weeklyStopR: 0,
  now
});
assert.equal(risk.allowed, true);

const circuit = Circuit.evaluate(state, {
  dailyLossEnabled: false,
  maxLosingStreak: 4,
  cooldownMs: 6 * 3600000,
  now
});
assert.equal(circuit.reason, 'LOSING_STREAK_LIMIT');
assert.equal(circuit.dailyLossEnabled, false);
assert.equal(circuit.dailyLossLimitR, null);

console.log('dreyko_loss_stop_policy tests passed');
