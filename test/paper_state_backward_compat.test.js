'use strict';

const assert = require('assert');
const V = require('../core/paper_state_validator');

const openLegacy = {
  id: 'BTCUSDT-old', symbol: 'BTCUSDT', side: 'LONG', entry: 100, qty: 1,
  riskUSD: 10, sl: 99, tp1: 101, tpF: 103, openedAt: 1000, status: 'open'
};
const closedLegacy = {
  id: 'ETHUSDT-old', r: 1.25, riskUSD: 10, openedAt: 1000,
  closedAt: 2000, status: 'closed'
};

assert.deepEqual(V.validateTradeCollections([openLegacy], [closedLegacy]), []);
assert.ok(V.validateTradeCollections([], [{ ...closedLegacy, r: null }]).includes('CLOSED_TRADE_RESULT_INVALID'));
assert.ok(V.validateTradeCollections([{ ...openLegacy, qty: null }], []).includes('OPEN_TRADE_QTY_INVALID'));

console.log('paper_state backward compatibility tests passed');
