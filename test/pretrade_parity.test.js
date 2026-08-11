'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const paper = fs.readFileSync(path.join(root, 'paper_engine.js'), 'utf8');
const backtest = fs.readFileSync(path.join(root, 'backtest3ay.js'), 'utf8');
for (const source of [paper, backtest]) {
  assert.match(source, /require\(['"]\.\/core\/dreyko_pretrade_pipeline['"]\)/);
  assert.match(source, /DreykoPretrade\.evaluate\(/);
  assert.match(source, /minNetRR/);
  assert.match(source, /spreadBps/);
  assert.match(source, /minRiskPct/);
}
assert.match(backtest, /cc\.slice\(0, at \+ 1\)/);
assert.match(backtest, /if \(decision\.valid\) \{ signalAt = at; break; \}/);
console.log('pretrade parity tests passed');
