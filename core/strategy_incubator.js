'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function group(trades,key='model'){
  const map=new Map();for(const t of trades||[]){const k=t?.[key]||'UNKNOWN';if(!map.has(k))map.set(k,[]);map.get(k).push(t);}return map;
}
function summarize(rows){
  const values=(rows||[]).map(t=>n(t.resultR??t.r));
  const wins=values.filter(x=>x>0).length;
  const expectancy=values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
  let eq=0,peak=0,dd=0;for(const r of values){eq+=r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
  return{trades:values.length,wins,winRate:values.length?100*wins/values.length:0,expectancy:+expectancy.toFixed(4),totalR:+values.reduce((a,b)=>a+b,0).toFixed(3),maxDrawdownR:+dd.toFixed(3)};
}
function evaluate(trades,options={}){
  const minShadow=Number.isFinite(+options.minShadowTrades)?+options.minShadowTrades:15;
  const minPromotion=Number.isFinite(+options.minPromotionTrades)?+options.minPromotionTrades:30;
  const minExpectancy=Number.isFinite(+options.minExpectancy)?+options.minExpectancy:0.08;
  const maxDrawdown=Number.isFinite(+options.maxDrawdownR)?+options.maxDrawdownR:6;
  const champions=new Set(options.champions||[]);
  const rows=[];
  for(const [model,items] of group(trades,options.modelKey).entries()){
    const metrics=summarize([...items].sort((a,b)=>n(a.closedAt)-n(b.closedAt)));
    let status='SHADOW';
    if(champions.has(model))status='CHAMPION';
    else if(metrics.trades>=minPromotion&&metrics.expectancy>=minExpectancy&&metrics.maxDrawdownR<=maxDrawdown)status='READY';
    else if(metrics.trades>=minShadow&&metrics.expectancy<0)status='REJECTED';
    else if(metrics.trades>=minShadow)status='CHALLENGER';
    rows.push({model,status,...metrics,reason:status==='READY'?'promotion criteria met':status==='REJECTED'?'negative shadow expectancy':status==='CHAMPION'?'current production champion':status==='CHALLENGER'?'collecting confirmation samples':'insufficient shadow sample'});
  }
  rows.sort((a,b)=>b.expectancy-a.expectancy||b.trades-a.trades);
  return{version:'33.0',generatedAt:Number.isFinite(+options.now)?+options.now:Date.now(),minShadowTrades:minShadow,minPromotionTrades:minPromotion,champions:rows.filter(x=>x.status==='CHAMPION'),ready:rows.filter(x=>x.status==='READY'),challengers:rows.filter(x=>x.status==='CHALLENGER'||x.status==='SHADOW'),rejected:rows.filter(x=>x.status==='REJECTED'),strategies:rows};
}
module.exports={group,summarize,evaluate};
