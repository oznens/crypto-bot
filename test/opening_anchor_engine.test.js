'use strict';

const assert = require('assert');
const Anchor = require('../core/opening_anchor_engine');

const rows = [];
for (let i = 0; i < 30; i++) rows.push({ t: i, o: 100, h: 102, l: 100, c: 101 });
const aligned = Anchor.evaluate(rows, 'LONG', { daily: 100, weekly: 99, monthly: 105 });
assert.equal(aligned.valid, true);
assert.equal(aligned.mode, 'OPEN_FLOW_ALIGNMENT');
assert.deepEqual(aligned.aligned.sort(), ['daily', 'weekly']);

const reclaimRows = rows.map(row => ({ ...row, h: 100, l: 98, c: 99 }));
reclaimRows[29] = { t: 29, o: 99, h: 101, l: 97, c: 100.5 };
const reclaimed = Anchor.evaluate(reclaimRows, 'LONG', { daily: 100, weekly: 103, monthly: 104 });
assert.equal(reclaimed.valid, true);
assert.equal(reclaimed.mode, 'OPEN_SWEEP_RECLAIM');
assert.equal(reclaimed.reclaims[0].name, 'daily');

const conflict = Anchor.evaluate(rows, 'SHORT', { daily: 99, weekly: 98, monthly: 97 });
assert.equal(conflict.valid, false);
assert.equal(conflict.reason, 'OPENING_ANCHOR_CONFLICT');
assert.equal(Anchor.evaluate([], 'LONG', {}).reason, 'OPENING_ANCHOR_DATA_MISSING');
console.log('opening_anchor_engine tests passed');
