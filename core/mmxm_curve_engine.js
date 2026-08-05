'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function evaluate(candles, lookback=60){
  const rows=(candles||[]).slice(-lookback);
  if(rows.length<20)return{valid:false,phase:'UNKNOWN',bias:'NEUTRAL',reason:'INSUFFICIENT_DATA'};
  const highs=rows.map(x=>n(x.h)), lows=rows.map(x=>n(x.l));
  const high=Math.max(...highs), low=Math.min(...lows), last=n(rows.at(-1).c);
  const pos=(last-low)/Math.max(high-low,1e-9);
  const q=Math.floor(rows.length/4);
  const means=[0,1,2,3].map(i=>{
    const s=rows.slice(i*q,i===3?rows.length:(i+1)*q);
    return s.reduce((a,x)=>a+n(x.c),0)/s.length;
  });
  const rising=means[3]>means[2]&&means[2]>means[1];
  const falling=means[3]<means[2]&&means[2]<means[1];
  let phase='REACCUMULATION',bias='NEUTRAL';
  if(rising&&pos>=0.65){phase='BUY_MODEL_DISTRIBUTION';bias='LONG';}
  else if(falling&&pos<=0.35){phase='SELL_MODEL_DISTRIBUTION';bias='SHORT';}
  else if(pos<0.35){phase='ACCUMULATION';bias='LONG';}
  else if(pos>0.65){phase='DISTRIBUTION';bias='SHORT';}
  return{valid:true,phase,bias,curvePosition:+pos.toFixed(3),quartile:Math.min(4,Math.floor(pos*4)+1),range:{high,low},means:means.map(x=>+x.toFixed(4)),reason:'MMXM_CURVE_CLASSIFIED'};
}
module.exports={evaluate};
