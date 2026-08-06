'use strict';

const fs = require('fs');
const path = require('path');
const { load } = require('./config_loader');
const { runEngine } = require('./engine_adapter');

async function run(configPath = process.env.BACKTEST_CONFIG || 'backtest/config.json') {
  const config = load(configPath);
  const result = await runEngine(config);
  const outDir = path.resolve('backtest_results');
  fs.mkdirSync(outDir, { recursive: true });

  const payload = {
    version: '35.2',
    config,
    summary: result.summary,
    trades: result.trades,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(outDir, 'trades.json'), JSON.stringify(result.trades, null, 2));
  fs.writeFileSync(path.join(outDir, 'summary.txt'), result.summary);
  console.log('Backtest completed:', path.join(outDir, 'latest.json'));
  return payload;
}

if (require.main === module) {
  run().catch(err => {
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { run };
