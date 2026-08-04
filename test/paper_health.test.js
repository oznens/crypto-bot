'use strict';

const assert = require('node:assert/strict');
const { assessState } = require('../paper_health');

const NOW = Date.UTC(2026, 7, 5, 0, 0, 0);

function validState(overrides = {}) {
  return {
    equity: 1000,
    open: [],
    closed: [],
    lastRun: NOW - 5 * 60_000,
    analyticsMeta: { generatedAt: NOW - 4 * 60_000 },
    ...overrides
  };
}

function testHealthyState() {
  const result = assessState(validState(), NOW);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'HEALTHY');
  assert.deepEqual(result.issues, []);
}

function testStaleState() {
  const result = assessState(validState({ lastRun: NOW - 31 * 60_000 }), NOW);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'STALE');
  assert.ok(result.issues.includes('STALE_STATE'));
}

function testMissingAnalytics() {
  const result = assessState(validState({ analyticsMeta: {} }), NOW);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'DEGRADED');
  assert.ok(result.issues.includes('MISSING_ANALYTICS'));
}

function testInvalidEquity() {
  const result = assessState(validState({ equity: 0 }), NOW);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'DEGRADED');
  assert.ok(result.issues.includes('INVALID_EQUITY'));
}

function testAnalyticsBehindState() {
  const result = assessState(validState({
    lastRun: NOW - 2 * 60_000,
    analyticsMeta: { generatedAt: NOW - 5 * 60_000 }
  }), NOW);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'DEGRADED');
  assert.ok(result.issues.includes('ANALYTICS_BEHIND_STATE'));
}

[
  testHealthyState,
  testStaleState,
  testMissingAnalytics,
  testInvalidEquity,
  testAnalyticsBehindState
].forEach(test => test());

console.log('paper_health: 5/5 test geçti');
