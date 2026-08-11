'use strict';

const assert = require('assert');
const Target = require('../core/dreyko_target_engine');

const candles = [];
const highs = [100, 101, 105, 101, 100, 101, 105.04, 101, 100, 101, 108, 101, 108.03, 101, 100];
const lows =  [99,  98,  97, 98,  99,  98,  97.02, 98, 99,  98,  97, 98,  97.01, 98, 99];
for (let i = 0; i < highs.length; i++) candles.push({ t: i, o: 100, h: highs[i], l: lows[i], c: 100 });

const long = Target.evaluate({ candles, side: 'LONG', entry: 100, stop: 98 });
assert.equal(long.valid, true);
assert.equal(long.target.source, 'OPPOSING_LIQUIDITY_POOL');
assert.ok(long.target.price >= 105 && long.target.price < 106);
assert.ok(long.target.grossRR >= 2.5);

const farCandles = [];
for (let i = 0; i < 21; i++) {
  const peak = i === 5 ? 108 : (i === 15 ? 108.04 : 101);
  farCandles.push({ t: i, o: 100, h: peak, l: 98, c: 100 });
}
const rrFiltered = Target.evaluate({ candles: farCandles, side: 'LONG', entry: 104, stop: 100 }, { minGrossRR: 1 });
assert.equal(rrFiltered.valid, true);
assert.ok(rrFiltered.target.price >= 108);

assert.equal(Target.evaluate({ candles: [], side: 'LONG', entry: 100, stop: 99 }).reason, 'TARGET_INPUT_INVALID');
assert.equal(Target.evaluate({ candles, side: 'LONG', entry: 100, stop: 101 }).reason, 'TARGET_GEOMETRY_INVALID');
assert.equal(Target.evaluate({ candles, side: 'LONG', entry: 110, stop: 109 }).reason, 'DRAW_ON_LIQUIDITY_MISSING');
console.log('dreyko_target_engine tests passed');
