'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Store = require('../core/paper_state_store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-state-'));
const file = path.join(dir, 'state.json');
const initial = Store.loadState(file, 10000);
assert.equal(initial.equity, 10000);

initial.open.push({ symbol: 'BTC_USDT' });
Store.saveAtomic(file, initial);
assert.equal(Store.loadState(file, 10000).open.length, 1);

const next = { ...initial, equity: 9900 };
Store.saveAtomic(file, next);
fs.writeFileSync(file, '{bozuk');
const recovered = Store.loadState(file, 10000);
assert.equal(recovered.equity, 10000);
assert.equal(recovered.open.length, 1);
assert.ok(recovered.recovery);
Store.saveAtomic(file, recovered);
assert.equal(Store.loadState(`${file}.bak`, 10000).open.length, 1);

fs.writeFileSync(file, '{bozuk');
fs.writeFileSync(`${file}.bak`, '{bozuk');
assert.throws(() => Store.loadState(file, 10000), /okunamadı/);

console.log('paper_state_store tests passed');
