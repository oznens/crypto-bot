'use strict';

function finiteNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return Number.isFinite(Number(value));
}

function validateFills(trade, prefix) {
  const issues = [];
  if (trade.fills === undefined) return issues;
  if (!Array.isArray(trade.fills)) return [`${prefix}_TRADE_FILLS_NOT_ARRAY`];

  let previousTime = null;
  for (const fill of trade.fills) {
    if (!fill || typeof fill !== 'object' || Array.isArray(fill)) {
      issues.push(`${prefix}_TRADE_FILL_NOT_OBJECT`);
      continue;
    }

    const timeValid = finiteNumber(fill.t);
    if (!timeValid) issues.push(`${prefix}_TRADE_FILL_TIME_INVALID`);
    if (!finiteNumber(fill.px) || Number(fill.px) <= 0) issues.push(`${prefix}_TRADE_FILL_PRICE_INVALID`);
    if (!finiteNumber(fill.part) || Number(fill.part) <= 0 || Number(fill.part) > 1) {
      issues.push(`${prefix}_TRADE_FILL_PART_INVALID`);
    }
    if (!finiteNumber(fill.pnl)) issues.push(`${prefix}_TRADE_FILL_PNL_INVALID`);
    if (typeof fill.why !== 'string' || !fill.why.trim()) issues.push(`${prefix}_TRADE_FILL_REASON_INVALID`);

    if (timeValid) {
      const fillTime = Number(fill.t);
      if (previousTime !== null && fillTime < previousTime) issues.push(`${prefix}_TRADE_FILL_TIME_ORDER_INVALID`);
      if (finiteNumber(trade.openedAt) && fillTime < Number(trade.openedAt)) {
        issues.push(`${prefix}_TRADE_FILL_BEFORE_OPEN`);
      }
      if (finiteNumber(trade.closedAt) && fillTime > Number(trade.closedAt)) {
        issues.push(`${prefix}_TRADE_FILL_AFTER_CLOSE`);
      }
      previousTime = fillTime;
    }
  }

  return issues;
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

    const entryValid = finiteNumber(trade.entry) && Number(trade.entry) > 0;
    const qtyValid = finiteNumber(trade.qty) && Number(trade.qty) > 0;
    const qty0Valid = finiteNumber(trade.qty0) && Number(trade.qty0) > 0;
    const stopValid = finiteNumber(trade.sl) && Number(trade.sl) > 0;
    const tp1Valid = finiteNumber(trade.tp1) && Number(trade.tp1) > 0;
    const tpFValid = finiteNumber(trade.tpF) && Number(trade.tpF) > 0;

    if (typeof trade.symbol !== 'string' || !trade.symbol.trim()) issues.push('OPEN_TRADE_SYMBOL_INVALID');
    if (!['LONG', 'SHORT'].includes(trade.side)) issues.push('OPEN_TRADE_SIDE_INVALID');
    if (!entryValid) issues.push('OPEN_TRADE_ENTRY_INVALID');
    if (!qtyValid) issues.push('OPEN_TRADE_QTY_INVALID');
    if (!qty0Valid) issues.push('OPEN_TRADE_INITIAL_QTY_INVALID');
    if (qtyValid && qty0Valid && Number(trade.qty) > Number(trade.qty0)) issues.push('OPEN_TRADE_QTY_EXCEEDS_INITIAL');
    if (!finiteNumber(trade.riskUSD) || Number(trade.riskUSD) <= 0) issues.push('OPEN_TRADE_RISK_INVALID');
    if (!finiteNumber(trade.openedAt)) issues.push('OPEN_TRADE_TIME_INVALID');
    if (!stopValid) issues.push('OPEN_TRADE_STOP_INVALID');
    if (!tp1Valid || !tpFValid) issues.push('OPEN_TRADE_TARGET_INVALID');

    if (entryValid && stopValid && tp1Valid && tpFValid && ['LONG', 'SHORT'].includes(trade.side)) {
      const entry = Number(trade.entry);
      const stop = Number(trade.sl);
      const tp1 = Number(trade.tp1);
      const tpF = Number(trade.tpF);
      const geometryValid = trade.side === 'LONG'
        ? stop <= entry && tp1 >= entry && tpF >= tp1
        : stop >= entry && tp1 <= entry && tpF <= tp1;
      if (!geometryValid) issues.push('OPEN_TRADE_PRICE_GEOMETRY_INVALID');
    }

    issues.push(...validateFills(trade, 'OPEN'));
    if (trade.status !== 'open') issues.push('OPEN_TRADE_STATUS_INVALID');
  }

  for (const trade of closedTrades || []) {
    registerId(trade, 'CLOSED');
    if (!trade || typeof trade !== 'object') continue;

    if (!finiteNumber(trade.resultR)) issues.push('CLOSED_TRADE_RESULT_INVALID');
    if (!finiteNumber(trade.riskUSD) || Number(trade.riskUSD) <= 0) issues.push('CLOSED_TRADE_RISK_INVALID');
    if (!finiteNumber(trade.openedAt)) issues.push('CLOSED_TRADE_OPEN_TIME_INVALID');
    if (!finiteNumber(trade.closedAt)) issues.push('CLOSED_TRADE_TIME_INVALID');
    if (
      finiteNumber(trade.openedAt) &&
      finiteNumber(trade.closedAt) &&
      Number(trade.closedAt) < Number(trade.openedAt)
    ) issues.push('CLOSED_TRADE_TIME_ORDER_INVALID');
    if (finiteNumber(trade.mfeR) && Number(trade.mfeR) < 0) issues.push('CLOSED_TRADE_MFE_INVALID');
    if (finiteNumber(trade.maeR) && Number(trade.maeR) < 0) issues.push('CLOSED_TRADE_MAE_INVALID');
    issues.push(...validateFills(trade, 'CLOSED'));
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

module.exports = { finiteNumber, validateFills, validateTradeCollections, validateState, assertState };
