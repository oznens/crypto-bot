'use strict';

const assert = require('assert');
const Audit = require('../core/dreyko_audit_trace');

const trace = Audit.build({
  sequence: {
    manipulation: { side: 'LONG', sweepAt: 30, at: 31 },
    displacement: { index: 32 },
    firstFvg: { side: 'LONG', from: 31, to: 33 },
    entryModel: 'FIRST_PRESENTED_FVG',
    entryArmed: true,
    retestIndex: 34,
    held: true
  },
  timePolicy: { allowed: true, assetClass: 'CRYPTO', mode: 'CRYPTO_JUDAS', anchors: { daily: 100 } },
  anchorContext: { valid: true, mode: 'OPEN_SWEEP_RECLAIM', reclaims: [{ name: 'daily', price: 100 }] },
  oiState: { bigDrop: true, dropPct: 8 },
  smt: { available: true, confirmed: true, divergence: 'BULLISH_SMT' },
  targetDecision: { valid: true, target: { price: 106, source: 'OPPOSING_LIQUIDITY_POOL' } },
  execution: { valid: true, netRR: 2.1 }
});

assert.equal(trace.passed, true);
assert.equal(trace.sourceAccount, 'jaxiwnl21');
assert.equal(trace.events.find(row => row.name === 'FIRST_PRESENTED_FVG').sourceTweetId, Audit.SOURCES.FIRST_PRESENTED_FVG_NY);
assert.equal(trace.events.find(row => row.name === 'NET_EXECUTION_RR').passed, true);
assert.equal(trace.events.find(row => row.name === 'LOW_RISK_ENTRY_MODEL').sourceTweetId, Audit.SOURCES.LOW_RISK_MMXM_PHASE);

const iofedTrace = Audit.build({
  sequence: {
    manipulation: { side: 'LONG', sweepAt: 30, at: 31 },
    displacement: { index: 32 },
    entryModel: 'IOFED',
    entryArmed: true,
    held: true,
    iofed: { flipIndex: 32, retestIndex: 33 }
  },
  timePolicy: { allowed: true, assetClass: 'FX' },
  anchorContext: { valid: true, mode: 'OPEN_FLOW_ALIGNMENT' },
  targetDecision: { valid: true, target: { price: 106 } },
  execution: { valid: true, netRR: 2 }
});
assert.equal(iofedTrace.passed, true);
assert.equal(iofedTrace.events.find(row => row.name === 'LOW_RISK_ENTRY_MODEL').sourceTweetId, Audit.SOURCES.IFVG_SUPPORT_RESISTANCE);
assert.equal(trace.events.find(row => row.name === 'DRAW_ON_LIQUIDITY').sourceTweetId, Audit.SOURCES.DRAW_ON_LIQUIDITY);
assert.equal(trace.events.find(row => row.name === 'OPENING_ANCHOR_CONTEXT').sourceTweetId, Audit.SOURCES.OPENING_ANCHOR_MANIPULATION);
assert.equal(Audit.build({}).passed, false);
console.log('dreyko_audit_trace tests passed');
