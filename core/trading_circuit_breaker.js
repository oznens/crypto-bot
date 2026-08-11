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
  const dailyLossEnabled=options.dailyLossEnabled!==false;
  const maxStreak=Number.isFinite(+options.maxLosingStreak)?+options.maxLosingStreak:4;
  const cooldownMs=Number.isFinite(+options.cooldownMs)?+options.cooldownMs:6*3600000;
  const losingStreakEnabled=options.losingStreakEnabled!==false;
  const persistedUntil=n(state?.circuitBreaker?.blockedUntil);
  const persistedReason=state?.circuitBreaker?.reason;
  const disabledPersistedReason = (!losingStreakEnabled && persistedReason==='LOSING_STREAK_LIMIT') || (!dailyLossEnabled && persistedReason==='DAILY_LOSS_LIMIT');
  const persisted=persistedUntil>now && !disabledPersistedReason;
  let reason=null;
  if(persisted)reason='COOLDOWN_ACTIVE';
  else if(dailyLossEnabled && dailyR<=-dailyLimit)reason='DAILY_LOSS_LIMIT';
  else if(losingStreakEnabled && losingStreak>=maxStreak)reason='LOSING_STREAK_LIMIT';
  const blocked=!!reason;
  return{blocked,allowed:!blocked,reason,dailyR:+dailyR.toFixed(2),todayTrades:today.length,losingStreak,blockedUntil:blocked?(persisted?persistedUntil:now+cooldownMs):null,dailyLossLimitR:dailyLossEnabled?dailyLimit:null,dailyLossEnabled,maxLosingStreak:losingStreakEnabled?maxStreak:null,losingStreakEnabled};
}
function apply(state,decision,now=Date.now()){
  state.circuitBreaker={version:'32.0',generatedAt:now,...decision};return state.circuitBreaker;
}
module.exports={utcDay,evaluate,apply};
