'use strict';

const SOURCES = Object.freeze({
  MANIPULATION_TURTLE_SOUP: '1889012222040621477',
  FIRST_PRESENTED_FVG_NY: '2069827947830124573',
  CRYPTO_JUDAS_TIME: '1808570217523728885',
  OI_PROGRAM_CHANGE: '1919086310352167253',
  SMT_LIQUIDITY_RAID: '1828041204627365916',
  IFVG_SUPPORT_RESISTANCE: '1890341000532430981',
  LOW_RISK_MMXM_PHASE: '1850574993165295834',
  DRAW_ON_LIQUIDITY: '1890310291935608911',
  OPENING_ANCHOR_MANIPULATION: '1818751555731886376'
});

function event(name, passed, details, sourceTweetId) {
  return { name, passed: !!passed, details: details || null, sourceTweetId };
}

function build(input = {}) {
  const sequence = input.sequence || {};
  const timePolicy = input.timePolicy || {};
  const smt = input.smt || {};
  const oiState = input.oiState || null;
  const execution = input.execution || null;
  const targetDecision = input.targetDecision || null;
  const anchorContext = input.anchorContext || null;
  const events = [
    event('MANIPULATION_RECLAIM', !!sequence.manipulation, sequence.manipulation || null, SOURCES.MANIPULATION_TURTLE_SOUP),
    event('POST_RECLAIM_DISPLACEMENT', !!sequence.displacement, sequence.displacement || null, SOURCES.LOW_RISK_MMXM_PHASE),
    event('FIRST_PRESENTED_FVG', !!sequence.firstFvg, sequence.firstFvg || null, SOURCES.FIRST_PRESENTED_FVG_NY),
    event('FVG_RETEST_HELD', !!sequence.entryArmed, { retestIndex: sequence.retestIndex ?? null, held: !!sequence.held }, SOURCES.FIRST_PRESENTED_FVG_NY),
    event('LOW_RISK_ENTRY_MODEL', !!sequence.entryArmed, { entryModel: sequence.entryModel || null, iofed: sequence.iofed || null, breakaway: sequence.breakaway || null }, sequence.entryModel === 'IOFED' ? SOURCES.IFVG_SUPPORT_RESISTANCE : SOURCES.LOW_RISK_MMXM_PHASE),
    event('ASSET_TIME_POLICY', timePolicy.allowed !== false, { assetClass: timePolicy.assetClass, mode: timePolicy.mode, anchors: timePolicy.anchors }, timePolicy.assetClass === 'CRYPTO' ? SOURCES.CRYPTO_JUDAS_TIME : SOURCES.FIRST_PRESENTED_FVG_NY),
    event('OPENING_ANCHOR_CONTEXT', !!anchorContext?.valid, anchorContext, SOURCES.OPENING_ANCHOR_MANIPULATION),
    event('OPEN_INTEREST_CONTEXT', !!oiState, oiState, SOURCES.OI_PROGRAM_CHANGE),
    event('SMT_CONTEXT', !!smt.confirmed, { available: !!smt.available, confirmed: !!smt.confirmed, divergence: smt.divergence || 'NONE' }, SOURCES.SMT_LIQUIDITY_RAID),
    event('DRAW_ON_LIQUIDITY', !!targetDecision?.valid, targetDecision, SOURCES.DRAW_ON_LIQUIDITY),
    event('NET_EXECUTION_RR', !!execution?.valid, execution, null)
  ];
  return {
    version: '1.0',
    generatedAt: Date.now(),
    sourceAccount: 'jaxiwnl21',
    strategy: 'DREYKO_SEQUENCE',
    passed: events.filter(row => ['MANIPULATION_RECLAIM', 'POST_RECLAIM_DISPLACEMENT', 'LOW_RISK_ENTRY_MODEL', 'ASSET_TIME_POLICY', 'OPENING_ANCHOR_CONTEXT', 'DRAW_ON_LIQUIDITY', 'NET_EXECUTION_RR'].includes(row.name)).every(row => row.passed),
    events
  };
}

module.exports = { SOURCES, build };
