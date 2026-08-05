'use strict';
const assert = require('assert');
const M = require('../core/multi_timeframe_alignment');
assert.equal(M.evaluate({side:'LONG',htfBias:'Bullish',mtfTrend:'UP',ltfBias:'LONG'}).valid,true);
assert.equal(M.evaluate({side:'LONG',htfBias:'Bearish',mtfTrend:'UP'}).reason,'TIMEFRAME_CONFLICT');
assert.equal(M.evaluate({side:'SHORT',htfBias:'Neutral',mtfTrend:'DOWN'}).status,'PARTIAL');
assert.equal(M.norm('bearish'),'SHORT');
console.log('multi_timeframe_alignment tests passed');
