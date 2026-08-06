"use strict";

const { load } = require('./config_loader');
const fs = require('fs');
const path = require('path');

async function loadEngine(engine) {
  if (engine === 'legacy') {
    return require('../backtest3ay');
  }

  if (engine === 'v34') {
    return require('../analysis');
  }

  throw new Error(`Unsupported engine: ${engine}`);
}

async function run() {
  const config = load();
  const engine = await loadEngine(config.engine);

  const result = await engine.runBacktest
    ? engine.runBacktest(config)
    : engine(config);

  const out = path.resolve('backtest_results/latest.json');

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    config,
    result,
    createdAt: new Date().toISOString()
  }, null, 2));

  console.log('Backtest completed:', out);
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
