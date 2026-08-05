'use strict';

const fs = require('fs');
const path = require('path');
const Allocator = require('../core/strategy_allocator');

function main(argv = process.argv.slice(2)) {
  const input = argv[0] || 'paper_state.json';
  const output = argv[1] || 'docs/strategy_allocation.json';
  const state = JSON.parse(fs.readFileSync(input, 'utf8'));
  const allocation = Allocator.buildAllocation(state.closed || [], {
    modelKey: 'model',
    minTrades: Number(process.env.STRATEGY_MIN_TRADES || 20)
  });

  state.strategyRankings = allocation.allocations;
  state.strategyAllocation = {
    version: allocation.version,
    generatedAt: allocation.generatedAt,
    activeCount: allocation.activeCount,
    watchCount: allocation.watchCount,
    pausedCount: allocation.pausedCount
  };

  fs.writeFileSync(input, JSON.stringify(state, null, 2) + '\n');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(allocation, null, 2) + '\n');
  console.log(`V7 tahsis raporu üretildi: ${output} (${allocation.allocations.length} strateji)`);
  return allocation;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`V7 tahsis üretilemedi: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
