'use strict';

const assert = require('assert');
const Analytics = require('../paper_analytics');

{
  const rows = Analytics.normalizedTrades([
    { id: 'late', r: 2, closedAt: 200 },
    { id: 'early', resultR: -1, r: 99, closedAt: 100 }
  ]);
  assert.deepEqual(rows.map(x => x.id), ['early', 'late']);
  assert.equal(rows[0].resultR, -1, 'resultR korunmalı');
  assert.equal(rows[1].resultR, 2, 'eski r alanı resultR olarak okunmalı');
}

{
  const out = Analytics.enrichStats(
    { weeklyR: 3 },
    { avgR: 0.25, profitFactor: 1.8, maxDrawdownR: 2.5, avgMfeR: 1.4, avgMaeR: 0.6 }
  );
  assert.equal(out.weeklyR, 3);
  assert.equal(out.expectancyR, 0.25);
  assert.equal(out.profitFactor, 1.8);
  assert.equal(out.maxDrawdownR, 2.5);
  assert.equal(out.avgMfeR, 1.4);
  assert.equal(out.avgMaeR, 0.6);
}

{
  const state = {
    stats: { weeklyR: 0 },
    closed: Array.from({ length: 4 }, (_, i) => ({
      model: 'MODEL_A',
      resultR: i % 2 ? -1 : 2,
      closedAt: i + 1,
      mfeR: 2,
      maeR: 1
    }))
  };
  const result = Analytics.buildAnalytics(state, { minTrades: 5, generatedAt: 12345 });
  assert.equal(result.bestStrategy, null, 'minimum örneklem altında en iyi model seçilmemeli');
  assert.equal(result.strategyRanking[0].eligible, false);
  assert.equal(result.analyticsMeta.generatedAt, 12345);
  assert.equal(result.analyticsMeta.version, '5.5');
}

{
  const state = {
    closed: Array.from({ length: 5 }, (_, i) => ({
      model: 'MODEL_B',
      resultR: i === 0 ? -1 : 1,
      closedAt: i + 1
    }))
  };
  const result = Analytics.buildAnalytics(state, { minTrades: 5, generatedAt: 99 });
  assert.equal(result.bestStrategy.model, 'MODEL_B');
  assert.equal(result.bestStrategy.eligible, true);
  assert.equal(result.analyticsMeta.closedTrades, 5);
}

console.log('paper_analytics tests passed');
