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
  MIN_RISK: 0.012,
  MAX_OPEN: 6,
  MAX_NEW_PER_RUN: 2,
  TP1_R: 1.5,
  LEVERAGE_CAP: Infinity,
  MAX_TOTAL_RISK_PCT: 0.04,
  MAX_DIRECTIONAL_RISK_PCT: 0.03,
  MAX_CORRELATED_TRADES: 2,
  WEEKLY_STOP_R: 5,
  DAILY_LOSS_LIMIT_R: 3,
  MAX_LOSING_STREAK: 4,
  COOLDOWN_MS: 6 * 60 * 60 * 1000,
  MIN_NET_RR: 1.5,
  SPREAD_BPS: 2
});
