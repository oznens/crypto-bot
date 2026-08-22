'use strict';

const assert = require('assert');
const CFG = require('../strategy_config');

assert.deepEqual(
  CFG.TIMEFRAMES.map(({ tf, ltf }) => `${tf}->${ltf}`),
  ['15m->5m', '30m->5m', '60m->15m', '2h->30m', '4h->60m', '1d->4h']
);

console.log('strategy timeframe tests passed');
