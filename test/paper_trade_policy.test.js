'use strict';

const assert = require('assert');
const Policy = require('../core/paper_trade_policy');

{
  const p = Policy.calculatePosition({ equity: 10000, riskPct: 0.01, leverageCap: 10, entry: 100, stop: 99 });
  assert.equal(p.valid, true);
  assert.equal(p.leverageCapped, false);
  assert.equal(Math.round(p.actualRiskUSD), 100);
}

{
  const p = Policy.calculatePosition({ equity: 10000, riskPct: 0.01, leverageCap: 1, entry: 100, stop: 50 });
  assert.equal(p.valid, true);
  assert.equal(p.leverageCapped, true);
  assert.equal(p.qty, 100);
  assert.equal(p.actualRiskUSD, 5000);
}

{
  const trade = { side: 'LONG', entry: 100, sl: 99, initialSL: 99, initialRiskDist: 1, mfeR: 0, maeR: 0 };
  Policy.applyExcursion(trade, { h: 103, l: 98.5 }, { stopFirst: true });
  assert.equal(trade.mfeR, 0, 'SL vurulan aynı mumda MFE şişmemeli');
  assert.equal(trade.maeR, 1.5);
}

{
  const trade = { side: 'SHORT', entry: 100, sl: 101, initialSL: 101, initialRiskDist: 1, mfeR: 0, maeR: 0 };
  Policy.applyExcursion(trade, { h: 100.5, l: 97 }, { stopFirst: true });
  assert.equal(trade.mfeR, 3);
  assert.equal(trade.maeR, 0.5);
}

console.log('paper_trade_policy tests passed');
