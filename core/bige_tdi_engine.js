'use strict';

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const part = values.slice(i - period + 1, i + 1);
    if (part.some(v => v == null || !Number.isFinite(+v))) continue;
    out[i] = part.reduce((a, b) => a + +b, 0) / period;
  }
  return out;
}

function rsi(closes, period = 13) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period, al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function heikenAshi(candles) {
  const out = [];
  for (let i = 0; i < (candles || []).length; i++) {
    const c = candles[i];
    const close = (+c.o + +c.h + +c.l + +c.c) / 4;
    const open = i === 0 ? (+c.o + +c.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ t: c.t, o: open, c: close, h: Math.max(+c.h, open, close), l: Math.min(+c.l, open, close) });
  }
  return out;
}

function stochastic(candles, kPeriod = 8, smoothK = 3, dPeriod = 3) {
  const raw = new Array(candles.length).fill(null);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const part = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...part.map(x => +x.h));
    const low = Math.min(...part.map(x => +x.l));
    raw[i] = high === low ? 50 : 100 * (+candles[i].c - low) / (high - low);
  }
  const k = sma(raw, smoothK);
  const d = sma(k, dPeriod);
  return { k, d };
}

function evaluate(candles, options = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < 30) return { valid: false, reason: 'INSUFFICIENT_DATA' };
  const closes = rows.map(x => +x.c);
  const green = sma(rsi(closes, options.rsiPeriod || 13), 2);
  const red = sma(green, 7);
  const stoch = stochastic(rows, 8, 3, 3);
  const ha = heikenAshi(rows);
  const i = rows.length - 1;
  let crossIndex = -1, side = null;
  for (let j = Math.max(1, i - 1); j <= i; j++) {
    if (green[j] == null || red[j] == null || green[j - 1] == null || red[j - 1] == null) continue;
    if (green[j] > red[j] && green[j - 1] <= red[j - 1]) { crossIndex = j; side = 'LONG'; }
    if (green[j] < red[j] && green[j - 1] >= red[j - 1]) { crossIndex = j; side = 'SHORT'; }
  }
  if (!side) return { valid: false, reason: 'TDI_CROSS_MISSING', green: green[i], red: red[i] };
  const slope = green[i] - green[Math.max(0, i - 2)];
  const angleOk = side === 'LONG' ? slope > 0.8 : slope < -0.8;
  const stochOk = side === 'LONG' ? stoch.k[i] > stoch.d[i] && stoch.k[i] < 80 : stoch.k[i] < stoch.d[i] && stoch.k[i] > 20;
  const haOk = side === 'LONG' ? ha[i].c > ha[i].o : ha[i].c < ha[i].o;
  const valid = angleOk && stochOk && haOk;
  return {
    valid, side, crossAge: i - crossIndex,
    tdi: { green: green[i], red: red[i], slope },
    stochastic: { k: stoch.k[i], d: stoch.d[i] },
    heikenAshi: { bullish: ha[i].c > ha[i].o },
    score: [angleOk, stochOk, haOk].filter(Boolean).length * 33 + (valid ? 1 : 0),
    reason: valid ? 'BIGE_CONFIRMED' : !angleOk ? 'TDI_ANGLE_WEAK' : !stochOk ? 'STOCHASTIC_NOT_CONFIRMED' : 'HEIKEN_ASHI_NOT_CONFIRMED'
  };
}

module.exports = { sma, rsi, heikenAshi, stochastic, evaluate };
