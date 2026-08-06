'use strict';

const assert = require('assert');
const { daysBetween, symbolCount } = require('../backtest/engine_adapter');

assert.strictEqual(daysBetween('2026-06-07', '2026-07-07'), 30);
assert.strictEqual(daysBetween('2026-07-07', '2026-08-06'), 30);
assert.strictEqual(symbolCount({ mode: 'top10' }), 10);
assert.strictEqual(symbolCount({ mode: 'top30' }), 30);
assert.throws(() => symbolCount({ mode: 'manual', list: ['BTC_USDT'] }), /not supported/i);
assert.throws(() => daysBetween('2026-07-07', '2026-06-07'), /Invalid backtest date range/);

console.log('backtest engine adapter tests passed');
