'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function evaluate(candles, side, options={}){
  const rows=Array.isArray(candles)?candles:[];
  const lookback=Number.isFinite(+options.lookback)?+options.lookback:20;
  if(rows.length<lookback+3)return{valid:false,reason:'INSUFFICIENT_DATA'};
  const base=rows.slice(-(lookback+3),-3);
  const breakout=rows.at(-3), tap=rows.at(-2), confirm=rows.at(-1);
  const high=Math.max(...base.map(x=>n(x.h))), low=Math.min(...base.map(x=>n(x.l)));
  const tol=Number.isFinite(+options.tolerancePct)?+options.tolerancePct:0.0015;
  const longBreak=n(breakout.c)>high;
  const longTap=Math.abs(n(tap.l)-high)/Math.max(high,1e-9)<=tol&&n(tap.c)>=high;
  const longConfirm=n(confirm.c)>n(tap.h);
  const shortBreak=n(breakout.c)<low;
  const shortTap=Math.abs(n(tap.h)-low)/Math.max(low,1e-9)<=tol&&n(tap.c)<=low;
  const shortConfirm=n(confirm.c)<n(tap.l);
  const valid=side==='LONG'?longBreak&&longTap&&longConfirm:side==='SHORT'?shortBreak&&shortTap&&shortConfirm:false;
  return{valid,side,level:side==='LONG'?high:low,breakout:side==='LONG'?longBreak:shortBreak,firstTap:side==='LONG'?longTap:shortTap,confirmation:side==='LONG'?longConfirm:shortConfirm,reason:valid?'SBS_BREAKOUT_FIRST_TAP_CONFIRMED':'SBS_SEQUENCE_INCOMPLETE'};
}
module.exports={evaluate};
