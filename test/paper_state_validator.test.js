'use strict';

const assert = require('assert');
const V = require('../core/paper_state_validator');

const valid = {
  equity: 10000,
  open: [],
  closed: [],
  health: { ok: true, status: 'HEALTHY' },
  analyticsMeta: { version: '5.5', generatedAt: Date.now() }
};

assert.equal(V.validateState(valid).ok, true);
assert.deepEqual(V.validateState(null).issues, ['STATE_NOT_OBJECT']);
assert.ok(V.validateState({ ...valid, equity: 0 }).issues.includes('INVALID_EQUITY'));
assert.ok(V.validateState({ ...valid, health: { ok: false, status: 'DEGRADED' } }).issues.includes('HEALTH_NOT_OK'));
assert.ok(V.validateState({ ...valid, analyticsMeta: { version: '4.9', generatedAt: Date.now() } }).issues.includes('ANALYTICS_VERSION_INVALID'));
assert.throws(() => V.assertState({ ...valid, open: null }), /OPEN_NOT_ARRAY/);

console.log('paper_state_validator tests passed');
