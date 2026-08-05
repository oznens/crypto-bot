'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Cli = require('../scripts/validate_paper_state');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-state-cli-'));
const a = path.join(dir, 'a.json');
const b = path.join(dir, 'b.json');
const c = path.join(dir, 'c.json');
const now = Date.now();

const validState = {
  equity: 1000,
  open: [],
  closed: [],
  lastRun: now - 1000,
  health: { ok: true, status: 'HEALTHY' },
  analyticsMeta: {
    version: '5.5',
    generatedAt: now,
    closedTrades: 0
  }
};

const payload = JSON.stringify(validState, null, 1);
fs.writeFileSync(a, payload);
fs.writeFileSync(b, payload);
fs.writeFileSync(c, JSON.stringify({ ...validState, equity: 999 }, null, 1));

assert.equal(Cli.assertFilesEqual([a, b]), true);
assert.deepEqual(Cli.parseArgs(['--same', a, b]), { same: true, files: [a, b] });
assert.throws(() => Cli.assertFilesEqual([a]), /en az iki dosya/);
assert.throws(() => Cli.assertFilesEqual([a, c]), /birebir aynı değil/);
assert.equal(Cli.validateFile(a).health, 'HEALTHY');

fs.rmSync(dir, { recursive: true, force: true });
console.log('validate_paper_state CLI tests passed');
