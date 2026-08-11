'use strict';

function n(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function body(candle) {
  return Math.abs(n(candle?.c) - n(candle?.o));
}

function averageBody(candles, end, lookback) {
  const start = Math.max(0, end - lookback);
  const rows = candles.slice(start, end);
  return rows.length ? rows.reduce((sum, candle) => sum + body(candle), 0) / rows.length : 0;
}

function detectFvgs(candles, minGapPct = 0.0008) {
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const left = candles[i - 2];
    const right = candles[i];
    if (n(right.l) > n(left.h) && (n(right.l) - n(left.h)) / n(left.h) >= minGapPct) {
      out.push({ side: 'LONG', type: 'bull', from: i - 2, to: i, bottom: n(left.h), top: n(right.l), ce: (n(left.h) + n(right.l)) / 2 });
    }
    if (n(right.h) < n(left.l) && (n(left.l) - n(right.h)) / n(left.l) >= minGapPct) {
      out.push({ side: 'SHORT', type: 'bear', from: i - 2, to: i, bottom: n(right.h), top: n(left.l), ce: (n(right.h) + n(left.l)) / 2 });
    }
  }
  return out;
}

function findDisplacement(candles, manipulation, options) {
  const side = manipulation.side;
  const start = Math.max(1, n(manipulation.at));
  const end = Math.min(candles.length - 1, start + (options.maxDisplacementBars || 8));
  const multiplier = options.displacementMultiplier || 1.3;
  for (let i = start; i <= end; i++) {
    const avg = averageBody(candles, i, options.bodyLookback || 20);
    const directed = side === 'LONG' ? n(candles[i].c) > n(candles[i].o) : n(candles[i].c) < n(candles[i].o);
    if (avg > 0 && directed && body(candles[i]) >= avg * multiplier) return { index: i, t: candles[i].t, body: body(candles[i]), averageBody: avg };
  }
  return null;
}

function findRetest(candles, zone, side, startIndex, tolerance) {
  return candles.findIndex((candle, index) => index > startIndex && (
    side === 'LONG'
      ? n(candle.l) <= zone.top * (1 + tolerance) && n(candle.c) >= zone.bottom
      : n(candle.h) >= zone.bottom * (1 - tolerance) && n(candle.c) <= zone.top
  ));
}

// IOFED: setup yönünün tersindeki FVG kapanışla flip olur, ardından yeni
// destek/direnç olarak test edilir. Sadece wick geçişi flip sayılmaz.
function findIofed(candles, fvgs, side, manipulation, displacement, options = {}) {
  const tolerance = options.retestTolerancePct == null ? 0.0015 : options.retestTolerancePct;
  const searchStart = Math.max(2, n(manipulation.sweepAt) - (options.iofedLookbackBars || 12));
  const candidates = fvgs.filter(fvg => fvg.side !== side && fvg.to >= searchStart && fvg.to <= displacement.index);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const zone = candidates[i];
    const flipIndex = candles.findIndex((candle, index) => index >= displacement.index && (
      side === 'LONG' ? n(candle.c) > zone.top : n(candle.c) < zone.bottom
    ));
    if (flipIndex < displacement.index) continue;
    const retestIndex = findRetest(candles, zone, side, flipIndex, tolerance);
    if (retestIndex <= flipIndex) continue;
    const last = candles[candles.length - 1];
    const held = side === 'LONG' ? n(last.c) >= zone.ce : n(last.c) <= zone.ce;
    if (held) return { zone, flipIndex, retestIndex, held: true };
  }
  return null;
}

function classifyBreakaway(candles, fvg, side, options = {}) {
  const after = candles.slice(fvg.to + 1);
  const minBars = options.breakawayMinBars || 2;
  if (after.length < minBars) return null;
  const touched = after.some(candle => side === 'LONG' ? n(candle.l) <= fvg.top : n(candle.h) >= fvg.bottom);
  if (touched) return null;
  const last = candles[candles.length - 1];
  const gap = Math.max(fvg.top - fvg.bottom, Number.EPSILON);
  const extension = side === 'LONG' ? n(last.c) - fvg.top : fvg.bottom - n(last.c);
  if (extension < gap * (options.breakawayExtension || 1)) return null;
  return { confirmed: true, barsUntouched: after.length, extensionInGaps: extension / gap, zone: fvg };
}

