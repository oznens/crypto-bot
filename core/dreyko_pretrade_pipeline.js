'use strict';

const AssetTime = require('./asset_time_policy');
const OpeningAnchor = require('./opening_anchor_engine');
const Sequence = require('./dreyko_sequence_engine');
const Target = require('./dreyko_target_engine');
const Execution = require('./execution_cost_engine');

function reject(stage, reason, context = {}) {
  return { valid: false, stage, reason, ...context };
}

function evaluate(input = {}, options = {}) {
  const candles = Array.isArray(input.candles) ? input.candles : [];
  const analysis = input.analysis || {};
  const setup = analysis.setup;
  const side = setup?.side;
  const marketPrice = Number(input.marketPrice ?? candles[candles.length - 1]?.c);
  if (!setup || !['LONG', 'SHORT'].includes(side) || !Number.isFinite(marketPrice)) {
    return reject('INPUT', 'PRETRADE_INPUT_INVALID');
  }

  const timePolicy = AssetTime.evaluate(input.symbol, candles, input.timestamp);
  if (!timePolicy.allowed) return reject('TIME_POLICY', timePolicy.reason, { timePolicy });
  const anchorContext = OpeningAnchor.evaluate(candles, side, timePolicy.anchors, options.anchor);
  if (!anchorContext.valid) return reject('OPENING_ANCHOR', anchorContext.reason, { timePolicy, anchorContext });
  const sequence = Sequence.evaluate(candles, analysis, options.sequence);
  if (!sequence.valid) return reject('SEQUENCE', sequence.reason, { timePolicy, anchorContext, sequence });

  const long = side === 'LONG';
  const slip = Number(options.slippagePct) || 0;
  const entry = marketPrice * (long ? 1 + slip : 1 - slip);
  const stop = Number(setup.stop ?? setup.sl);
  if (!Number.isFinite(stop) || (long ? stop >= entry : stop <= entry)) {
    return reject('GEOMETRY', 'STOP_GEOMETRY_INVALID', { timePolicy, anchorContext, sequence, entry, stop });
  }
  const riskDist = Math.abs(entry - stop);
  if (riskDist / entry < (Number(options.minRiskPct) || 0)) {
    return reject('GEOMETRY', 'STOP_DISTANCE_TOO_SMALL', { timePolicy, anchorContext, sequence, entry, stop, riskDist });
  }

  const targetDecision = Target.evaluate({ candles, side, entry, stop }, options.target);
  if (!targetDecision.valid) return reject('TARGET', targetDecision.reason, { timePolicy, anchorContext, sequence, targetDecision, entry, stop, riskDist });
  const target = targetDecision.target.price;
  const execution = Execution.evaluate({
    side,
    entry,
    stop,
    target,
    feeBps: Number(options.feeBps) || 0,
    slippageBps: slip * 10000,
    spreadBps: Number(options.spreadBps) || 0
  }, { minNetRR: Number(options.minNetRR) || 1.5 });
  if (!execution.valid) return reject('EXECUTION', execution.reason, { timePolicy, anchorContext, sequence, targetDecision, execution, entry, stop, target, riskDist });

  return {
    valid: true,
    stage: 'ACCEPTED',
    reason: 'DREYKO_PRETRADE_ACCEPTED',
    side,
    entry,
    stop,
    target,
    riskDist,
    grossRR: Math.abs(target - entry) / riskDist,
    timePolicy,
    anchorContext,
    sequence,
    targetDecision,
    execution
  };
}

module.exports = { evaluate };
