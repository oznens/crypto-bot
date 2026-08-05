'use strict';

const WINDOWS_NY = {
  LONDON: [2, 5],
  NEW_YORK_AM: [7, 11],
  SILVER_BULLET_AM: [10, 11],
  SILVER_BULLET_PM: [14, 15],
  ASIA: [19, 24]
};

function nyHour(timestamp) {
  return +new Date(timestamp).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false
  });
}

function sessionFor(timestamp) {
  const h = nyHour(timestamp);
  for (const [name, [from, to]] of Object.entries(WINDOWS_NY)) {
    if (h >= from && h < to) return name;
  }
  return 'OFF_SESSION';
}

function detectFvgs(candles) {
  const out = [];
  for (let i = 2; i < (candles || []).length; i++) {
    const a = candles[i - 2], c = candles[i];
    if (c.l > a.h) out.push({ side: 'LONG', from: a.h, to: c.l, at: c.t, index: i });
    if (c.h < a.l) out.push({ side: 'SHORT', from: c.h, to: a.l, at: c.t, index: i });
  }
  return out;
}

function evaluate(candles, side, options = {}) {
  const list = Array.isArray(candles) ? candles : [];
  if (list.length < 3) return { valid: false, reason: 'INSUFFICIENT_CANDLES', score: 0 };
  const last = list[list.length - 1];
  const session = sessionFor(last.t);
  const active = session !== 'OFF_SESSION';
  const fvg = detectFvgs(list).filter(x => x.side === side).slice(-1)[0] || null;
  const ageBars = fvg ? list.length - 1 - fvg.index : null;
  const maxAgeBars = Number.isFinite(+options.maxAgeBars) ? +options.maxAgeBars : 24;
  const fresh = !!fvg && ageBars <= maxAgeBars;
  const score = Math.round((active ? 45 : 0) + (fresh ? 45 : 0) + (session.startsWith('SILVER_BULLET') ? 10 : 0));
  return {
    valid: active && fresh,
    reason: !active ? 'OUTSIDE_KILLZONE' : !fvg ? 'FVG_MISSING' : !fresh ? 'FVG_STALE' : 'KILLZONE_FVG_CONFIRMED',
    session, fvg, ageBars, score
  };
}

module.exports = { WINDOWS_NY, nyHour, sessionFor, detectFvgs, evaluate };
