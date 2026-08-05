'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}

function crt(candles) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < 3) return { valid:false, reason:'INSUFFICIENT_DATA' };
  const range = rows[rows.length-2];
  const trigger = rows[rows.length-1];
  const bullish = n(trigger.l) < n(range.l) && n(trigger.c) > n(range.l) && n(trigger.c) <= n(range.h);
  const bearish = n(trigger.h) > n(range.h) && n(trigger.c) < n(range.h) && n(trigger.c) >= n(range.l);
  return {
    valid: bullish || bearish,
    side: bullish ? 'LONG' : bearish ? 'SHORT' : null,
    rangeHigh:n(range.h), rangeLow:n(range.l),
    reason: bullish || bearish ? 'CRT_RECLAIM' : 'CRT_MISSING'
  };
}

function turtleSoup(candles, lookback = 20) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < lookback + 1) return { valid:false, reason:'INSUFFICIENT_DATA' };
  const prior = rows.slice(-(lookback+1),-1);
  const last = rows[rows.length-1];
  const high = Math.max(...prior.map(x=>n(x.h)));
  const low = Math.min(...prior.map(x=>n(x.l)));
  const bullish = n(last.l) < low && n(last.c) > low;
  const bearish = n(last.h) > high && n(last.c) < high;
  return { valid:bullish||bearish, side:bullish?'LONG':bearish?'SHORT':null, high, low, reason:bullish||bearish?'TURTLE_SOUP_SWEEP':'NO_SWEEP' };
}

function ote(candles, side, lookback = 30) {
  const rows = (candles || []).slice(-lookback);
  if (rows.length < 5) return { valid:false, reason:'INSUFFICIENT_DATA' };
  const high = Math.max(...rows.map(x=>n(x.h)));
  const low = Math.min(...rows.map(x=>n(x.l)));
  const last = n(rows[rows.length-1].c);
  const range = high-low;
  if (!(range>0)) return { valid:false, reason:'FLAT_RANGE' };
  const retracement = side === 'LONG' ? (high-last)/range : (last-low)/range;
  const valid = retracement >= 0.62 && retracement <= 0.79;
  return { valid, side, retracement:+retracement.toFixed(3), zone:[0.62,0.79], high, low, reason:valid?'OTE_ZONE':'OUTSIDE_OTE' };
}

function po3(candles, lookback = 24) {
  const rows = (candles || []).slice(-lookback);
  if (rows.length < 8) return { valid:false, reason:'INSUFFICIENT_DATA' };
  const acc = rows.slice(0, Math.floor(rows.length*0.5));
  const later = rows.slice(acc.length);
  const high = Math.max(...acc.map(x=>n(x.h)));
  const low = Math.min(...acc.map(x=>n(x.l)));
  const sweepLow = later.some(x=>n(x.l)<low);
  const sweepHigh = later.some(x=>n(x.h)>high);
  const last = n(rows[rows.length-1].c);
  const bullish = sweepLow && last > high;
  const bearish = sweepHigh && last < low;
  return { valid:bullish||bearish, side:bullish?'LONG':bearish?'SHORT':null, accumulation:{high,low}, manipulation:sweepLow?'SELL_SIDE_SWEEP':sweepHigh?'BUY_SIDE_SWEEP':null, reason:bullish||bearish?'PO3_DISTRIBUTION_CONFIRMED':'PO3_INCOMPLETE' };
}

function evaluate(candles, side) {
  const patterns = { crt:crt(candles), turtleSoup:turtleSoup(candles), ote:ote(candles,side), po3:po3(candles) };
  const confirmed = Object.values(patterns).filter(x=>x.valid && (!x.side || x.side===side));
  return { version:'17.0', side, score:confirmed.length*25, confirmed:confirmed.length, valid:confirmed.length>=1, patterns };
}

module.exports = { crt, turtleSoup, ote, po3, evaluate };
