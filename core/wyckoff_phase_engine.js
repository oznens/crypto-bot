'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function evaluate(candles, lookback = 80) {
  const rows=(candles||[]).slice(-lookback);
  if(rows.length<20)return{valid:false,phase:'UNKNOWN',reason:'INSUFFICIENT_DATA'};
  const half=Math.floor(rows.length/2);
  const first=rows.slice(0,half),last=rows.slice(half);
  const hi1=Math.max(...first.map(x=>n(x.h))),lo1=Math.min(...first.map(x=>n(x.l)));
  const hi2=Math.max(...last.map(x=>n(x.h))),lo2=Math.min(...last.map(x=>n(x.l)));
  const close=n(last[last.length-1].c);
  const spring=lo2<lo1&&close>lo1;
  const upthrust=hi2>hi1&&close<hi1;
  const markup=close>hi1&&!upthrust;
  const markdown=close<lo1&&!spring;
  const phase=spring?'ACCUMULATION_SPRING':upthrust?'DISTRIBUTION_UPTHRUST':markup?'MARKUP':markdown?'MARKDOWN':'RANGE';
  const bias=/ACCUMULATION|MARKUP/.test(phase)?'LONG':/DISTRIBUTION|MARKDOWN/.test(phase)?'SHORT':'NEUTRAL';
  return{valid:true,phase,bias,spring,upthrust,range:{high:Math.max(hi1,hi2),low:Math.min(lo1,lo2)},reason:'WYCKOFF_PHASE_CLASSIFIED'};
}
module.exports={evaluate};
