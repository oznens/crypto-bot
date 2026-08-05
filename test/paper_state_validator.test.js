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
  qty0: 1,
  riskUSD: 10,
  sl: 99,
  tp1: 101,
  tpF: 103,
  openedAt: NOW - 5000,
  fills: [],
  status: 'open'
};
const closedTrade = {
  id: 'ETHUSDT-1',
  resultR: 1.5,
  riskUSD: 10,
  openedAt: NOW - 5000,
  closedAt: NOW - 2000,
  mfeR: 2,
  maeR: 0.5,
  fills: [
    { t: NOW - 3000, px: 101, part: 0.5, why: 'TP1-derisk', pnl: 5 },
    { t: NOW - 2000, px: 103, part: 1, why: 'TP-final', pnl: 10 }
  ],
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
  closed: [{ ...closedTrade }],
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
assert.ok(V.validateTradeCollections([{ ...openTrade, qty: 2 }], []).includes('OPEN_TRADE_QTY_EXCEEDS_INITIAL'));
assert.ok(V.validateTradeCollections([{ ...openTrade, side: 'BUY' }], []).includes('OPEN_TRADE_SIDE_INVALID'));
assert.ok(V.validateTradeCollections([{ ...openTrade, sl: 101 }], []).includes('OPEN_TRADE_PRICE_GEOMETRY_INVALID'));
assert.ok(V.validateTradeCollections([{ ...openTrade, side: 'SHORT', sl: 99, tp1: 101, tpF: 103 }], []).includes('OPEN_TRADE_PRICE_GEOMETRY_INVALID'));
assert.ok(V.validateTradeCollections([openTrade], [{ ...closedTrade, id: openTrade.id }]).includes('DUPLICATE_TRADE_ID'));
assert.ok(V.validateTradeCollections([], [{ ...closedTrade, resultR: null }]).includes('CLOSED_TRADE_RESULT_INVALID'));
assert.ok(V.validateTradeCollections([], [{ ...closedTrade, closedAt: closedTrade.openedAt - 1 }]).includes('CLOSED_TRADE_TIME_ORDER_INVALID'));
assert.ok(V.validateTradeCollections([], [{ ...closedTrade, mfeR: -0.1 }]).includes('CLOSED_TRADE_MFE_INVALID'));
assert.ok(V.validateTradeCollections([], [{ ...closedTrade, maeR: -0.1 }]).includes('CLOSED_TRADE_MAE_INVALID'));

assert.deepEqual(V.validateFills(closedTrade, 'CLOSED'), []);
assert.ok(V.validateFills({ ...closedTrade, fills: null }, 'CLOSED').includes('CLOSED_TRADE_FILLS_NOT_ARRAY'));
assert.ok(V.validateFills({ ...closedTrade, fills: [{ t: NOW - 3000, px: 0, part: 1, why: 'SL', pnl: -10 }] }, 'CLOSED').includes('CLOSED_TRADE_FILL_PRICE_INVALID'));
assert.ok(V.validateFills({ ...closedTrade, fills: [{ t: NOW - 3000, px: 99, part: 1.1, why: 'SL', pnl: -10 }] }, 'CLOSED').includes('CLOSED_TRADE_FILL_PART_INVALID'));
assert.ok(V.validateFills({ ...closedTrade, fills: [{ t: NOW - 3000, px: 99, part: 1, why: 'SL', pnl: null }] }, 'CLOSED').includes('CLOSED_TRADE_FILL_PNL_INVALID'));
assert.ok(V.validateFills({ ...closedTrade, fills: [{ t: NOW - 3000, px: 99, part: 1, why: '', pnl: -10 }] }, 'CLOSED').includes('CLOSED_TRADE_FILL_REASON_INVALID'));
assert.ok(V.validateFills({ ...closedTrade, fills: [
  { t: NOW - 2000, px: 101, part: 0.5, why: 'TP1', pnl: 5 },
  { t: NOW - 3000, px: 103, part: 1, why: 'TP', pnl: 10 }
] }, 'CLOSED').includes('CLOSED_TRADE_FILL_TIME_ORDER_INVALID'));
assert.ok(V.validateFills({ ...closedTrade, fills: [{ t: closedTrade.openedAt - 1, px: 99, part: 1, why: 'SL', pnl: -10 }] }, 'CLOSED').includes('CLOSED_TRADE_FILL_BEFORE_OPEN'));
assert.ok(V.validateFills({ ...closedTrade, fills: [{ t: closedTrade.closedAt + 1, px: 99, part: 1, why: 'SL', pnl: -10 }] }, 'CLOSED').includes('CLOSED_TRADE_FILL_AFTER_CLOSE'));
assert.throws(() => V.assertState({ ...valid, open: null }, OPTIONS), /OPEN_NOT_ARRAY/);

console.log('paper_state_validator tests passed');
