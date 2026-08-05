'use strict';

const assert = require('assert');
const S = require('../core/paper_summary');

const NOW = Date.UTC(2026, 7, 5, 15, 0, 0);
const state = {
  startEquity: 1000,
  equity: 1125.5,
  lastRun: NOW - 1000,
  runs: 42,
  open: [
    { riskUSD: 10, deriskDone: false },
    { riskUSD: 8, deriskDone: true }
  ],
  closed: [{}, {}, {}],
  stats: {
    wins: 2,
    losses: 1,
    winRate: 66.67,
    totalR: 3.25,
    expectancyR: 1.08,
    profitFactor: 2.4,
    maxDrawdownR: 1.2,
    avgMfeR: 1.8,
    avgMaeR: 0.6
  },
  health: { ok: true, status: 'HEALTHY' },
  analyticsMeta: { version: '5.5', generatedAt: NOW - 500 },
  riskRejections: [
    { reason: 'WEEKLY_DRAWDOWN' },
    { reason: 'WEEKLY_DRAWDOWN' },
    { reason: 'CORRELATED_RISK' }
  ],
  strategyRankings: [{ key: 'A', score: 80 }, { key: 'B', score: 60 }]
};

const summary = S.buildSummary(state, { now: NOW });
assert.equal(summary.schemaVersion, '6.0');
assert.equal(summary.generatedAt, NOW);
assert.equal(summary.health.status, 'HEALTHY');
assert.equal(summary.account.pnl, 125.5);
assert.equal(summary.account.returnPct, 12.55);
assert.deepEqual(summary.positions, { open: 2, risky: 1, breakeven: 1, totalRiskUSD: 18 });
assert.equal(summary.performance.closed, 3);
assert.equal(summary.performance.expectancyR, 1.08);
assert.equal(summary.risk.rejectionCount, 3);
assert.equal(summary.risk.rejectionCounts.WEEKLY_DRAWDOWN, 2);
assert.equal(summary.rankings.length, 2);
assert.equal(summary.meta.analyticsVersion, '5.5');

const empty = S.buildSummary({}, { now: NOW });
assert.equal(empty.account.equity, 0);
assert.equal(empty.positions.open, 0);
assert.equal(empty.health.status, 'UNKNOWN');
assert.deepEqual(empty.rankings, []);

console.log('paper_summary tests passed');
