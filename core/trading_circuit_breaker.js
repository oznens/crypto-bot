'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function utcDay(ts){return new Date(ts).toISOString().slice(0,10);}
function evaluate(state,options={}){
  const closed=[...(state?.closed||[])].sort((a,b)=>n(b.closedAt)-n(a.closedAt));
  const now=Number.isFinite(+options.now)?+options.now:Date.now();
  const day=utcDay(now);
  const today=closed.filter(t=>utcDay(n(t.closedAt))===day);
  const dailyR=today.reduce((s,t)=>s+n(t.resultR??t.r),0);
  let losingStreak=0;for(const t of closed){if(n(t.resultR??t.r)<0)losingStreak++;else break;}
  const dailyLimit=Math.abs(Number.isFinite(+options.dailyLossLimitR)?+options.dailyLossLimitR:3);
  const maxStreak=Number.isFinite(+options.maxLosingStreak)?+options.maxLosingStreak:4;
  const cooldownMs=Number.isFinite(+options.cooldownMs)?+options.cooldownMs:6*3600000;
  const persistedUntil=n(state?.circuitBreaker?.blockedUntil);
  const persisted=persistedUntil>now;
  let reason=null;
  if(persisted)reason='COOLDOWN_ACTIVE';
  else if(dailyR<=-dailyLimit)reason='DAILY_LOSS_LIMIT';
  else if(losingStreak>=maxStreak)reason='LOSING_STREAK_LIMIT';
  const blocked=!!reason;
  return{blocked,allowed:!blocked,reason,dailyR:+dailyR.toFixed(2),todayTrades:today.length,losingStreak,blockedUntil:blocked?(persisted?persistedUntil:now+cooldownMs):null,dailyLossLimitR:dailyLimit,maxLosingStreak:maxStreak};
}
function apply(state,decision,now=Date.now()){
  state.circuitBreaker={version:'32.0',generatedAt:now,...decision};return state.circuitBreaker;
}
module.exports={utcDay,evaluate,apply};
