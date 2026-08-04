'use strict';
const assert = require('assert');
const Risk = require('../core/risk_engine');

assert.strictEqual(Risk.baseAsset('BTC_USDT'), 'BTC');
assert.deepStrictEqual(Risk.groupsFor('SOLUSDT').sort(), ['BTC_BETA', 'L1']);

const now = Date.now();
const baseState = {
  equity: 10000,
  open: [
    { symbol: 'BTC_USDT', side: 'LONG', riskUSD: 100, deriskDone: false },
    { symbol: 'ETH_USDT', side: 'LONG', riskUSD: 100, deriskDone: true }
  ],
  closed: [{ closedAt: now - 1000, r: -1 }]
};

assert.strictEqual(Risk.openRiskUSD(baseState.open), 100);
assert.strictEqual(Risk.openRiskUSD(baseState.open, 'LONG'), 100);
assert.strictEqual(Risk.weeklyR(baseState.closed, now), -1);

let result = Risk.evaluateTrade(baseState, { symbol: 'SOL_USDT', side: 'LONG', riskUSD: 100 }, { now });
assert.strictEqual(result.allowed, true);

result = Risk.evaluateTrade({ ...baseState, closed: [{ closedAt: now - 1000, r: -5 }] }, { symbol: 'SOL_USDT', side: 'LONG', riskUSD: 100 }, { now });
assert.strictEqual(result.reason, 'WEEKLY_LOSS_LIMIT');

result = Risk.evaluateTrade({ equity: 10000, open: [
  { symbol: 'BTC_USDT', side: 'LONG', riskUSD: 100, deriskDone: false },
  { symbol: 'ETH_USDT', side: 'LONG', riskUSD: 100, deriskDone: false }
], closed: [] }, { symbol: 'SOL_USDT', side: 'LONG', riskUSD: 100 }, { now, maxCorrelatedTrades: 2 });
assert.strictEqual(result.reason, 'MAX_CORRELATED_TRADES');

result = Risk.evaluateTrade({ equity: 10000, open: [
  { symbol: 'XRP_USDT', side: 'LONG', riskUSD: 250, deriskDone: false }
], closed: [] }, { symbol: 'ADA_USDT', side: 'LONG', riskUSD: 100 }, { now, maxDirectionalRiskPct: 0.03 });
assert.strictEqual(result.reason, 'MAX_DIRECTIONAL_RISK');

console.log('risk_engine tests passed');
