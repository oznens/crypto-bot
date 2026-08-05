'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function avg(rows){return rows.length?rows.reduce((s,x)=>s+n(x.resultR ?? x.r),0)/rows.length:0;}

function evaluate(trades, options = {}) {
  const rows = Array.isArray(trades) ? trades : [];
  const recentCount = Number.isFinite(+options.recentCount) ? +options.recentCount : 20;
  const minBaseline = Number.isFinite(+options.minBaseline) ? +options.minBaseline : 20;
  if (rows.length < recentCount + minBaseline) {
    return { available:false, status:'INSUFFICIENT_DATA', score:50, recentExpectancy:0, baselineExpectancy:0, drop:0 };
  }
  const sorted = [...rows].sort((a,b)=>n(a.closedAt)-n(b.closedAt));
  const recent = sorted.slice(-recentCount);
  const baseline = sorted.slice(0,-recentCount);
  const recentExpectancy = avg(recent);
  const baselineExpectancy = avg(baseline);
  const drop = baselineExpectancy - recentExpectancy;
  const ratio = Math.abs(baselineExpectancy) > 1e-9 ? recentExpectancy / Math.abs(baselineExpectancy) : 0;
  let status = 'STABLE';
  if (recentExpectancy <= -0.1 && drop >= 0.2) status = 'DECAY_SEVERE';
  else if (drop >= 0.15 || ratio < 0.5) status = 'DECAY_WARNING';
  const score = status === 'STABLE' ? 100 : status === 'DECAY_WARNING' ? 45 : 0;
  return {
    available:true,status,score,
    recentTrades:recent.length,baselineTrades:baseline.length,
    recentExpectancy:+recentExpectancy.toFixed(4),
    baselineExpectancy:+baselineExpectancy.toFixed(4),
    drop:+drop.toFixed(4),ratio:+ratio.toFixed(3)
  };
}

module.exports = { avg, evaluate };
