'use strict';

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function validateState(state, options = {}) {
  const expectedAnalyticsVersion = options.analyticsVersion || '5.5';
  const now = finiteNumber(options.now) ? Number(options.now) : Date.now();
  const futureToleranceMs = finiteNumber(options.futureToleranceMs)
    ? Math.max(0, Number(options.futureToleranceMs))
    : 120_000;
  const latestAllowedTime = now + futureToleranceMs;
  const issues = [];

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, issues: ['STATE_NOT_OBJECT'] };
  }

  const openValid = Array.isArray(state.open);
  const closedValid = Array.isArray(state.closed);

  if (!openValid) issues.push('OPEN_NOT_ARRAY');
  if (!closedValid) issues.push('CLOSED_NOT_ARRAY');
  if (!finiteNumber(state.equity) || Number(state.equity) <= 0) issues.push('INVALID_EQUITY');

  if (finiteNumber(state.lastRun) && Number(state.lastRun) > latestAllowedTime) {
    issues.push('LAST_RUN_IN_FUTURE');
  }

  if (!state.health || typeof state.health !== 'object') issues.push('HEALTH_MISSING');
  else {
    if (state.health.ok !== true) issues.push('HEALTH_NOT_OK');
    if (state.health.status !== 'HEALTHY') issues.push('HEALTH_STATUS_INVALID');
  }

  if (!state.analyticsMeta || typeof state.analyticsMeta !== 'object') {
    issues.push('ANALYTICS_META_MISSING');
  } else {
    if (state.analyticsMeta.version !== expectedAnalyticsVersion) issues.push('ANALYTICS_VERSION_INVALID');
    if (!finiteNumber(state.analyticsMeta.generatedAt)) issues.push('ANALYTICS_TIME_INVALID');
    else if (Number(state.analyticsMeta.generatedAt) > latestAllowedTime) issues.push('ANALYTICS_TIME_IN_FUTURE');

    if (!Number.isInteger(Number(state.analyticsMeta.closedTrades)) || Number(state.analyticsMeta.closedTrades) < 0) {
      issues.push('ANALYTICS_CLOSED_COUNT_INVALID');
    } else if (closedValid && Number(state.analyticsMeta.closedTrades) !== state.closed.length) {
      issues.push('ANALYTICS_CLOSED_COUNT_MISMATCH');
    }

    if (
      finiteNumber(state.lastRun) &&
      finiteNumber(state.analyticsMeta.generatedAt) &&
      Number(state.analyticsMeta.generatedAt) < Number(state.lastRun)
    ) {
      issues.push('ANALYTICS_BEHIND_STATE');
    }
  }

  return { ok: issues.length === 0, issues };
}

function assertState(state, options) {
  const result = validateState(state, options);
  if (!result.ok) throw new Error('paper state geçersiz: ' + result.issues.join(','));
  return result;
}

module.exports = { finiteNumber, validateState, assertState };
