'use strict';

const assert = require('assert');
const { assessState } = require('../paper_health');

const now = Date.UTC(2026, 7, 4, 22, 30, 0);

{
  const health = assessState({
    equity: 10000,
    open: [],
    closed: [],
    lastRun: now - 5 * 60000,
    analyticsMeta: { generatedAt: now - 4 * 60000 }
  }, now);
  assert.equal(health.status, 'HEALTHY');
  assert.equal(health.ok, true);
  assert.deepEqual(health.issues, []);
}

{
  const health = assessState({
    equity: 10000,
    open: [],
    closed: [],
    lastRun: now - 45 * 60000,
    analyticsMeta: { generatedAt: now - 44 * 60000 }
  }, now);
  assert.equal(health.status, 'STALE');
  assert(health.issues.includes('STALE_STATE'));
  assert(health.issues.includes('STALE_ANALYTICS'));
}

{
  const health = assessState({
    equity: 0,
    open: null,
    closed: {},
    lastRun: now,
    analyticsMeta: { generatedAt: now - 2 * 60000 }
  }, now);
  assert.equal(health.status, 'DEGRADED');
  assert(health.issues.includes('OPEN_NOT_ARRAY'));
  assert(health.issues.includes('CLOSED_NOT_ARRAY'));
  assert(health.issues.includes('INVALID_EQUITY'));
  assert(health.issues.includes('ANALYTICS_BEHIND_STATE'));
}

console.log('paper_health tests passed');
