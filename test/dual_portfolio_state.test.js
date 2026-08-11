'use strict';

const assert = require('assert');
const State = require('../core/paper_state_store');

const fresh = State.initialState(10000);
fresh.portfolios.DREYKO.equity += 500;
fresh.portfolios.DREYKO.closed.push({ r: 2 });
assert.equal(fresh.portfolios.YIGITAL.equity, 10000);
assert.equal(fresh.portfolios.YIGITAL.closed.length, 0);

const migrated = State.migrateState({
  equity: 12345, startEquity: 10000, open: [{ id: 'legacy' }],
  closed: [], recentSigs: [], equityHistory: [], runs: 9
}, 10000);
assert.equal(migrated.portfolios.DREYKO.equity, 12345);
assert.equal(migrated.portfolios.DREYKO.open.length, 1);
assert.equal(migrated.portfolios.YIGITAL.equity, 10000);
assert.equal(migrated.portfolios.YIGITAL.open.length, 0);
assert.strictEqual(migrated.open, migrated.portfolios.DREYKO.open);

console.log('dual_portfolio_state tests passed');
