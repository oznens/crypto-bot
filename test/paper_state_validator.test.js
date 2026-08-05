'use strict';

const assert = require('assert');
const V = require('../core/paper_state_validator');

const NOW = Date.UTC(2026, 7, 5, 10, 0, 0);
const OPTIONS = { now: NOW, futureToleranceMs: 120_000 };
const valid = {
  equity: 10000,
  open: [],
  closed: [],
  lastRun: NOW - 1000,
  health: { ok: true, status: 'HEALTHY' },
  analyticsMeta: {
    version: '5.5',
    generatedAt: NOW,
    closedTrades: 0
  }
};

const openTrade = {
  id: 'BTCUSDT-1',
  symbol: 'BTCUSDT',
  side: 'LONG',
  entry: 100,
  qty: 1,
  riskUSD: 10,
  openedAt: NOW - 5000,
  status: 'open'
};
const closedTrade = {
  id: 'ETHUSDT-1',
  resultR: 1.5,
  closedAt: NOW - 2000,
  status: 'closed'
};

assert.equal(V.validateState(valid, OPTIONS).ok, true);
assert.deepEqual(V.validateState(null, OPTIONS).issues, ['STATE_NOT_OBJECT']);
assert.ok(V.validateState({ ...valid, equity: 0 }, OPTIONS).issues.includes('INVALID_EQUITY'));
assert.ok(V.validateState({ ...valid, health: { ok: false, status: 'DEGRADED' } }, OPTIONS).issues.includes('HEALTH_NOT_OK'));
assert.ok(V.validateState({ ...valid, analyticsMeta: { ...valid.analyticsMeta, version: '4.9' } }, OPTIONS).issues.includes('ANALYTICS_VERSION_INVALID'));
assert.ok(V.validateState({ ...valid, analyticsMeta: { ...valid.analyticsMeta, closedTrades: -1 } }, OPTIONS).issues.includes('ANALYTICS_CLOSED_COUNT_INVALID'));
assert.ok(V.validateState({
  ...valid,
  closed: [{ resultR: 1 }],
  analyticsMeta: { ...valid.analyticsMeta, closedTrades: 0 }
}, OPTIONS).issues.includes('ANALYTICS_CLOSED_COUNT_MISMATCH'));
assert.ok(V.validateState({
  ...valid,
  lastRun: NOW,
  analyticsMeta: { ...valid.analyticsMeta, generatedAt: NOW - 1 }
}, OPTIONS).issues.includes('ANALYTICS_BEHIND_STATE'));
assert.ok(V.validateState({ ...valid, lastRun: NOW + 120_001 }, OPTIONS).issues.includes('LAST_RUN_IN_FUTURE'));
assert.ok(V.validateState({
  ...valid,
  analyticsMeta: { ...valid.analyticsMeta, generatedAt: NOW + 120_001 }
}, OPTIONS).issues.includes('ANALYTICS_TIME_IN_FUTURE'));
assert.equal(V.validateState({
  ...valid,
  lastRun: NOW + 120_000,
  analyticsMeta: { ...valid.analyticsMeta, generatedAt: NOW + 120_000 }
}, OPTIONS).ok, true);

assert.deepEqual(V.validateTradeCollections([openTrade], [closedTrade]), []);
assert.ok(V.validateTradeCollections([{ ...openTrade, entry: 0 }], []).includes('OPEN_TRADE_ENTRY_INVALID'));
assert.ok(V.validateTradeCollections([{ ...openTrade, qty: 0 }], []).includes('OPEN_TRADE_QTY_INVALID'));
assert.ok(V.validateTradeCollections([{ ...openTrade, side: 'BUY' }], []).includes('OPEN_TRADE_SIDE_INVALID'));
assert.ok(V.validateTradeCollections([openTrade], [{ ...closedTrade, id: openTrade.id }]).includes('DUPLICATE_TRADE_ID'));
assert.ok(V.validateTradeCollections([], [{ ...closedTrade, resultR: null }]).includes('CLOSED_TRADE_RESULT_INVALID'));
assert.throws(() => V.assertState({ ...valid, open: null }, OPTIONS), /OPEN_NOT_ARRAY/);

console.log('paper_state_validator tests passed');
