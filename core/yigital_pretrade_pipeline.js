'use strict';

function n(v) { return Number.isFinite(+v) ? +v : null; }

function evaluate(input, config) {
  const analysis = input && input.analysis;
  const setup = analysis && analysis.yigitalSetup;
  const cfg = config || {};
  if (!setup) return { valid: false, stage: 'SETUP', reason: 'YIGITAL_SETUP_MISSING' };
  if (!['Turtle Soup', 'PO3 / Range'].includes(setup.model)) return { valid: false, stage: 'MODEL', reason: 'MANIPULATION_MODEL_REQUIRED' };
  if (setup.htfAligned === false) return { valid: false, stage: 'HTF_FLOW', reason: 'HTF_FLOW_MISMATCH' };
  if (setup.entryStatus !== 'active') return { valid: false, stage: 'RETEST', reason: 'ENTRY_RETEST_PENDING' };
  const entry = n(setup.entry), stop = n(setup.stop);
  const targets = (setup.tps || []).map(n).filter(Number.isFinite);
  const target = targets[targets.length - 1];
  if (![entry, stop, target].every(Number.isFinite)) return { valid: false, stage: 'LEVELS', reason: 'INVALID_LEVELS' };
  const riskDist = Math.abs(entry - stop);
  const grossRR = riskDist > 0 ? Math.abs(target - entry) / riskDist : 0;
  const minRR = Number.isFinite(+cfg.minNetRR) ? +cfg.minNetRR : 1.3;
  if (!(grossRR >= minRR)) return { valid: false, stage: 'RR', reason: 'RR_BELOW_MIN', grossRR };
  return {
    valid: true, stage: 'READY', reason: 'READY', entry, stop, target, riskDist, grossRR,
    targetDecision: { target: { price: target, source: 'YIGITAL_EXTERNAL_LIQUIDITY' } },
    execution: { grossRR, netRR: grossRR, model: 'YIGITAL_PAPER' },
    sequence: { valid: true, state: 'HTF→SWEEP→RECLAIM→RETEST', entryModel: setup.model }
  };
}

module.exports = { evaluate };
