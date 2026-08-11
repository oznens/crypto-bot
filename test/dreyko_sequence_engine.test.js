'use strict';

const assert = require('assert');
const Sequence = require('../core/dreyko_sequence_engine');

function candle(i, o, h, l, c) { return { t: i * 3600000, o, h, l, c, v: 1 }; }
const rows = [];
for (let i = 0; i < 30; i++) rows.push(candle(i, 100, 100.4, 99.6, 100.05));
rows.push(candle(30, 100, 100.1, 98.8, 99.2));
rows.push(candle(31, 99.2, 100.5, 99.1, 100.4));
rows.push(candle(32, 100.4, 102.6, 100.3, 102.4));
rows.push(candle(33, 103.0, 103.4, 102.9, 103.2));
rows.push(candle(34, 103.1, 103.3, 100.15, 100.4));
rows.push(candle(35, 100.4, 103.5, 100.3, 103.3));
const analysis = { setup: { side: 'LONG' }, structures: { manipulation: { side: 'LONG', sweepAt: 30, at: 31 } } };
const result = Sequence.evaluate(rows, analysis);
assert.equal(result.valid, true);
assert.equal(result.state, 'ENTRY_ARMED');
assert.equal(result.firstFvg.to, 32);
assert.ok(result.retestIndex > result.firstFvg.to);

const wrongOrder = rows.slice(0, 33);
assert.equal(Sequence.evaluate(wrongOrder, analysis).valid, false);
assert.equal(Sequence.evaluate(wrongOrder, analysis).reason, 'FIRST_PRESENTED_FVG_RETEST_MISSING');

const withoutFvg = rows.slice(0, 33).map(c => ({ ...c }));
withoutFvg[32] = candle(32, 100.4, 102.6, 100.0, 102.4);
assert.equal(Sequence.evaluate(withoutFvg, analysis).reason, 'FIRST_PRESENTED_FVG_MISSING');

const invalidated = rows.concat(candle(36, 103.2, 103.3, 99.8, 100));
assert.equal(Sequence.evaluate(invalidated, analysis).reason, 'FIRST_PRESENTED_FVG_INVALIDATED');

const iofedRows = rows.map(c => ({ ...c }));
iofedRows[32] = candle(32, 100.4, 102.4, 100.3, 102.2);
iofedRows[33] = candle(33, 102.2, 102.4, 100.8, 101.4);
const iofed = Sequence.findIofed(
  iofedRows,
  [{ side: 'SHORT', type: 'bear', from: 28, to: 30, bottom: 100, top: 101, ce: 100.5 }],
  'LONG',
  analysis.structures.manipulation,
  { index: 32 }
);
assert.ok(iofed);
assert.equal(iofed.flipIndex, 32);
assert.equal(iofed.retestIndex, 33);

const iofedSequenceRows = rows.map(c => ({ ...c }));
iofedSequenceRows[28] = candle(28, 101, 101.2, 100.8, 101.05);
iofedSequenceRows[32] = candle(32, 100.4, 102.4, 99.9, 102.2);
iofedSequenceRows[33] = candle(33, 102.2, 102.4, 100.4, 101.4);
const iofedSequence = Sequence.evaluate(iofedSequenceRows, analysis);
assert.equal(iofedSequence.valid, true);
assert.equal(iofedSequence.entryModel, 'IOFED');
assert.equal(iofedSequence.reason, 'IOFED_RETEST_CONFIRMED');

const breakawayRows = rows.slice(0, 36).map(c => ({ ...c }));
breakawayRows[34] = candle(34, 103.1, 104, 103, 103.8);
breakawayRows[35] = candle(35, 103.8, 104.5, 103.4, 104.3);
const breakaway = Sequence.evaluate(breakawayRows, analysis);
assert.equal(breakaway.valid, false);
assert.equal(breakaway.state, 'BREAKAWAY_GAP_CONFIRMED');
assert.equal(breakaway.entryModel, 'BREAKAWAY_GAP');
assert.equal(breakaway.reason, 'WAITING_LOW_RISK_ENTRY');
console.log('dreyko_sequence_engine tests passed');
