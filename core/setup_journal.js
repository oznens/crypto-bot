'use strict';

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function makeId(input = {}) {
  const symbol = String(input.symbol || 'UNKNOWN');
  const timeframe = String(input.tf || 'NA');
  const model = String(input.model || 'NO_MODEL').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const anchor = finite(input.anchor) ? Number(input.anchor) : Date.now();
  return [symbol, timeframe, model || 'NO_MODEL', anchor].join('|');
}

function compactContext(context) {
  if (!context || typeof context !== 'object') return null;
  return {
    version: context.version || null,
    accepted: context.accepted !== false,
    reason: context.reason || null,
    confluence: context.confluence ? {
      score: context.confluence.score,
      grade: context.confluence.grade,
      valid: context.confluence.valid,
      breakdown: context.confluence.breakdown || []
    } : null,
    mtf: context.mtf || null,
    killzone: context.killzone || null,
    smt: context.smt || null,
    liquidity: context.liquidity || null,
    mmxm: context.mmxm || null,
    wyckoff: context.wyckoff || null,
    quarterly: context.quarterly || null,
    ict: context.ict || null,
    sbs: context.sbs || null,
    sessionLiquidity: context.sessionLiquidity || null,
    executionCost: context.executionCost || null,
    dataQuality: context.dataQuality || null,
    bigE: context.bigE || null,
    unicorn: context.unicorn || null,
    nineStars: context.nineStars || null,
    hps: context.hps || null
  };
}

function setupGeometry(setup, marketPrice) {
  if (!setup) return null;
  const stop = finite(setup.stop ?? setup.sl) ? Number(setup.stop ?? setup.sl) : null;
  let entry = finite(setup.entry) ? Number(setup.entry) : null;
  const fallback = finite(marketPrice) ? Number(marketPrice) : null;
  if (fallback !== null && (entry === null || (stop !== null && Math.abs(entry - stop) <= Math.max(1e-12, Math.abs(stop) * 1e-10)))) {
    entry = fallback;
  }
  return {
    side: setup.side || null,
    model: setup.model || null,
    grade: setup.grade || null,
    confidence: finite(setup.confidence) ? Number(setup.confidence) : null,
    entry,
    stop,
    targets: Array.isArray(setup.tps) ? setup.tps.map(Number).filter(Number.isFinite) : [],
    rr: finite(setup.rr) ? Number(setup.rr) : null,
    reasons: Array.isArray(setup.reasons) ? setup.reasons.slice(0, 12) : [],
    portfolioRiskMultiplier: finite(setup.portfolioRiskMultiplier) ? Number(setup.portfolioRiskMultiplier) : null
  };
}

function upsert(journal, input, options = {}) {
  const rows = Array.isArray(journal) ? journal : [];
  const now = finite(options.now) ? Number(options.now) : Date.now();
  const id = input.id || makeId(input);
  const existing = rows.find(row => row.id === id);
  const marketPrice = finite(input.marketPrice) ? Number(input.marketPrice) : existing?.marketPrice ?? null;
  const next = {
    ...(existing || {}),
    id,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    symbol: input.symbol || existing?.symbol || 'UNKNOWN',
    tf: input.tf || existing?.tf || null,
    lowerTf: input.lowerTf || existing?.lowerTf || null,
    status: input.status || existing?.status || 'OBSERVED',
    decision: input.decision || existing?.decision || null,
    reason: input.reason || null,
    setup: input.setup === undefined ? existing?.setup || null : setupGeometry(input.setup, marketPrice),
    context: input.context === undefined ? existing?.context || null : compactContext(input.context),
    marketPrice,
    anchor: finite(input.anchor) ? Number(input.anchor) : existing?.anchor ?? null,
    tradeId: input.tradeId || existing?.tradeId || null,
    closedAt: finite(input.closedAt) ? Number(input.closedAt) : existing?.closedAt ?? null,
    resultR: finite(input.resultR) ? Number(input.resultR) : existing?.resultR ?? null,
    closeReason: input.closeReason || existing?.closeReason || null,
    snapshot: input.snapshot || existing?.snapshot || null
  };
  if (existing) Object.assign(existing, next);
  else rows.unshift(next);
  const limit = finite(options.limit) ? Math.max(20, Number(options.limit)) : 1000;
  if (rows.length > limit) rows.length = limit;
  return next;
}

function linkTrade(journal, journalId, trade) {
  if (!trade) return null;
  return upsert(journal, {
    id: journalId,
    symbol: trade.symbol,
    tf: trade.tf,
    status: trade.status === 'closed' ? 'CLOSED' : 'OPENED',
    decision: 'TRADE_OPENED',
    reason: trade.status === 'closed' ? trade.closeReason : 'RISK_AND_EXECUTION_APPROVED',
    tradeId: trade.id,
    closedAt: trade.closedAt,
    resultR: trade.resultR ?? trade.r,
    closeReason: trade.closeReason,
    marketPrice: trade.entry,
    setup: {
      side: trade.side,
      model: trade.model,
      grade: trade.grade,
      confidence: trade.conf,
      entry: trade.entry,
      stop: trade.initialSL ?? trade.sl,
      tps: [trade.tp1, trade.tpF],
      rr: trade.rrPlan,
      reasons: trade.reasons
    },
    snapshot: trade.snap || trade.snapClose || null
  });
}

function summary(journal) {
  const rows = Array.isArray(journal) ? journal : [];
  const count = status => rows.filter(row => row.status === status).length;
  return {
    total: rows.length,
    observed: count('OBSERVED'),
    watching: count('WATCHING'),
    rejected: count('REJECTED'),
    opened: count('OPENED'),
    closed: count('CLOSED'),
    updatedAt: rows.reduce((max, row) => Math.max(max, Number(row.lastSeenAt) || 0), 0) || null
  };
}

module.exports = { finite, makeId, compactContext, setupGeometry, upsert, linkTrade, summary };
