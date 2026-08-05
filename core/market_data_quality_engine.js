'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function evaluate(candles,options={}){
  const rows=Array.isArray(candles)?candles:[];
  const minBars=Number.isFinite(+options.minBars)?+options.minBars:50;
  if(rows.length<minBars)return{valid:false,score:0,reason:'INSUFFICIENT_BARS',bars:rows.length};
  let invalid=0,duplicates=0,nonIncreasing=0,gaps=0,outliers=0;
  const intervals=[];
  for(let i=0;i<rows.length;i++){
    const c=rows[i];const vals=[n(c.t),n(c.o),n(c.h),n(c.l),n(c.c)];
    if(vals.some(v=>v==null)||!(+c.h>=Math.max(+c.o,+c.c)&&+c.l<=Math.min(+c.o,+c.c)&&+c.h>=+c.l))invalid++;
    if(i>0){const dt=+c.t-+rows[i-1].t;if(dt===0)duplicates++;if(dt<=0)nonIncreasing++;if(dt>0)intervals.push(dt);}
  }
  const sorted=[...intervals].sort((a,b)=>a-b);const median=sorted.length?sorted[Math.floor(sorted.length/2)]:0;
  const maxGapMultiplier=Number.isFinite(+options.maxGapMultiplier)?+options.maxGapMultiplier:2.5;
  for(const dt of intervals)if(median>0&&dt>median*maxGapMultiplier)gaps++;
  const ranges=rows.map(c=>(+c.h-+c.l)/Math.max(Math.abs(+c.c),1e-9)).filter(Number.isFinite).sort((a,b)=>a-b);
  const medianRange=ranges.length?ranges[Math.floor(ranges.length/2)]:0;
  for(const r of ranges)if(medianRange>0&&r>medianRange*12)outliers++;
  const penalty=invalid*20+duplicates*20+nonIncreasing*25+gaps*8+outliers*5;
  const score=Math.max(0,100-penalty);
  const valid=invalid===0&&duplicates===0&&nonIncreasing===0&&gaps<=Math.max(1,Math.floor(rows.length*0.01))&&score>=80;
  return{valid,score,bars:rows.length,medianIntervalMs:median,invalid,duplicates,nonIncreasing,gaps,outliers,reason:valid?'MARKET_DATA_HEALTHY':invalid?'INVALID_OHLC':duplicates?'DUPLICATE_CANDLES':nonIncreasing?'CANDLE_TIME_ORDER_INVALID':gaps?'CANDLE_GAPS_DETECTED':'MARKET_DATA_QUALITY_LOW'};
}
module.exports={evaluate};
