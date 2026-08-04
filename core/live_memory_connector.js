'use strict';

/**
 * V4.4.1 Live Memory Connector
 *
 * Connects live signals with historical intelligence.
 * This layer does not execute trades; it only enriches decisions.
 */

function enrichSignal(signal, memoryStats) {
  const result = { ...signal };

  const stats = memoryStats || {};
  const winrate = Number(stats.winrate || 0);
  const expectancy = Number(stats.expectancy || 0);

  let boost = 0;

  if (winrate >= 60) boost += 8;
  else if (winrate >= 50) boost += 3;
  else if (winrate < 40) boost -= 8;

  if (expectancy > 0.5) boost += 5;
  if (expectancy < 0) boost -= 5;

  result.memory = {
    samples: stats.samples || 0,
    winrate,
    expectancy,
    boost
  };

  result.confidence = Math.max(0, Math.min(100, Number(result.confidence || 0) + boost));

  return result;
}

module.exports = { enrichSignal };
