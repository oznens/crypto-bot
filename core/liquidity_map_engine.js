'use strict';

function near(a, b, tolerancePct) {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / base <= tolerancePct;
}

function pivots(candles, span = 2) {
  const rows = Array.isArray(candles) ? candles : [];
  const highs = [], lows = [];
  for (let i = span; i < rows.length - span; i++) {
    const win = rows.slice(i - span, i + span + 1);
    if (rows[i].h === Math.max(...win.map(x => +x.h))) highs.push({ price:+rows[i].h, t:rows[i].t, index:i });
    if (rows[i].l === Math.min(...win.map(x => +x.l))) lows.push({ price:+rows[i].l, t:rows[i].t, index:i });
  }
  return { highs, lows };
}

function cluster(levels, tolerancePct = 0.0015) {
  const groups = [];
  for (const level of levels || []) {
    const group = groups.find(g => near(g.price, level.price, tolerancePct));
    if (group) {
      group.items.push(level);
      group.price = group.items.reduce((s,x)=>s+x.price,0) / group.items.length;
    } else groups.push({ price:level.price, items:[level] });
  }
  return groups.map(g => ({ price:+g.price.toFixed(8), touches:g.items.length, first:g.items[0].t, last:g.items[g.items.length-1].t }));
}

function build(candles, options = {}) {
  const p = pivots(candles, options.span || 2);
  return {
    buySide: cluster(p.highs, options.tolerancePct),
    sellSide: cluster(p.lows, options.tolerancePct)
  };
}

function chooseTarget(map, side, entry, options = {}) {
  const minTouches = Number.isFinite(+options.minTouches) ? +options.minTouches : 2;
  const levels = side === 'LONG' ? map?.buySide : map?.sellSide;
  const valid = (levels || []).filter(x => x.touches >= minTouches)
    .filter(x => side === 'LONG' ? x.price > entry : x.price < entry)
    .sort((a,b) => Math.abs(a.price-entry)-Math.abs(b.price-entry));
  const target = valid[0] || null;
  return {
    valid: !!target,
    target,
    reason: target ? 'LIQUIDITY_TARGET_FOUND' : 'LIQUIDITY_TARGET_MISSING'
  };
}

module.exports = { near, pivots, cluster, build, chooseTarget };
