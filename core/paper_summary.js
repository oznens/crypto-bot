'use strict';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const p = 10 ** digits;
  return Math.round((num(value) + Number.EPSILON) * p) / p;
}

function buildSummary(state, options = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const open = Array.isArray(st.open) ? st.open : [];
  const closed = Array.isArray(st.closed) ? st.closed : [];
  const stats = st.stats && typeof st.stats === 'object' ? st.stats : {};
  const equity = num(st.equity);
  const startEquity = num(st.startEquity, equity);
  const pnl = equity - startEquity;
  const riskyOpen = open.filter(t => !t.deriskDone).length;
  const beOpen = open.length - riskyOpen;
  const totalRiskUSD = open.reduce((sum, t) => sum + num(t.riskUSD), 0);
  const rejectionCounts = {};
  for (const item of Array.isArray(st.riskRejections) ? st.riskRejections : []) {
    const reason = String(item?.reason || 'UNKNOWN');
    rejectionCounts[reason] = (rejectionCounts[reason] || 0) + 1;
  }

  const rankings = Array.isArray(st.strategyRankings)
    ? st.strategyRankings.slice(0, 10)
    : Array.isArray(stats.rankings)
      ? stats.rankings.slice(0, 10)
      : [];

  return {
    schemaVersion: '6.0',
    generatedAt: now,
    sourceLastRun: num(st.lastRun, null),
    health: {
      ok: st.health?.ok === true,
      status: st.health?.status || 'UNKNOWN'
    },
    account: {
      startEquity: round(startEquity),
      equity: round(equity),
      pnl: round(pnl),
      returnPct: startEquity > 0 ? round((pnl / startEquity) * 100) : 0
    },
    positions: {
      open: open.length,
      risky: riskyOpen,
      breakeven: beOpen,
      totalRiskUSD: round(totalRiskUSD)
    },
    performance: {
      closed: closed.length,
      wins: num(stats.wins),
      losses: num(stats.losses),
      winRate: round(stats.winRate),
      totalR: round(stats.totalR),
      expectancyR: round(stats.expectancyR),
      profitFactor: round(stats.profitFactor),
      maxDrawdownR: round(stats.maxDrawdownR),
      avgMfeR: round(stats.avgMfeR),
      avgMaeR: round(stats.avgMaeR)
    },
    risk: {
      rejectionCount: Object.values(rejectionCounts).reduce((a, b) => a + b, 0),
      rejectionCounts
    },
    rankings,
    meta: {
      analyticsVersion: st.analyticsMeta?.version || null,
      analyticsGeneratedAt: num(st.analyticsMeta?.generatedAt, null),
      runs: num(st.runs)
    }
  };
}

module.exports = { num, round, buildSummary };