function evaluate(candles, analysis, options = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const manipulation = analysis?.structures?.manipulation || analysis?.manipulation || null;
  const side = analysis?.setup?.side || manipulation?.side || null;
  const base = { version: '1.1', side, valid: false, entryArmed: false };
  if (rows.length < 30) return { ...base, state: 'INSUFFICIENT_DATA', reason: 'INSUFFICIENT_CANDLES' };
  if (!manipulation || !side || manipulation.at == null || manipulation.sweepAt == null) {
    return { ...base, state: 'WAITING_MANIPULATION', reason: 'MANIPULATION_MISSING' };
  }
  if (side !== manipulation.side) return { ...base, state: 'DIRECTION_CONFLICT', reason: 'SETUP_MANIPULATION_CONFLICT', manipulation };

  const displacement = findDisplacement(rows, manipulation, options);
  if (!displacement) return { ...base, state: 'WAITING_DISPLACEMENT', reason: 'POST_RECLAIM_DISPLACEMENT_MISSING', manipulation };

  const allFvgs = detectFvgs(rows, options.minGapPct);
  const firstFvg = allFvgs
    .find(fvg => fvg.side === side && fvg.to >= displacement.index && fvg.to <= displacement.index + (options.maxFvgBars || 4));
  const iofed = findIofed(rows, allFvgs, side, manipulation, displacement, options);
  if (!firstFvg && !iofed) return { ...base, state: 'WAITING_FIRST_FVG', reason: 'FIRST_PRESENTED_FVG_MISSING', manipulation, displacement };

  if (iofed && !firstFvg) {
    return {
      ...base,
      valid: true,
      entryArmed: true,
      state: 'ENTRY_ARMED',
      reason: 'IOFED_RETEST_CONFIRMED',
      entryModel: 'IOFED',
      manipulation,
      displacement,
      iofed,
      retestIndex: iofed.retestIndex,
      held: iofed.held
    };
  }

  const after = rows.slice(firstFvg.to + 1);
  const invalidated = after.some(candle => side === 'LONG' ? n(candle.c) < firstFvg.bottom : n(candle.c) > firstFvg.top);
  if (invalidated) return { ...base, state: 'FVG_INVALIDATED', reason: 'FIRST_PRESENTED_FVG_INVALIDATED', manipulation, displacement, firstFvg };

  const tolerance = options.retestTolerancePct == null ? 0.0015 : options.retestTolerancePct;
  const retestIndex = findRetest(rows, firstFvg, side, firstFvg.to, tolerance);
  const retested = retestIndex > firstFvg.to;
  const last = rows[rows.length - 1];
  const held = side === 'LONG' ? n(last.c) >= firstFvg.ce : n(last.c) <= firstFvg.ce;
  const firstFvgArmed = retested && held;
  const entryArmed = firstFvgArmed || !!iofed;
  const breakaway = !retested ? classifyBreakaway(rows, firstFvg, side, options) : null;
  const entryModel = firstFvgArmed ? 'FIRST_PRESENTED_FVG' : (iofed ? 'IOFED' : (breakaway ? 'BREAKAWAY_GAP' : null));
  return {
    ...base,
    valid: entryArmed,
    entryArmed,
    state: entryArmed ? 'ENTRY_ARMED' : (breakaway ? 'BREAKAWAY_GAP_CONFIRMED' : 'WAITING_FVG_RETEST'),
    reason: firstFvgArmed ? 'DREYKO_SEQUENCE_CONFIRMED' : (iofed ? 'IOFED_RETEST_CONFIRMED' : (breakaway ? 'WAITING_LOW_RISK_ENTRY' : 'FIRST_PRESENTED_FVG_RETEST_MISSING')),
    entryModel,
    manipulation,
    displacement,
    firstFvg,
    iofed,
    breakaway,
    retestIndex: firstFvgArmed ? retestIndex : (iofed?.retestIndex ?? null),
    held: firstFvgArmed ? held : !!iofed?.held
  };
}

module.exports = { averageBody, detectFvgs, findDisplacement, findIofed, classifyBreakaway, evaluate };
