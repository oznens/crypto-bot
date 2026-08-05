'use strict';

const fs = require('fs');
const path = require('path');
const Validator = require('../core/paper_state_validator');

function readJson(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8').trim();
  if (!raw) throw new Error(`${filePath} boş`);
  return JSON.parse(raw);
}

function validateFile(filePath, options = {}) {
  const state = readJson(filePath);
  Validator.assertState(state, options);
  return {
    file: filePath,
    openTrades: state.open.length,
    closedTrades: state.closed.length,
    health: state.health.status,
    analyticsVersion: state.analyticsMeta.version
  };
}

function main(argv = process.argv.slice(2)) {
  const files = argv.length ? argv : ['paper_state.json'];
  const analyticsVersion = process.env.PAPER_ANALYTICS_VERSION || '5.5';

  for (const file of files) {
    const result = validateFile(file, { analyticsVersion });
    console.log(
      `${result.file} doğrulandı:`,
      `${result.closedTrades} kapalı,`,
      `${result.openTrades} açık işlem,`,
      `sağlık ${result.health},`,
      `analytics ${result.analyticsVersion}`
    );
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('paper state doğrulama hatası:', error.message);
    process.exit(1);
  }
}

module.exports = { readJson, validateFile, main };
