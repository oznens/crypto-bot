'use strict';

const Ranking = require('./strategy_ranking_engine');
const Decay = require('./strategy_decay_engine');
const Robustness = require('./strategy_robustness_engine');
const Stability = require('./parameter_stability_engine');

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

function chunkExpectancies(trades, chunks = 5) {
  const rows = [...(trades || [])].sort((a, b) => Number(a.closedAt || 0) - Number(b.closedAt || 0));
  if (!rows.length) return [];
  const size = Math.max(1, Math.floor(rows.length / chunks));
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    const expectancy = part.reduce((sum, trade) => sum + Number(trade.resultR ?? trade.r ?? 0), 0) / part.length;
    out.push({ score: expectancy });
  }
  return out.slice(0, chunks);
}

function buildAllocation(trades, options = {}) {
  const rows = Array.isArray(trades) ? trades : [];
  const modelKey = options.modelKey || 'model';
  const groups = new Map();
  for (const trade of rows) {
    const model = trade?.[modelKey] || 'UNKNOWN';
    if (!groups.has(model)) groups.set(model, []);
    groups.get(model).push(trade);
  }

  const rankings = Ranking.rankStrategies(rows, options);
  const enriched = rankings.map(row => {
    const modelTrades = groups.get(row.model) || [];
    const decay = Decay.evaluate(modelTrades, options.decay || {});
    const robustness = Robustness.evaluate(modelTrades, options.robustness || {});
    const stability = Stability.evaluate(chunkExpectancies(modelTrades, options.stabilityChunks || 5), options.stability || {});
    let status = classify(row, options);

    if (decay.status === 'DECAY_SEVERE' || robustness.status === 'FRAGILE') status = 'PAUSED';
    else if (
      (decay.status === 'DECAY_WARNING' || robustness.status === 'CAUTION' || stability.status === 'FRAGILE') &&
      status === 'ACTIVE'
    ) status = 'WATCH';

    const reason = decay.status === 'DECAY_SEVERE'
      ? 'yakın dönem performansı ciddi biçimde bozuldu'
      : robustness.status === 'FRAGILE'
        ? 'Monte Carlo stresinde strateji kırılgan'
        : decay.status === 'DECAY_WARNING'
          ? 'yakın dönem performans zayıflaması izleniyor'
          : robustness.status === 'CAUTION'
            ? 'Monte Carlo sonucu temkinli risk gerektiriyor'
            : stability.status === 'FRAGILE'
              ? 'dönemler arası performans kararsız'
              : status === 'PAUSED'
                ? 'negatif beklenti veya yüksek düşüş'
                : status === 'WATCH'
                  ? (row.trades < (Number(options.minTrades) || 20) ? 'örneklem yetersiz' : 'dayanıklılık teyidi bekleniyor')
                  : 'performans, dayanıklılık ve istikrar uygun';

    return {
      ...row,
      decay,
      robustness,
      stability,
      status,
      riskMultiplier: riskMultiplier(row, status),
      reason
    };
  });

  const active = enriched.filter(row => row.status === 'ACTIVE');
  const total = active.reduce((sum, row) => sum + row.riskMultiplier, 0);
  const allocations = enriched.map(row => ({
    ...row,
    portfolioWeightPct: row.status === 'ACTIVE' && total > 0
      ? +((row.riskMultiplier / total) * 100).toFixed(2)
      : 0
  }));

  return {
    version: '24.0',
    generatedAt: Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now(),
    modelKey,
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

module.exports = { clamp, classify, riskMultiplier, chunkExpectancies, buildAllocation, multiplierFor };
