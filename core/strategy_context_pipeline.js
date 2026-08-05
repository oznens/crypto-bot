'use strict';

const Killzone = require('./killzone_fvg_engine');
const SMT = require('./smt_divergence_engine');
const Liquidity = require('./liquidity_map_engine');
const MTF = require('./multi_timeframe_alignment');
const Confluence = require('./confluence_score_engine');

function clamp(v,min,max){return Math.max(min,Math.min(max,Number(v)||0));}

function enhance(result, options = {}) {
  if (!result || !result.setup || !Array.isArray(result.candles)) return result;
  const setup = { ...result.setup };
  const side = setup.side;
  const killzone = Killzone.evaluate(result.candles, side, options.killzone);
  const liquidityMap = Liquidity.build(result.candles, options.liquidity);
  const entry = +setup.entry || +result.lastPrice || +result.candles.at(-1)?.c;
  const liquidity = Liquidity.chooseTarget(liquidityMap, side, entry);
  const smt = SMT.evaluate(result.candles, options.peerCandles, side, options.smt);
  const mtf = MTF.evaluate({
    side,
    htfBias: result.htfBias,
    mtfTrend: result.structures?.trend,
    ltfBias: result.ltfBias || result.ltf?.bias
  });

  const confluence = Confluence.score({
    structure: !!result.structures?.trend,
    liquidity: liquidity.valid,
    displacement: !!(result.structures?.displacement || setup.displacement),
    fvg: !!(killzone.fvg || setup.fvg),
    orderBlock: !!(setup.ob || setup.orderBlock),
    htfAlignment: mtf.score / 100,
    smt: smt.available ? smt.confirmed : null,
    session: killzone.valid,
    regime: result.intelligence?.regime && result.intelligence.regime !== 'UNKNOWN'
  }, { minScore: options.minConfluence || 55 });

  const context = { version:'15.0', killzone, smt, liquidity, mtf, confluence };
  const timeSensitive = /silver|fvg|killzone|time/i.test(String(setup.model || ''));
  if ((timeSensitive && !killzone.valid) || mtf.opposed > 0 || !confluence.valid) {
    return {
      ...result,
      setup: null,
      strategyContext: {
        ...context,
        accepted:false,
        reason: timeSensitive && !killzone.valid
          ? killzone.reason
          : mtf.opposed > 0
            ? mtf.reason
            : 'CONFLUENCE_TOO_LOW'
      }
    };
  }

  if (liquidity.valid && Array.isArray(setup.tps) && setup.tps.length) {
    const target = liquidity.target.price;
    const validTarget = side === 'LONG' ? target > entry : target < entry;
    if (validTarget) setup.tps = [...setup.tps.slice(0,-1), target];
  }

  const adjustment = Math.round((confluence.score - 70) * 0.25 + (smt.confirmed ? 4 : 0));
  setup.confidence = clamp(Math.round((+setup.confidence || 0) + adjustment), 0, 100);
  setup.grade = confluence.grade;
  setup.context = { ...context, confidenceAdjustment:adjustment };
  return {
    ...result,
    setup,
    strategyContext: { ...context, accepted:true, confidenceAdjustment:adjustment }
  };
}

module.exports = { clamp, enhance };
