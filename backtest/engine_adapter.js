'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function daysBetween(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('Invalid backtest date range');
  }
  return Math.max(1, Math.round((end - start) / 86400000));
}

function symbolCount(symbols) {
  if (symbols.mode === 'top10') return 10;
  if (symbols.mode === 'top30') return 30;
  if (symbols.mode === 'manual') {
    throw new Error('Manual symbols are not supported by the legacy simulator yet');
  }
  throw new Error(`Unsupported symbol mode: ${symbols.mode}`);
}

function runEngine(config) {
  const root = path.resolve(__dirname, '..');
  const script = config.engine === 'v34' ? 'backtest_v34.js' : 'backtest3ay.js';
  const preload = path.join(root, 'backtest', 'date_override.js');
  const env = {
    ...process.env,
    GUN: String(daysBetween(config.startDate, config.endDate)),
    SYMS: String(symbolCount(config.symbols)),
    BACKTEST_END_DATE: config.endDate,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${preload}`].filter(Boolean).join(' ')
  };

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, script)], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`${script} exited with ${code}: ${stderr.slice(-1000)}`));
      const summaryPath = path.join(root, 'backtest3ay_sonuc.txt');
      const tradesPath = path.join(root, 'backtest3ay_islemler.json');
      const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : stdout;
      const trades = fs.existsSync(tradesPath) ? JSON.parse(fs.readFileSync(tradesPath, 'utf8')) : [];
      resolve({ engine: config.engine, summary, trades, stdout });
    });
  });
}

module.exports = { runEngine, daysBetween, symbolCount };
