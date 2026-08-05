'use strict';

const Ranking = require('./strategy_ranking_engine');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function classify(row, options = {}) {
  const minTrades = Number.isFinite(Number(options.minTrades)) ? Number(options.minTrades) : 20;
  const pauseExpectancy = Number.isFinite(Number(options.pauseExpectancy)) ? Number(options.pauseExpectancy) : -0.05;
  const pauseDrawdownR = Number.isFinite(Number(options.pauseDrawdownR)) ? Number(options.pauseDrawdownR) : 8;

  if (row.trades < minTrades) return 'WATCH';
  if (row.expectancy <= pauseExpectancy || row.maxDrawdownR >= pauseDrawdownR) return 'PAUSED';
  if (!row.walkForward?.robust && row.score < 55) return 'WATCH';
  return 'ACTIVE';
}

function riskMultiplier(row, status) {
  if (status === 'PAUSED') return 0;
  if (status === 'WATCH') return 0.5;

  const scoreComponent = clamp((row.score - 50) / 50, 0, 1);
  const expectancyComponent = clamp((row.expectancy + 0.05) / 0.55, 0, 1);
  const robustnessBonus = row.walkForward?.robust ? 0.1 : 0;
  return +clamp(0.7 + scoreComponent * 0.35 + expectancyComponent * 0.2 + robustnessBonus, 0.7, 1.25).toFixed(2);
}

function buildAllocation(trades, options = {}) {
  const rankings = Ranking.rankStrategies(trades, options);
  const rows = rankings.map(row => {
    const status = classify(row, options);
    return {
      ...row,
      status,
      riskMultiplier: riskMultiplier(row, status),
      reason: status === 'PAUSED'
        ? 'negatif beklenti veya yüksek düşüş'
        : status === 'WATCH'
          ? (row.trades < (Number(options.minTrades) || 20) ? 'örneklem yetersiz' : 'dayanıklılık teyidi bekleniyor')
          : 'performans ve dayanıklılık uygun'
    };
  });

  const active = rows.filter(row => row.status === 'ACTIVE');
  const total = active.reduce((sum, row) => sum + row.riskMultiplier, 0);
  const allocations = rows.map(row => ({
    ...row,
    portfolioWeightPct: row.status === 'ACTIVE' && total > 0
      ? +((row.riskMultiplier / total) * 100).toFixed(2)
      : 0
  }));

  return {
    version: '7.0',
    generatedAt: Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now(),
    modelKey: options.modelKey || 'model',
    minTrades: Number.isFinite(Number(options.minTrades)) ? Number(options.minTrades) : 20,
    activeCount: allocations.filter(row => row.status === 'ACTIVE').length,
    watchCount: allocations.filter(row => row.status === 'WATCH').length,
    pausedCount: allocations.filter(row => row.status === 'PAUSED').length,
    allocations
  };
}

function multiplierFor(allocation, model) {
  const row = allocation?.allocations?.find(item => item.model === model);
  return row ? row.riskMultiplier : 0.5;
}

module.exports = { clamp, classify, riskMultiplier, buildAllocation, multiplierFor };
