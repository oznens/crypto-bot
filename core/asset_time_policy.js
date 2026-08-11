'use strict';

function classify(symbol) {
  const normalized = String(symbol || '').toUpperCase().replace(/[_\-/]/g, '');
  if (/(USDT|USDC|BTC|ETH)$/.test(normalized)) return 'CRYPTO';
  if (/^(NQ|ES|YM|RTY|SPX|NDX|DJI)/.test(normalized)) return 'INDEX';
  if (/^(DXY|EURUSD|GBPUSD|USDJPY|AUDUSD|USDCAD|USDCHF|NZDUSD)/.test(normalized)) return 'FX';
  return 'OTHER';
}

function nyParts(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function openingAnchors(candles) {
  const rows = Array.isArray(candles) ? candles : [];
  const last = rows[rows.length - 1];
  if (!last) return { daily: null, weekly: null, monthly: null };
  const date = new Date(last.t);
  const day = date.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const dayNumber = (date.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - dayNumber)).toISOString().slice(0, 10);
  const first = predicate => rows.find(candle => predicate(new Date(candle.t)))?.o ?? null;
  return {
    daily: first(d => d.toISOString().slice(0, 10) === day),
    weekly: first(d => d.toISOString().slice(0, 10) >= monday),
    monthly: first(d => d.toISOString().slice(0, 7) === month)
  };
}

function evaluate(symbol, candles, timestamp) {
  const assetClass = classify(symbol);
  const now = timestamp == null ? candles?.[candles.length - 1]?.t || Date.now() : timestamp;
  const anchors = openingAnchors(candles);
  if (assetClass === 'CRYPTO') return { allowed: true, assetClass, mode: 'CRYPTO_JUDAS', anchors, reason: 'CRYPTO_HTF_TIME_POLICY' };
  const ny = nyParts(now);
  const minutes = Number(ny.hour) * 60 + Number(ny.minute);
  const weekday = !['Sat', 'Sun'].includes(ny.weekday);
  if (assetClass === 'INDEX') {
    const allowed = weekday && minutes >= 9 * 60 + 30 && minutes <= 13 * 60;
    return { allowed, assetClass, mode: 'NEW_YORK_AM', anchors, reason: allowed ? 'INDEX_NY_WINDOW' : 'OUTSIDE_INDEX_NY_WINDOW' };
  }
  if (assetClass === 'FX') {
    const allowed = weekday && ((minutes >= 2 * 60 && minutes <= 5 * 60) || (minutes >= 7 * 60 && minutes <= 11 * 60));
    return { allowed, assetClass, mode: 'LONDON_OR_NEW_YORK', anchors, reason: allowed ? 'FX_MACRO_WINDOW' : 'OUTSIDE_FX_MACRO_WINDOW' };
  }
  return { allowed: true, assetClass, mode: 'UNRESTRICTED', anchors, reason: 'NO_ASSET_TIME_RESTRICTION' };
}

module.exports = { classify, nyParts, openingAnchors, evaluate };
