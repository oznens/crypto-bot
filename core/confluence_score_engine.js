'use strict';

const DEFAULT_WEIGHTS = {
  structure: 18,
  liquidity: 16,
  displacement: 14,
  fvg: 12,
  orderBlock: 10,
  htfAlignment: 12,
  smt: 8,
  session: 6,
  regime: 4
};

function score(signals = {}, options = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  let earned = 0;
  let possible = 0;
  const breakdown = [];
  for (const [key, weight] of Object.entries(weights)) {
    const value = signals[key];
    if (value === null || value === undefined) continue;
    possible += weight;
    const normalized = value === true ? 1 : value === false ? 0 : Math.max(0, Math.min(1, Number(value) || 0));
    const points = weight * normalized;
    earned += points;
    breakdown.push({ key, weight, normalized, points:+points.toFixed(2) });
  }
  const pct = possible ? Math.round(100 * earned / possible) : 0;
  const grade = pct >= 85 ? 'A+' : pct >= 75 ? 'A' : pct >= 65 ? 'B' : 'C';
  const minScore = Number.isFinite(+options.minScore) ? +options.minScore : 70;
  return { score:pct, grade, valid:pct >= minScore, earned:+earned.toFixed(2), possible, breakdown };
}

module.exports = { DEFAULT_WEIGHTS, score };
