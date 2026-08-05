'use strict';

const assert = require('assert');
const E = require('../core/strategy_ensemble');

const trendLong = E.evaluate([
  { model: 'A', side: 'LONG', confidence: 80, weight: 1 },
  { model: 'B', side: 'LONG', confidence: 70, weight: 1 },
  { model: 'C', side: 'SHORT', confidence: 60, weight: 0.5 }
], { regime: 'TREND_UP' });
assert.equal(trendLong.accepted, true);
assert.equal(trendLong.decision, 'LONG');
assert.equal(trendLong.winnerModel, 'A');
assert.ok(trendLong.consensus > 0.75);

const conflicted = E.evaluate([
  { model: 'A', side: 'LONG', confidence: 80 },
  { model: 'B', side: 'SHORT', confidence: 80 }
], { regime: 'RANGE' });
assert.equal(conflicted.accepted, false);
assert.equal(conflicted.decision, 'NO_TRADE');

const down = E.evaluate([
  { model: 'L', side: 'LONG', confidence: 75 },
  { model: 'S', side: 'SHORT', confidence: 75 }
], { regime: 'TREND_DOWN', minConsensus: 0.55 });
assert.equal(down.accepted, true);
assert.equal(down.decision, 'SHORT');

const noRows = E.evaluate([], {});
assert.equal(noRows.accepted, false);
assert.equal(noRows.reason, 'geçerli strateji adayı yok');

const derived = E.candidatesFromAnalysis({
  setup: { model: 'MM Buy Model', side: 'LONG', confidence: 82, mmxm: { valid: true } },
  htfBias: 'Bullish'
});
assert.equal(derived.length, 3);
assert.equal(derived.every(x => x.side === 'LONG'), true);

const disagreement = E.candidatesFromAnalysis({
  setup: { model: 'MM Buy Model', side: 'LONG', confidence: 82, mmxm: { valid: true } },
  htfBias: 'Bearish'
});
const result = E.evaluate(disagreement, { regime: 'TREND_UP' });
assert.ok(result.conflictPenalty > 0);

console.log('strategy_ensemble tests passed');
