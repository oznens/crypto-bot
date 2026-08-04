/*
 * V4.6 Strategy Ranking Engine
 *
 * Modelleri sadece toplam R ile değil; expectancy, profit factor,
 * drawdown, örneklem büyüklüğü ve walk-forward dayanıklılığıyla sıralar.
 */
'use strict';

const { validate } = require('./walk_forward_engine');

function n(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function maxDrawdownR(trades) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;

  for (const trade of trades || []) {
    equity += n(trade.resultR);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  return +maxDd.toFixed(3);
}

function profitFactor(trades) {
  let grossWin = 0;
  let grossLoss = 0;

  for (const trade of trades || []) {
    const r = n(trade.resultR);
    if (r > 0) grossWin += r;
    if (r < 0) grossLoss += Math.abs(r);
  }

  if (grossLoss === 0) return grossWin > 0 ? 99 : 0;
  return +(grossWin / grossLoss).toFixed(3);
}

function modelMetrics(trades) {
  trades = Array.isArray(trades) ? trades : [];
  const count = trades.length;
  const wins = trades.filter(t => n(t.resultR) > 0).length;
  const totalR = trades.reduce((sum, t) => sum + n(t.resultR), 0);
  const expectancy = count ? totalR / count : 0;
  const wf = validate(trades, 0.7);

  return {
    trades: count,
    winrate: count ? +(wins / count * 100).toFixed(2) : 0,
    totalR: +totalR.toFixed(3),
    expectancy: +expectancy.toFixed(4),
    profitFactor: profitFactor(trades),
    maxDrawdownR: maxDrawdownR(trades),
    walkForward: wf
  };
}

function scoreMetrics(m) {
  const expectancyScore = clamp((m.expectancy + 0.25) / 1.25 * 30, 0, 30);
  const pfScore = clamp((m.profitFactor - 0.8) / 1.7 * 25, 0, 25);
  const ddScore = clamp((10 - m.maxDrawdownR) / 10 * 20, 0, 20);
  const sampleScore = clamp(m.trades / 100 * 15, 0, 15);
  const wfScore = m.walkForward.robust
    ? clamp((m.walkForward.test.avgR + 0.1) / 0.6 * 10, 2, 10)
    : 0;

  return Math.round(expectancyScore + pfScore + ddScore + sampleScore + wfScore);
}

function rankStrategies(trades, options) {
  trades = Array.isArray(trades) ? trades : [];
  options = options || {};
  const modelKey = options.modelKey || 'model';
  const minTrades = Number.isFinite(Number(options.minTrades)) ? Number(options.minTrades) : 20;
  const groups = new Map();

  for (const trade of trades) {
    const model = trade[modelKey] || 'UNKNOWN';
    if (!groups.has(model)) groups.set(model, []);
    groups.get(model).push(trade);
  }

  const ranked = [];
  for (const [model, rows] of groups.entries()) {
    const metrics = modelMetrics(rows);
    ranked.push({
      model,
      eligible: metrics.trades >= minTrades,
      score: metrics.trades >= minTrades ? scoreMetrics(metrics) : 0,
      ...metrics
    });
  }

  return ranked.sort((a, b) =>
    (Number(b.eligible) - Number(a.eligible)) ||
    (b.score - a.score) ||
    (b.expectancy - a.expectancy)
  );
}

function bestStrategy(trades, options) {
  return rankStrategies(trades, options).find(x => x.eligible) || null;
}

module.exports = {
  maxDrawdownR,
  profitFactor,
  modelMetrics,
  scoreMetrics,
  rankStrategies,
  bestStrategy
};
