'use strict';

function validateState(state, options = {}) {
  const expectedAnalyticsVersion = options.analyticsVersion || '5.5';
  const issues = [];

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, issues: ['STATE_NOT_OBJECT'] };
  }
  if (!Array.isArray(state.open)) issues.push('OPEN_NOT_ARRAY');
  if (!Array.isArray(state.closed)) issues.push('CLOSED_NOT_ARRAY');
  if (!Number.isFinite(Number(state.equity)) || Number(state.equity) <= 0) issues.push('INVALID_EQUITY');
  if (!state.health || typeof state.health !== 'object') issues.push('HEALTH_MISSING');
  else {
    if (state.health.ok !== true) issues.push('HEALTH_NOT_OK');
    if (state.health.status !== 'HEALTHY') issues.push('HEALTH_STATUS_INVALID');
  }
  if (!state.analyticsMeta || typeof state.analyticsMeta !== 'object') issues.push('ANALYTICS_META_MISSING');
  else {
    if (state.analyticsMeta.version !== expectedAnalyticsVersion) issues.push('ANALYTICS_VERSION_INVALID');
    if (!Number.isFinite(Number(state.analyticsMeta.generatedAt))) issues.push('ANALYTICS_TIME_INVALID');
  }

  return { ok: issues.length === 0, issues };
}

function assertState(state, options) {
  const result = validateState(state, options);
  if (!result.ok) throw new Error('paper state geçersiz: ' + result.issues.join(','));
  return result;
}

module.exports = { validateState, assertState };
