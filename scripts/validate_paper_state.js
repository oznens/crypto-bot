'use strict';

const fs = require('fs');
const path = require('path');
const Validator = require('../core/paper_state_validator');

function readRaw(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved);
  if (!raw.length || !raw.toString('utf8').trim()) throw new Error(`${filePath} boş`);
  return raw;
}

function readJson(filePath) {
  return JSON.parse(readRaw(filePath).toString('utf8'));
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

function assertFilesEqual(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length < 2) {
    throw new Error('--same için en az iki dosya gerekli');
  }

  const reference = readRaw(filePaths[0]);
  for (const filePath of filePaths.slice(1)) {
    const candidate = readRaw(filePath);
    if (!reference.equals(candidate)) {
      throw new Error(`state dosyaları birebir aynı değil: ${filePaths[0]} != ${filePath}`);
    }
  }
  return true;
}

function parseArgs(argv) {
  const same = argv.includes('--same');
  const files = argv.filter(arg => arg !== '--same');
  return { same, files: files.length ? files : ['paper_state.json'] };
}

function main(argv = process.argv.slice(2)) {
  const { same, files } = parseArgs(argv);
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

  if (same) {
    assertFilesEqual(files);
    console.log('state dosyaları birebir aynı:', files.join(' = '));
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

module.exports = {
  readRaw,
  readJson,
  validateFile,
  assertFilesEqual,
  parseArgs,
  main
};
