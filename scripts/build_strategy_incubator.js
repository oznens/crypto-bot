'use strict';

const fs = require('fs');
const path = require('path');
const Incubator = require('../core/strategy_incubator');

function main(argv = process.argv.slice(2)) {
  const input = argv[0] || 'paper_state.json';
  const output = argv[1] || 'docs/strategy_incubator.json';
  const state = JSON.parse(fs.readFileSync(input, 'utf8'));
  const champions = (state.strategyRankings || [])
    .filter(row => row.status === 'ACTIVE')
    .slice(0, Number(process.env.STRATEGY_CHAMPION_COUNT || 3))
    .map(row => row.model);
  const report = Incubator.evaluate(state.closed || [], {
    champions,
    minShadowTrades: Number(process.env.STRATEGY_MIN_SHADOW_TRADES || 15),
    minPromotionTrades: Number(process.env.STRATEGY_MIN_PROMOTION_TRADES || 30),
    minExpectancy: Number(process.env.STRATEGY_MIN_PROMOTION_EXPECTANCY || 0.08),
    maxDrawdownR: Number(process.env.STRATEGY_MAX_PROMOTION_DD_R || 6)
  });
  state.strategyIncubator = {
    version: report.version,
    generatedAt: report.generatedAt,
    championCount: report.champions.length,
    readyCount: report.ready.length,
    challengerCount: report.challengers.length,
    rejectedCount: report.rejected.length
  };
  fs.writeFileSync(input, JSON.stringify(state, null, 2) + '\n');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`V33 inkübasyon raporu üretildi: ${output} (${report.strategies.length} strateji)`);
  return report;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`V33 inkübasyon raporu üretilemedi: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
