"use strict";

// Performance engine foundation
// Trade journal verileri geldikçe setup/session/model istatistikleri çıkarır.

function groupBy(list, keyFn) {
  const out = {};
  for (const item of list || []) {
    const key = keyFn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

function stats(trades) {
  const arr = trades || [];
  const wins = arr.filter(t => Number(t.resultR) > 0);
  const losses = arr.filter(t => Number(t.resultR) < 0);
  const totalR = arr.reduce((s, t) => s + (Number(t.resultR) || 0), 0);
  return {
    trades: arr.length,
    winrate: arr.length ? +(wins.length / arr.length * 100).toFixed(2) : 0,
    totalR: +totalR.toFixed(2),
    avgR: arr.length ? +(totalR / arr.length).toFixed(3) : 0,
    losses: losses.length
  };
}

function analyzeTrades(trades) {
  const byModel = groupBy(trades, t => t.model || "unknown");
  const bySession = groupBy(trades, t => t.session || "unknown");

  return {
    overall: stats(trades),
    models: Object.fromEntries(Object.entries(byModel).map(([k,v]) => [k, stats(v)])),
    sessions: Object.fromEntries(Object.entries(bySession).map(([k,v]) => [k, stats(v)]))
  };
}

module.exports = { stats, analyzeTrades };
