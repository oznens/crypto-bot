'use strict';

function fvgs(candles) {
  const out = [];
  for (let i = 2; i < (candles || []).length; i++) {
    const a = candles[i - 2], c = candles[i];
    if (+c.l > +a.h) out.push({ side: 'LONG', bottom: +a.h, top: +c.l, at: i });
    if (+c.h < +a.l) out.push({ side: 'SHORT', bottom: +c.h, top: +a.l, at: i });
  }
  return out;
}

function breakers(candles, lookback = 30) {
  const rows = Array.isArray(candles) ? candles : [];
  const out = [];
  for (let i = Math.max(3, rows.length - lookback); i < rows.length; i++) {
    const prior = rows.slice(Math.max(0, i - 12), i);
    const priorHigh = Math.max(...prior.map(x => +x.h));
    const priorLow = Math.min(...prior.map(x => +x.l));
    const c = rows[i];
    if (+c.c > priorHigh) {
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        if (+rows[j].c < +rows[j].o) {
          out.push({ side: 'LONG', bottom: +rows[j].l, top: Math.max(+rows[j].o, +rows[j].h), from: j, breakAt: i });
          break;
        }
      }
    }
    if (+c.c < priorLow) {
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        if (+rows[j].c > +rows[j].o) {
          out.push({ side: 'SHORT', bottom: Math.min(+rows[j].o, +rows[j].l), top: +rows[j].h, from: j, breakAt: i });
          break;
        }
      }
    }
  }
  return out;
}

function overlap(a, b) {
  const bottom = Math.max(+a.bottom, +b.bottom);
  const top = Math.min(+a.top, +b.top);
  return top > bottom ? { bottom, top, mid: (bottom + top) / 2 } : null;
}

function evaluate(candles, side) {
  const fs = fvgs(candles).filter(x => x.side === side);
  const bs = breakers(candles).filter(x => x.side === side);
  let best = null;
  for (const fvg of fs) {
    for (const breaker of bs) {
      if (breaker.breakAt > fvg.at + 8 || fvg.at > breaker.breakAt + 8) continue;
      const zone = overlap(fvg, breaker);
      if (!zone) continue;
      const recency = Math.max(fvg.at, breaker.breakAt);
      if (!best || recency > best.recency) best = { fvg, breaker, zone, recency };
    }
  }
  if (!best) return { valid: false, side, reason: 'UNICORN_OVERLAP_MISSING' };
  const last = candles[candles.length - 1];
  const touched = side === 'LONG'
    ? +last.l <= best.zone.top && +last.c >= best.zone.bottom
    : +last.h >= best.zone.bottom && +last.c <= best.zone.top;
  return {
    valid: touched,
    side,
    zone: best.zone,
    fvg: best.fvg,
    breaker: best.breaker,
    touched,
    score: touched ? 100 : 70,
    reason: touched ? 'UNICORN_RETEST_CONFIRMED' : 'UNICORN_WAITING_RETEST'
  };
}

module.exports = { fvgs, breakers, overlap, evaluate };
