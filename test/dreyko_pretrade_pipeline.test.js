'use strict';

const assert = require('assert');
const Pipeline = require('../core/dreyko_pretrade_pipeline');

assert.equal(Pipeline.evaluate({}).reason, 'PRETRADE_INPUT_INVALID');

const rows = [];
for (let i = 0; i < 30; i++) rows.push({ t: Date.UTC(2026, 0, 5, i), o: 100, h: 100.4, l: 99.6, c: 100.05, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 6), o: 100, h: 100.1, l: 98.8, c: 99.2, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 7), o: 99.2, h: 100.5, l: 99.1, c: 100.4, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 8), o: 100.4, h: 102.6, l: 100.3, c: 102.4, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 9), o: 103, h: 105, l: 102.9, c: 103.2, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 10), o: 103.1, h: 103.3, l: 100.15, c: 100.4, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 11), o: 100.4, h: 103.5, l: 100.3, c: 103.3, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 12), o: 103.3, h: 105.04, l: 103, c: 104.8, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 13), o: 104.8, h: 104.9, l: 103.5, c: 104, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 14), o: 104, h: 105.02, l: 103.8, c: 104.5, v: 1 });
rows.push({ t: Date.UTC(2026, 0, 6, 15), o: 104.5, h: 104.7, l: 103.9, c: 104.2, v: 1 });
const analysis = { setup: { side: 'LONG', stop: 102, confidence: 90, grade: 'A', mmxm: { valid: true } }, structures: { manipulation: { side: 'LONG', sweepAt: 30, at: 31 } } };
const accepted = Pipeline.evaluate({ symbol: 'BTC_USDT', candles: rows, analysis, marketPrice: 103.3 }, { minRiskPct: 0.01, minNetRR: 0.5 });
assert.equal(accepted.valid, true);
assert.equal(accepted.stage, 'ACCEPTED');
assert.equal(accepted.sequence.entryModel, 'FIRST_PRESENTED_FVG');

const noSequence = Pipeline.evaluate({ symbol: 'BTC_USDT', candles: rows.slice(0, 33), analysis, marketPrice: 102.4 });
assert.equal(noSequence.stage, 'SEQUENCE');
console.log('dreyko_pretrade_pipeline tests passed');
