'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function evaluate(zone,candles,side,options={}){
  if(!zone||!Array.isArray(candles)||!candles.length)return{valid:false,reason:'ZONE_DATA_MISSING',score:0};
  const top=n(zone.top),bottom=n(zone.bottom);if(!(top>bottom))return{valid:false,reason:'ZONE_GEOMETRY_INVALID',score:0};
  const from=Math.max(0,Number.isFinite(+zone.from)?+zone.from:0);
  const after=candles.slice(from);
  let touches=0;for(const c of after){if(+c.l<=top&&+c.h>=bottom)touches++;}
  const departure=after.slice(0,Math.min(5,after.length));
  const zoneWidth=top-bottom;
  const move=side==='LONG'?Math.max(...departure.map(x=>+x.h))-top:bottom-Math.min(...departure.map(x=>+x.l));
  const displacement=move/Math.max(zoneWidth,1e-9);
  const fresh=Math.max(0,1-(touches-1)*0.25);
  const compression=after.slice(-5).reduce((s,c)=>s+(+c.h-+c.l),0)/Math.max(5*zoneWidth,1e-9);
  const score=Math.round(Math.max(0,Math.min(100,35*Math.min(displacement/3,1)+35*fresh+20*Math.min(compression/2,1)+10*(touches<=2?1:0))));
  const minScore=Number.isFinite(+options.minScore)?+options.minScore:65;
  return{valid:score>=minScore,score,side,touches,displacement:+displacement.toFixed(3),freshness:+fresh.toFixed(3),compression:+compression.toFixed(3),zone:{top,bottom},reason:score>=minScore?'HPS_ZONE_CONFIRMED':'HPS_ZONE_WEAK'};
}
module.exports={evaluate};
