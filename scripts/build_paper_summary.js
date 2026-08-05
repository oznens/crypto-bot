'use strict';

const fs = require('fs');
const path = require('path');
const Summary = require('../core/paper_summary');

function build(inputPath = 'paper_state.json', outputPath = 'docs/paper_summary.json', options = {}) {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  const state = JSON.parse(fs.readFileSync(input, 'utf8'));
  const summary = Summary.buildSummary(state, options);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

if (require.main === module) {
  try {
    const summary = build(process.argv[2], process.argv[3]);
    console.log(`paper summary v${summary.schemaVersion}: equity=${summary.account.equity}, open=${summary.positions.open}, closed=${summary.performance.closed}`);
  } catch (error) {
    console.error(`paper summary üretilemedi: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { build };
