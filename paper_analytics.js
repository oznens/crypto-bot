'use strict';

const fs = require('fs');
const path = require('path');
const Performance = require('./core/performance_engine');
const Ranking = require('./core/strategy_ranking_engine');

const STATE_F = process.env.PAPER_STATE
  ? path.resolve(process.env.PAPER_STATE)
  : path.join(__dirname, 'paper_state.json');
const DOCS_F = path.join(__dirname, 'docs', 'paper_state.json');
const MIN_TRADES = Math.max(1, +(process.env.PAPER_RANK_MIN_TRADES || 20));

function readState() {
  const raw = JSON.parse(fs.readFileSync(STATE_F, 'utf8'));
  raw.closed = Array.isArray(raw.closed) ? raw.closed : [];
  return raw;
}

function writeState(state) {
  const payload = JSON.stringify(state, null, 1);
  fs.writeFileSync(STATE_F, payload);
  if (!process.env.PAPER_STATE) {
    fs.mkdirSync(path.dirname(DOCS_F), { recursive: true });
    fs.writeFileSync(DOCS_F, payload);
  }
}

function normalizedTrades(closed) {
  return (Array.isArray(closed) ? closed : [])
    .map(trade => ({
      ...trade,
      resultR: Number.isFinite(Number(trade.resultR))
        ? Number(trade.resultR)
        : (Number(trade.r) || 0)
    }))
    .sort((a, b) => (Number(a.closedAt) || 0) - (Number(b.closedAt) || 0));
}

function enrichStats(stats, overall) {
  const source = overall || {};
  return {
    ...(stats || {}),
    expectancyR: Number.isFinite(Number(source.avgR)) ? Number(source.avgR) : 0,
    profitFactor: Number.isFinite(Number(source.profitFactor)) ? Number(source.profitFactor) : 0,
    maxDrawdownR: Number.isFinite(Number(source.maxDrawdownR)) ? Number(source.maxDrawdownR) : 0,
    avgMfeR: Number.isFinite(Number(source.avgMfeR)) ? Number(source.avgMfeR) : 0,
    avgMaeR: Number.isFinite(Number(source.avgMaeR)) ? Number(source.avgMaeR) : 0
  };
}

function buildAnalytics(state, options = {}) {
  const minTrades = Math.max(1, Number(options.minTrades || MIN_TRADES));
  const generatedAt = Number(options.generatedAt) || Date.now();
  const trades = normalizedTrades(state && state.closed);
  const performance = Performance.analyzeTrades(trades);
  const strategyRanking = Ranking.rankStrategies(trades, { minTrades });

  return {
    performance,
    strategyRanking,
    bestStrategy: strategyRanking.find(item => item.eligible) || null,
    stats: enrichStats(state && state.stats, performance.overall),
    analyticsMeta: {
      generatedAt,
      closedTrades: trades.length,
      rankingMinTrades: minTrades,
      version: '5.5'
    }
  };
}

function main() {
  const state = readState();
  Object.assign(state, buildAnalytics(state));
  writeState(state);
  console.log(
    'analytics:', state.analyticsMeta.closedTrades,
    'işlem | model:', state.strategyRanking.length,
    '| en iyi:', state.bestStrategy ? state.bestStrategy.model : 'yeterli veri yok'
  );
}

if (require.main === module) main();

module.exports = { normalizedTrades, enrichStats, buildAnalytics };
