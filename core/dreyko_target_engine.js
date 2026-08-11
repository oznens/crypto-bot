'use strict';

const LiquidityMap = require('./liquidity_map_engine');

function n(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function evaluate(input = {}, options = {}) {
  const candles = Array.isArray(input.candles) ? input.candles : [];
  const side = input.side;
  const entry = n(input.entry);
  const stop = n(input.stop);
  const minTouches = Number.isFinite(+options.minTouches) ? +options.minTouches : 2;
  const minGrossRR = Number.isFinite(+options.minGrossRR) ? +options.minGrossRR : 1;
  const base = { version: '1.0', valid: false, side, entry, stop, minTouches, minGrossRR };
  if (!['LONG', 'SHORT'].includes(side) || entry == null || stop == null || candles.length < 10) {
    return { ...base, reason: 'TARGET_INPUT_INVALID' };
  }
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || (side === 'LONG' ? stop >= entry : stop <= entry)) {
    return { ...base, reason: 'TARGET_GEOMETRY_INVALID' };
  }

  const map = LiquidityMap.build(candles, options);
  const pools = side === 'LONG' ? map.buySide : map.sellSide;
  const candidates = (pools || [])
    .filter(pool => pool.touches >= minTouches)
    .filter(pool => side === 'LONG' ? pool.price > entry : pool.price < entry)
    .map(pool => ({
      price: pool.price,
      source: 'OPPOSING_LIQUIDITY_POOL',
      touches: pool.touches,
      grossRR: Math.abs(pool.price - entry) / risk
    }))
    .filter(row => row.grossRR >= minGrossRR)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));

  const target = candidates[0] || null;
  return {
    ...base,
    valid: !!target,
    reason: target ? 'DRAW_ON_LIQUIDITY_FOUND' : 'DRAW_ON_LIQUIDITY_MISSING',
    target,
    candidateCount: candidates.length
  };
}

module.exports = { evaluate };
