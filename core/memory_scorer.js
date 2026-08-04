"use strict";

const memory = require('./trade_memory');

function scoreSetup(setup) {
  const stats = memory.analyze({
    symbol: setup.symbol,
    model: setup.model,
    side: setup.side
  });

  let boost = 0;
  if (stats && stats.count >= 20) {
    if (stats.winrate >= 60) boost = 8;
    else if (stats.winrate >= 52) boost = 3;
    else if (stats.winrate < 40) boost = -8;
  }

  return {
    stats,
    boost
  };
}

module.exports = { scoreSetup };
