'use strict';

function n(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function calculatePosition({ equity, riskPct, leverageCap, entry, stop }) {
  const safeEquity = Math.max(0, n(equity));
  const safeRiskPct = Math.max(0, n(riskPct));
  const safeLeverageCap = Math.max(0, n(leverageCap));
  const safeEntry = n(entry);
  const safeStop = n(stop);
  const riskDist = Math.abs(safeEntry - safeStop);

  if (!(safeEquity > 0) || !(safeRiskPct > 0) || !(safeLeverageCap > 0) ||
      !(safeEntry > 0) || !(riskDist > 0)) {
    return {
      valid: false,
      reason: 'INVALID_POSITION_INPUT',
      qty: 0,
      plannedRiskUSD: 0,
      actualRiskUSD: 0,
      riskDist
    };
  }

  const plannedRiskUSD = safeEquity * safeRiskPct;
  const riskSizedQty = plannedRiskUSD / riskDist;
  const leverageQtyCap = safeEquity * safeLeverageCap / safeEntry;
  const qty = Math.min(riskSizedQty, leverageQtyCap);
  const actualRiskUSD = qty * riskDist;

  return {
    valid: qty > 0 && actualRiskUSD > 0,
    reason: 'OK',
    qty,
    riskDist,
    plannedRiskUSD,
    actualRiskUSD,
    leverageCapped: leverageQtyCap < riskSizedQty,
    leverageQtyCap,
    riskSizedQty
  };
}

function excursionForCandle(trade, candle, options = {}) {
  const initialRiskDist = n(trade.initialRiskDist) || Math.abs(n(trade.entry) - n(trade.initialSL));
  if (!(initialRiskDist > 0)) {
    return { mfeR: n(trade.mfeR), maeR: n(trade.maeR), hitSL: false };
  }

  const long = trade.side === 'LONG';
  const high = n(candle.h);
  const low = n(candle.l);
  const entry = n(trade.entry);
  const stop = n(trade.sl, n(trade.initialSL));
  const hitSL = long ? low <= stop : high >= stop;
  const adverse = long ? entry - low : high - entry;
  const favorable = long ? high - entry : entry - low;

  const maeR = Math.max(n(trade.maeR), Math.max(0, adverse / initialRiskDist));
  const preserveConservativePath = options.stopFirst !== false && hitSL;
  const mfeR = preserveConservativePath
    ? n(trade.mfeR)
    : Math.max(n(trade.mfeR), Math.max(0, favorable / initialRiskDist));

  return { mfeR, maeR, hitSL };
}

function applyExcursion(trade, candle, options) {
  const result = excursionForCandle(trade, candle, options);
  trade.mfeR = result.mfeR;
  trade.maeR = result.maeR;
  return result;
}

function shouldRecordRiskRejection(rejections, candidate, options = {}) {
  const list = Array.isArray(rejections) ? rejections : [];
  const now = n(options.now, Date.now());
  const dedupeMs = Math.max(0, n(options.dedupeMs, 6 * 60 * 60 * 1000));
  const recent = list.find(item =>
    item &&
    item.symbol === candidate.symbol &&
    item.side === candidate.side &&
    item.tf === candidate.tf &&
    item.reason === candidate.reason
  );

  if (!recent) return true;
  const age = now - n(recent.t);
  return age < 0 || age >= dedupeMs;
}

module.exports = {
  calculatePosition,
  excursionForCandle,
  applyExcursion,
  shouldRecordRiskRejection
};
