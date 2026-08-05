'use strict';

const DEFAULT_MULTIPLIER = 0.5;
const MIN_MULTIPLIER = 0.25;
const MAX_MULTIPLIER = 1.25;

function finiteNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return Number.isFinite(Number(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function allocationRow(allocation, model) {
  if (!allocation || !Array.isArray(allocation.allocations)) return null;
  const key = String(model || 'UNKNOWN');
  return allocation.allocations.find(row => String(row?.model || 'UNKNOWN') === key) || null;
}

function decide(allocation, model, options = {}) {
  const defaultMultiplier = finiteNumber(options.defaultMultiplier)
    ? clamp(options.defaultMultiplier, MIN_MULTIPLIER, MAX_MULTIPLIER)
    : DEFAULT_MULTIPLIER;
  const row = allocationRow(allocation, model);

  if (!row) {
    return {
      allowed: true,
      status: 'UNRANKED',
      multiplier: defaultMultiplier,
      reason: 'strateji tahsis verisi yok; muhafazakâr varsayılan kullanıldı'
    };
  }

  const status = String(row.status || 'WATCH').toUpperCase();
  if (status === 'PAUSED') {
    return {
      allowed: false,
      status,
      multiplier: 0,
      score: finiteNumber(row.score) ? Number(row.score) : null,
      reason: row.reason || 'strateji V7 tahsisinde durduruldu'
    };
  }

  const rawMultiplier = finiteNumber(row.riskMultiplier)
    ? Number(row.riskMultiplier)
    : defaultMultiplier;
  const multiplier = clamp(rawMultiplier, MIN_MULTIPLIER, MAX_MULTIPLIER);

  return {
    allowed: true,
    status: status === 'ACTIVE' ? 'ACTIVE' : 'WATCH',
    multiplier,
    score: finiteNumber(row.score) ? Number(row.score) : null,
    portfolioWeightPct: finiteNumber(row.portfolioWeightPct) ? Number(row.portfolioWeightPct) : null,
    reason: row.reason || (status === 'ACTIVE' ? 'strateji aktif' : 'strateji izleme modunda')
  };
}

function adjustedRiskPct(baseRiskPct, decision) {
  if (!decision?.allowed) return 0;
  const base = finiteNumber(baseRiskPct) ? Math.max(0, Number(baseRiskPct)) : 0;
  return +(base * clamp(decision.multiplier, MIN_MULTIPLIER, MAX_MULTIPLIER)).toFixed(8);
}

module.exports = {
  DEFAULT_MULTIPLIER,
  MIN_MULTIPLIER,
  MAX_MULTIPLIER,
  finiteNumber,
  allocationRow,
  decide,
  adjustedRiskPct
};