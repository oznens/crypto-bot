'use strict';

const Killzone = require('./killzone_fvg_engine');
const SMT = require('./smt_divergence_engine');
const Liquidity = require('./liquidity_map_engine');

function clamp(v,min,max){return Math.max(min,Math.min(max,Number(v)||0));}

function enhance(result, options = {}) {
  if (!result || !result.setup || !Array.isArray(result.candles)) return result;
  const setup = { ...result.setup };
  const side = setup.side;
  const killzone = Killzone.evaluate(result.candles, side, options.killzone);
  const liquidityMap = Liquidity.build(result.candles, options.liquidity);
  const liquidity = Liquidity.chooseTarget(liquidityMap, side, +setup.entry || +result.lastPrice || +result.candles.at(-1)?.c);
  const smt = SMT.evaluate(result.candles, options.peerCandles, side, options.smt);

  let adjustment = 0;
  if (killzone.valid) adjustment += 8;
  else adjustment -= 5;
  if (smt.available) adjustment += smt.confirmed ? 8 : -6;
  if (liquidity.valid) adjustment += 5;
  else adjustment -= 4;

  const timeSensitive = /silver|fvg|killzone|time/i.test(String(setup.model || ''));
  if (timeSensitive && !killzone.valid) {
    return {
      ...result,
      setup: null,
      strategyContext: { version:'13.0', accepted:false, reason:killzone.reason, killzone, smt, liquidity }
    };
  }

  if (liquidity.valid && Array.isArray(setup.tps) && setup.tps.length) {
    const target = liquidity.target.price;
    const validTarget = side === 'LONG' ? target > (+setup.entry || 0) : target < (+setup.entry || Infinity);
    if (validTarget) setup.tps = [...setup.tps.slice(0,-1), target];
  }

  setup.confidence = clamp(Math.round((+setup.confidence || 0) + adjustment), 0, 100);
  setup.context = { killzone, smt, liquidity, confidenceAdjustment:adjustment };
  return {
    ...result,
    setup,
    strategyContext: { version:'13.0', accepted:true, killzone, smt, liquidity, confidenceAdjustment:adjustment }
  };
}

module.exports = { clamp, enhance };
