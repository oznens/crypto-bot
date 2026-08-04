/*
 * V4.4 Backtest Intelligence Engine
 *
 * Analiz sonuçlarını performans metriklerine dönüştürmek için temel katman.
 * Canlı execution'a bağlı değildir.
 */
'use strict';

function safeNumber(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function summarize(trades) {
  trades = Array.isArray(trades) ? trades : [];

  const total = trades.length;
  const wins = trades.filter(t => safeNumber(t.resultR) > 0);
  const losses = trades.filter(t => safeNumber(t.resultR) < 0);
  const totalR = trades.reduce((a, t) => a + safeNumber(t.resultR), 0);

  return {
    trades: total,
    wins: wins.length,
    losses: losses.length,
    winrate: total ? +(wins.length / total * 100).toFixed(2) : 0,
    totalR: +totalR.toFixed(2),
    expectancy: total ? +(totalR / total).toFixed(3) : 0
  };
}

function groupBy(trades, key) {
  const out = {};
  for (const t of trades || []) {
    const k = t[key] || 'UNKNOWN';
    if (!out[k]) out[k] = [];
    out[k].push(t);
  }

  for (const k of Object.keys(out)) {
    out[k] = summarize(out[k]);
  }

  return out;
}

function analyzeDataset(trades) {
  return {
    overall: summarize(trades),
    byModel: groupBy(trades, 'model'),
    bySession: groupBy(trades, 'session'),
    bySymbol: groupBy(trades, 'symbol')
  };
}

module.exports = {
  summarize,
  groupBy,
  analyzeDataset
};
