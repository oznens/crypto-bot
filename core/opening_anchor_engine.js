'use strict';

function n(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function evaluate(candles, side, anchors = {}, options = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const last = rows[rows.length - 1];
  const levels = Object.entries(anchors)
    .map(([name, value]) => ({ name, price: n(value) }))
    .filter(row => row.price != null);
  const base = { version: '1.0', valid: false, side, levels, aligned: [], opposed: [], reclaims: [] };
  if (!last || !['LONG', 'SHORT'].includes(side) || !levels.length) {
    return { ...base, reason: 'OPENING_ANCHOR_DATA_MISSING' };
  }

  const close = n(last.c);
  const aligned = levels.filter(level => side === 'LONG' ? close >= level.price : close <= level.price);
  const opposed = levels.filter(level => !aligned.includes(level));
  const lookback = Math.max(2, Number(options.lookbackBars) || 24);
  const start = Math.max(0, rows.length - lookback);
  const reclaims = [];
  for (const level of levels) {
    for (let i = start; i < rows.length; i++) {
      const candle = rows[i];
      const reclaimed = side === 'LONG'
        ? n(candle.l) < level.price && n(candle.c) > level.price
        : n(candle.h) > level.price && n(candle.c) < level.price;
      if (reclaimed) {
        reclaims.push({ name: level.name, price: level.price, index: i, t: candle.t });
        break;
      }
    }
  }
  const minAligned = Math.min(levels.length, Number(options.minAligned) || 2);
  const valid = reclaims.length > 0 || aligned.length >= minAligned;
  return {
    ...base,
    valid,
    close,
    aligned: aligned.map(row => row.name),
    opposed: opposed.map(row => row.name),
    reclaims,
    minAligned,
    mode: reclaims.length ? 'OPEN_SWEEP_RECLAIM' : 'OPEN_FLOW_ALIGNMENT',
    reason: valid ? (reclaims.length ? 'OPENING_ANCHOR_RECLAIM' : 'OPENING_ANCHORS_ALIGNED') : 'OPENING_ANCHOR_CONFLICT'
  };
}

module.exports = { evaluate };
