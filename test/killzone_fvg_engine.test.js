'use strict';
const assert = require('assert');
const K = require('../core/killzone_fvg_engine');
const t = Date.UTC(2026, 0, 5, 15, 30); // 10:30 NY
const candles = [
  { t:t-120000,o:100,h:101,l:99,c:100 },
  { t:t-60000,o:101,h:103,l:100,c:102 },
  { t,o:104,h:106,l:102,c:105 }
];
assert.equal(K.sessionFor(t), 'SILVER_BULLET_AM');
assert.equal(K.detectFvgs(candles)[0].side, 'LONG');
const ok = K.evaluate(candles, 'LONG');
assert.equal(ok.valid, true);
assert.equal(ok.score, 100);
assert.equal(K.evaluate(candles, 'SHORT').reason, 'FVG_MISSING');
assert.equal(K.evaluate(candles.slice(0,2), 'LONG').reason, 'INSUFFICIENT_CANDLES');
console.log('killzone_fvg_engine tests passed');
