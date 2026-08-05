'use strict';

function swings(candles, lookback = 20) {
  const rows = (candles || []).slice(-lookback);
  if (!rows.length) return null;
  return {
    high: Math.max(...rows.map(x => +x.h)),
    low: Math.min(...rows.map(x => +x.l)),
    last: +rows[rows.length - 1].c,
    previousHigh: Math.max(...rows.slice(0, -1).map(x => +x.h)),
    previousLow: Math.min(...rows.slice(0, -1).map(x => +x.l))
  };
}

function evaluate(primary, peer, side, options = {}) {
  const a = swings(primary, options.lookback || 20);
  const b = swings(peer, options.lookback || 20);
  if (!a || !b) return { available: false, confirmed: false, reason: 'PEER_DATA_MISSING', score: 0 };

  const aTookHigh = a.high > a.previousHigh;
  const bTookHigh = b.high > b.previousHigh;
  const aTookLow = a.low < a.previousLow;
  const bTookLow = b.low < b.previousLow;
  const bearish = aTookHigh !== bTookHigh;
  const bullish = aTookLow !== bTookLow;
  const confirmed = side === 'LONG' ? bullish : side === 'SHORT' ? bearish : false;
  return {
    available: true,
    confirmed,
    divergence: bullish ? 'BULLISH_SMT' : bearish ? 'BEARISH_SMT' : 'NONE',
    reason: confirmed ? 'SMT_CONFIRMED' : 'SMT_NOT_CONFIRMED',
    score: confirmed ? 100 : (bullish || bearish ? 35 : 50),
    primary: a,
    peer: b
  };
}

module.exports = { swings, evaluate };
