'use strict';

function finiteNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return Number.isFinite(Number(value));
}

function validateTradeCollections(openTrades, closedTrades) {
  const issues = [];
  const ids = new Set();

  function registerId(trade, prefix) {
    if (!trade || typeof trade !== 'object' || Array.isArray(trade)) {
      issues.push(`${prefix}_TRADE_NOT_OBJECT`);
      return false;
    }
    if (typeof trade.id !== 'string' || !trade.id.trim()) {
      issues.push(`${prefix}_TRADE_ID_INVALID`);
      return false;
    }
    if (ids.has(trade.id)) issues.push('DUPLICATE_TRADE_ID');
    ids.add(trade.id);
    return true;
  }

  for (const trade of openTrades || []) {
    registerId(trade, 'OPEN');
    if (!trade || typeof trade !== 'object') continue;
    if (typeof trade.symbol !== 'string' || !trade.symbol.trim()) issues.push('OPEN_TRADE_SYMBOL_INVALID');
    if (!['LONG', 'SHORT'].includes(trade.side)) issues.push('OPEN_TRADE_SIDE_INVALID');
    if (!finiteNumber(trade.entry) || Number(trade.entry) <= 0) issues.push('OPEN_TRADE_ENTRY_INVALID');
    if (!finiteNumber(trade.qty) || Number(trade.qty) <= 0) issues.push('OPEN_TRADE_QTY_INVALID');
    if (!finiteNumber(trade.riskUSD) || Number(trade.riskUSD) <= 0) issues.push('OPEN_TRADE_RISK_INVALID');
    if (!finiteNumber(trade.openedAt)) issues.push('OPEN_TRADE_TIME_INVALID');
    if (trade.status !== 'open') issues.push('OPEN_TRADE_STATUS_INVALID');
  }

  for (const trade of closedTrades || []) {
    registerId(trade, 'CLOSED');
    if (!trade || typeof trade !== 'object') continue;
    if (!finiteNumber(trade.resultR)) issues.push('CLOSED_TRADE_RESULT_INVALID');
    if (!finiteNumber(trade.closedAt)) issues.push('CLOSED_TRADE_TIME_INVALID');
    if (trade.status !== 'closed') issues.push('CLOSED_TRADE_STATUS_INVALID');
  }

  return issues;
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
  if (openValid && closedValid) issues.push(...validateTradeCollections(state.open, state.closed));
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

module.exports = { finiteNumber, validateTradeCollections, validateState, assertState };
