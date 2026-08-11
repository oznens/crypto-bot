'use strict';

const assert = require('assert');
const Yigital = require('../core/yigital_pretrade_pipeline');

const setup = { model: 'Turtle Soup', htfAligned: true, entryStatus: 'active', entry: 100, stop: 98, tps: [102, 104] };
const ready = Yigital.evaluate({ analysis: { yigitalSetup: setup } }, { minNetRR: 1.3 });
assert.equal(ready.valid, true);
assert.equal(ready.grossRR, 2);
assert.equal(ready.sequence.state, 'HTF→SWEEP→RECLAIM→RETEST');

assert.equal(Yigital.evaluate({ analysis: { yigitalSetup: { ...setup, model: 'FVG / Order Block' } } }).reason, 'MANIPULATION_MODEL_REQUIRED');
assert.equal(Yigital.evaluate({ analysis: { yigitalSetup: { ...setup, htfAligned: false } } }).reason, 'HTF_FLOW_MISMATCH');
assert.equal(Yigital.evaluate({ analysis: { yigitalSetup: { ...setup, entryStatus: 'pending' } } }).reason, 'ENTRY_RETEST_PENDING');

console.log('yigital_pretrade_pipeline tests passed');
