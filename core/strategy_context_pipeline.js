'use strict';

const Killzone = require('./killzone_fvg_engine');
const SMT = require('./smt_divergence_engine');
const Liquidity = require('./liquidity_map_engine');
const MTF = require('./multi_timeframe_alignment');
const Confluence = require('./confluence_score_engine');
const ICT = require('./ict_pattern_pack');
const Wyckoff = require('./wyckoff_phase_engine');
const Quarterly = require('./quarterly_theory_engine');
const MMXM = require('./mmxm_curve_engine');
const SBS = require('./sbs_engine');
const SessionLiquidity = require('./session_liquidity_engine');

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
  const ict = ICT.evaluate(result.candles, side);
  const wyckoff = Wyckoff.evaluate(result.candles);
  const quarterly = Quarterly.evaluate(result.candles);
  const mmxm = MMXM.evaluate(result.candles);
  const sbs = SBS.evaluate(result.candles, side, options.sbs);
  const sessionLiquidity = SessionLiquidity.evaluate(result.candles, side);

  const wyckoffAligned = !wyckoff.valid || wyckoff.bias === 'NEUTRAL' || wyckoff.bias === side;
  const quarterlyAligned = !quarterly.valid || quarterly.side === side;
  const ictAligned = !ict.valid || Object.values(ict.patterns).some(x => x.valid && (!x.side || x.side === side));
  const mmxmAligned = !mmxm.valid || mmxm.bias === 'NEUTRAL' || mmxm.bias === side;
  const sessionAligned = !sessionLiquidity.judas || sessionLiquidity.side === side;

  const confluence = Confluence.score({
    structure: !!result.structures?.trend,
    liquidity: liquidity.valid,
    displacement: !!(result.structures?.displacement || setup.displacement),
    fvg: !!(killzone.fvg || setup.fvg),
    orderBlock: !!(setup.ob || setup.orderBlock),
    htfAlignment: mtf.score / 100,
    smt: smt.available ? smt.confirmed : null,
    session: killzone.valid || sessionLiquidity.valid,
    regime: result.intelligence?.regime && result.intelligence.regime !== 'UNKNOWN'
  }, { minScore: options.minConfluence || 55 });

  const context = {
    version:'22.0', killzone, smt, liquidity, mtf, confluence,
    ict, wyckoff, quarterly, mmxm, sbs, sessionLiquidity
  };
  const timeSensitive = /silver|fvg|killzone|time/i.test(String(setup.model || ''));
  const hardConflict = mtf.opposed > 0 || !wyckoffAligned || !quarterlyAligned || !ictAligned || !mmxmAligned || !sessionAligned;
  if ((timeSensitive && !killzone.valid) || hardConflict || !confluence.valid) {
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
            : !wyckoffAligned
              ? 'WYCKOFF_DIRECTION_CONFLICT'
              : !quarterlyAligned
                ? 'QUARTERLY_DIRECTION_CONFLICT'
                : !ictAligned
                  ? 'ICT_PATTERN_DIRECTION_CONFLICT'
                  : !mmxmAligned
                    ? 'MMXM_DIRECTION_CONFLICT'
                    : !sessionAligned
                      ? 'SESSION_LIQUIDITY_DIRECTION_CONFLICT'
                      : 'CONFLUENCE_TOO_LOW'
      }
    };
  }

  if (liquidity.valid && Array.isArray(setup.tps) && setup.tps.length) {
    const target = liquidity.target.price;
    const validTarget = side === 'LONG' ? target > entry : target < entry;
    if (validTarget) setup.tps = [...setup.tps.slice(0,-1), target];
  }

  const adjustment = Math.round(
    (confluence.score - 70) * 0.25 +
    (smt.confirmed ? 4 : 0) +
    Math.min(6, ict.confirmed * 2) +
    (wyckoff.valid && wyckoff.bias === side ? 3 : 0) +
    (quarterly.valid && quarterly.side === side ? 3 : 0) +
    (mmxm.valid && mmxm.bias === side ? 4 : 0) +
    (sbs.valid ? 5 : 0) +
    (sessionLiquidity.valid ? 5 : 0)
  );
  setup.confidence = clamp(Math.round((+setup.confidence || 0) + adjustment), 0, 100);
  setup.grade = confluence.grade;
  setup.ictPatterns = ict;
  setup.wyckoff = wyckoff;
  setup.quarterly = quarterly;
  setup.mmxm = mmxm;
  setup.sbs = sbs;
  setup.sessionLiquidity = sessionLiquidity;
  setup.context = { ...context, confidenceAdjustment:adjustment };
  return {
    ...result,
    setup,
    strategyContext: { ...context, accepted:true, confidenceAdjustment:adjustment }
  };
}

module.exports = { clamp, enhance };
