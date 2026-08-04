'use strict';

function n(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : 0;
}

function tradeR(trade) {
  if (!trade) return 0;
  return n(trade.resultR != null ? trade.resultR : trade.r);
}

function groupBy(list, keyFn) {
  const out = {};
  for (const item of list || []) {
    const key = String(keyFn(item) || 'UNKNOWN');
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

function maxDrawdownR(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades || []) {
    equity += tradeR(trade);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return +maxDrawdown.toFixed(3);
}

function profitFactor(trades) {
  let grossWin = 0;
  let grossLoss = 0;
  for (const trade of trades || []) {
    const r = tradeR(trade);
    if (r > 0) grossWin += r;
    if (r < 0) grossLoss += Math.abs(r);
  }
  if (!grossLoss) return grossWin > 0 ? 99 : 0;
  return +(grossWin / grossLoss).toFixed(3);
}

function average(values) {
  const clean = (values || []).map(n).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function stats(trades) {
  const rows = Array.isArray(trades) ? trades : [];
  const wins = rows.filter(trade => tradeR(trade) > 0);
  const losses = rows.filter(trade => tradeR(trade) < 0);
  const breakeven = rows.length - wins.length - losses.length;
  const totalR = rows.reduce((sum, trade) => sum + tradeR(trade), 0);
  const avgWinR = average(wins.map(tradeR));
  const avgLossR = average(losses.map(tradeR));

  return {
    trades: rows.length,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    winrate: rows.length ? +(wins.length / rows.length * 100).toFixed(2) : 0,
    totalR: +totalR.toFixed(3),
    avgR: rows.length ? +(totalR / rows.length).toFixed(4) : 0,
    avgWinR: +avgWinR.toFixed(3),
    avgLossR: +avgLossR.toFixed(3),
    profitFactor: profitFactor(rows),
    maxDrawdownR: maxDrawdownR(rows),
    avgMfeR: +average(rows.map(trade => trade.mfeR)).toFixed(3),
    avgMaeR: +average(rows.map(trade => trade.maeR)).toFixed(3)
  };
}

function summarizeGroups(trades, keyFn) {
  const groups = groupBy(trades, keyFn);
  return Object.fromEntries(
    Object.entries(groups)
      .map(([key, rows]) => [key, stats(rows)])
      .sort((a, b) => b[1].trades - a[1].trades)
  );
}

function analyzeTrades(trades) {
  const rows = Array.isArray(trades) ? trades : [];
  return {
    overall: stats(rows),
    models: summarizeGroups(rows, trade => trade.model),
    sessions: summarizeGroups(rows, trade => trade.session),
    regimes: summarizeGroups(rows, trade => trade.regime),
    timeframes: summarizeGroups(rows, trade => trade.tf || trade.timeframe),
    sides: summarizeGroups(rows, trade => trade.side),
    grades: summarizeGroups(rows, trade => trade.grade)
  };
}

module.exports = {
  tradeR,
  groupBy,
  maxDrawdownR,
  profitFactor,
  stats,
  analyzeTrades
};
