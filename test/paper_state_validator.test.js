'use strict';

const assert = require('assert');
const V = require('../core/paper_state_validator');

const NOW = Date.now();
const valid = {
  equity: 10000,
  open: [],
  closed: [],
  lastRun: NOW - 1000,
  health: { ok: true, status: 'HEALTHY' },
  analyticsMeta: {
    version: '5.5',
    generatedAt: NOW,
    closedTrades: 0
  }
};

assert.equal(V.validateState(valid).ok, true);
assert.deepEqual(V.validateState(null).issues, ['STATE_NOT_OBJECT']);
assert.ok(V.validateState({ ...valid, equity: 0 }).issues.includes('INVALID_EQUITY'));
assert.ok(V.validateState({ ...valid, health: { ok: false, status: 'DEGRADED' } }).issues.includes('HEALTH_NOT_OK'));
assert.ok(V.validateState({ ...valid, analyticsMeta: { ...valid.analyticsMeta, version: '4.9' } }).issues.includes('ANALYTICS_VERSION_INVALID'));
assert.ok(V.validateState({ ...valid, analyticsMeta: { ...valid.analyticsMeta, closedTrades: -1 } }).issues.includes('ANALYTICS_CLOSED_COUNT_INVALID'));
assert.ok(V.validateState({
  ...valid,
  closed: [{ resultR: 1 }],
  analyticsMeta: { ...valid.analyticsMeta, closedTrades: 0 }
}).issues.includes('ANALYTICS_CLOSED_COUNT_MISMATCH'));
assert.ok(V.validateState({
  ...valid,
  lastRun: NOW,
  analyticsMeta: { ...valid.analyticsMeta, generatedAt: NOW - 1 }
}).issues.includes('ANALYTICS_BEHIND_STATE'));
assert.throws(() => V.assertState({ ...valid, open: null }), /OPEN_NOT_ARRAY/);

console.log('paper_state_validator tests passed');
