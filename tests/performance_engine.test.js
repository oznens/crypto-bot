'use strict';

const assert = require('assert');
const Performance = require('../core/performance_engine');

const trades = [
  { r: 2, model: 'PO3', session: 'LONDON', regime: 'TREND_UP', tf: '15m', side: 'LONG', grade: 'A+', mfeR: 2.5, maeR: 0.4 },
  { resultR: -1, model: 'PO3', session: 'LONDON', regime: 'RANGE', tf: '15m', side: 'LONG', grade: 'A', mfeR: 0.3, maeR: 1.1 },
  { resultR: 1, model: 'MMXM', session: 'NEW_YORK', regime: 'TREND_UP', tf: '60m', side: 'SHORT', grade: 'A', mfeR: 1.4, maeR: 0.2 },
  { r: 0, model: 'MMXM', session: 'NEW_YORK', regime: 'TREND_UP', tf: '60m', side: 'SHORT', grade: 'A', mfeR: 0.8, maeR: 0.3 }
];

const summary = Performance.stats(trades);
assert.equal(summary.trades, 4);
assert.equal(summary.wins, 2);
assert.equal(summary.losses, 1);
assert.equal(summary.breakeven, 1);
assert.equal(summary.totalR, 2);
assert.equal(summary.profitFactor, 3);
assert.equal(summary.maxDrawdownR, 1);
assert.equal(summary.avgMfeR, 1.25);
assert.equal(summary.avgMaeR, 0.5);

const analysis = Performance.analyzeTrades(trades);
assert.equal(analysis.models.PO3.trades, 2);
assert.equal(analysis.sessions.LONDON.trades, 2);
assert.equal(analysis.regimes.TREND_UP.trades, 3);
assert.equal(analysis.timeframes['60m'].trades, 2);
assert.equal(analysis.sides.SHORT.trades, 2);

console.log('performance_engine tests passed');
