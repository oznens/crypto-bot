'use strict';

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function decide(trade, candle, context = {}) {
  const risk = n(trade.initialRiskDist) || Math.abs(n(trade.entry) - n(trade.initialSL, trade.sl));
  if (!(risk > 0)) return { action:'HOLD', reason:'INVALID_RISK', stop:trade.sl };
  const long = trade.side === 'LONG';
  const favorable = long ? n(candle.h)-n(trade.entry) : n(trade.entry)-n(candle.l);
  const currentR = favorable / risk;
  const ageHours = Math.max(0, (n(candle.t, Date.now()) - n(trade.openedAt, Date.now())) / 3600000);
  const regime = context.regime || trade.regime || 'UNKNOWN';

  if (currentR >= 2.5) {
    const stop = long ? n(trade.entry) + risk : n(trade.entry) - risk;
    return { action:'TRAIL', reason:'LOCK_1R_AFTER_2_5R', stop, currentR, ageHours };
  }
  if (currentR >= 1 && !trade.deriskDone) {
    return { action:'BREAKEVEN', reason:'PROTECT_AFTER_1R', stop:n(trade.entry), currentR, ageHours };
  }
  if (ageHours >= 24 && currentR < 0.5) {
    const stop = long ? Math.max(n(trade.sl), n(trade.entry)-risk*0.35) : Math.min(n(trade.sl), n(trade.entry)+risk*0.35);
    return { action:'TIGHTEN', reason:'TIME_DECAY', stop, currentR, ageHours };
  }
  if ((regime === 'RANGE' || regime === 'HIGH_VOLATILITY') && currentR >= 0.75) {
    const stop = long ? n(trade.entry)-risk*0.1 : n(trade.entry)+risk*0.1;
    return { action:'TIGHTEN', reason:'REGIME_PROTECTION', stop, currentR, ageHours };
  }
  return { action:'HOLD', reason:'NO_EXIT_CHANGE', stop:trade.sl, currentR, ageHours };
}

function apply(trade, candle, context) {
  const decision = decide(trade, candle, context);
  if (decision.action !== 'HOLD' && Number.isFinite(+decision.stop)) {
    const long = trade.side === 'LONG';
    trade.sl = long ? Math.max(n(trade.sl), +decision.stop) : Math.min(n(trade.sl), +decision.stop);
    trade.adaptiveExit = { ...decision, appliedAt:n(candle.t, Date.now()), stop:trade.sl };
  }
  return decision;
}

module.exports = { decide, apply };
