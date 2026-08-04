'use strict';

const CORRELATION_GROUPS = {
  BTC_BETA: ['BTC', 'ETH', 'SOL', 'AVAX', 'ARB', 'OP'],
  L1: ['SOL', 'SUI', 'APT', 'SEI', 'AVAX'],
  MEME: ['DOGE', 'PEPE', 'WIF', 'BONK', 'FLOKI']
};

function n(value, fallback) {
  const out = Number(value);
  return Number.isFinite(out) ? out : (fallback == null ? 0 : fallback);
}

function baseAsset(symbol) {
  return String(symbol || '')
    .toUpperCase()
    .replace(/[_\-\/]/g, '')
    .replace(/(USDT|USDC|USD|PERP)$/i, '');
}

function groupsFor(symbol) {
  const base = baseAsset(symbol);
  return Object.keys(CORRELATION_GROUPS).filter(group => CORRELATION_GROUPS[group].includes(base));
}

function isRisky(position) {
  return position && position.status !== 'closed' && !position.deriskDone && n(position.riskUSD) > 0;
}

function openRiskUSD(openPositions, side) {
  return (openPositions || [])
    .filter(isRisky)
    .filter(position => !side || position.side === side)
    .reduce((sum, position) => sum + n(position.riskUSD), 0);
}

function weeklyR(closedTrades, now) {
  const cutoff = n(now, Date.now()) - 7 * 24 * 60 * 60 * 1000;
  return (closedTrades || [])
    .filter(trade => n(trade.closedAt) >= cutoff)
    .reduce((sum, trade) => sum + n(trade.r != null ? trade.r : trade.resultR), 0);
}

function correlationCount(openPositions, candidate) {
  const candidateGroups = groupsFor(candidate.symbol);
  if (!candidateGroups.length) return 0;
  return (openPositions || []).filter(position => {
    if (!isRisky(position) || position.side !== candidate.side) return false;
    const groups = groupsFor(position.symbol);
    return groups.some(group => candidateGroups.includes(group));
  }).length;
}

function evaluateTrade(state, candidate, config) {
  state = state || {};
  candidate = candidate || {};
  config = config || {};

  const equity = Math.max(0, n(state.equity));
  const riskUSD = Math.max(0, n(candidate.riskUSD));
  const maxTotalRiskPct = n(config.maxTotalRiskPct, 0.04);
  const maxDirectionalRiskPct = n(config.maxDirectionalRiskPct, 0.03);
  const maxCorrelatedTrades = Math.max(1, n(config.maxCorrelatedTrades, 2));
  const weeklyStopR = Math.abs(n(config.weeklyStopR, 5));

  if (!equity || !riskUSD || !candidate.side || !candidate.symbol) {
    return { allowed: false, reason: 'INVALID_CANDIDATE' };
  }

  const weekR = weeklyR(state.closed, config.now);
  if (weeklyStopR > 0 && weekR <= -weeklyStopR) {
    return { allowed: false, reason: 'WEEKLY_LOSS_LIMIT', weekR };
  }

  const totalAfter = openRiskUSD(state.open) + riskUSD;
  if (totalAfter > equity * maxTotalRiskPct) {
    return { allowed: false, reason: 'MAX_TOTAL_RISK', totalRiskUSD: totalAfter };
  }

  const directionalAfter = openRiskUSD(state.open, candidate.side) + riskUSD;
  if (directionalAfter > equity * maxDirectionalRiskPct) {
    return { allowed: false, reason: 'MAX_DIRECTIONAL_RISK', directionalRiskUSD: directionalAfter };
  }

  const correlated = correlationCount(state.open, candidate);
  if (correlated >= maxCorrelatedTrades) {
    return { allowed: false, reason: 'MAX_CORRELATED_TRADES', correlated };
  }

  return {
    allowed: true,
    reason: 'OK',
    weekR,
    totalRiskUSD: totalAfter,
    directionalRiskUSD: directionalAfter,
    correlated
  };
}

module.exports = {
  CORRELATION_GROUPS,
  baseAsset,
  groupsFor,
  openRiskUSD,
  weeklyR,
  correlationCount,
  evaluateTrade
};
