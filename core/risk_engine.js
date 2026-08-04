'use strict';

function calculateRisk(positionSize, stopDistance, account) {
  if (!account || !account.balance) return 0;
  return (positionSize * stopDistance) / account.balance;
}

function canTrade(state, config) {
  config = config || {};
  const maxExposure = config.maxExposure || 0.05;
  const exposure = state && state.openRisk ? state.openRisk : 0;

  return {
    allowed: exposure < maxExposure,
    reason: exposure < maxExposure ? 'OK' : 'MAX_EXPOSURE_REACHED'
  };
}

function checkCorrelation(openPositions, symbol) {
  const sameAsset = (openPositions || []).filter(p => p.symbol === symbol);
  return sameAsset.length === 0;
}

module.exports = { calculateRisk, canTrade, checkCorrelation };
