'use strict';

// Paper ve live-exact backtest için TEK ortak strateji kaynağı.
// Bu dosyada değişen ana kurallar iki motora da otomatik yansır.
module.exports = Object.freeze({
  MAX_SYMS: 30,
  MIN_CONF: 75,
  START_EQ: 10000,
  RISK_PCT: 0.01,
  FEE_TAKER: 0.0002,
  FEE_MAKER: 0.0001,
  SLIP: 0.0005,
  TF: '60m',
  LTF: '15m',
  TIMEFRAMES: Object.freeze([
    Object.freeze({ tf: '15m', ltf: '5m' }),
    Object.freeze({ tf: '30m', ltf: '5m' }),
    Object.freeze({ tf: '60m', ltf: '15m' }),
    Object.freeze({ tf: '2h', ltf: '30m' }),
    Object.freeze({ tf: '4h', ltf: '60m' }),
    Object.freeze({ tf: '1d', ltf: '4h' })
  ]),
  MIN_RISK: 0.012,
  MAX_OPEN: 6,
  MAX_NEW_PER_RUN: 2,
  TP1_R: 1.5,
  LEVERAGE_CAP: Infinity
});
