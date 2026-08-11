'use strict';

const assert = require('assert');
const Time = require('../core/asset_time_policy');

assert.equal(Time.classify('BTC_USDT'), 'CRYPTO');
assert.equal(Time.classify('NQ1!'), 'INDEX');
assert.equal(Time.classify('EURUSD'), 'FX');
const candles = [{ t: Date.UTC(2026, 0, 5, 0), o: 100 }, { t: Date.UTC(2026, 0, 5, 15), o: 101 }];
assert.equal(Time.evaluate('BTC_USDT', candles).allowed, true);
assert.equal(Time.evaluate('NQ', candles, Date.UTC(2026, 0, 5, 15)).allowed, true);
assert.equal(Time.evaluate('NQ', candles, Date.UTC(2026, 0, 5, 20)).allowed, false);
assert.equal(Time.evaluate('EURUSD', candles, Date.UTC(2026, 0, 5, 8)).allowed, true);
console.log('asset_time_policy tests passed');
