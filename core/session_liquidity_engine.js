'use strict';

function nyParts(timestamp){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(timestamp));
  return {hour:+parts.find(x=>x.type==='hour').value,minute:+parts.find(x=>x.type==='minute').value};
}
function session(hour){
  if(hour>=19||hour<2)return'ASIA';
  if(hour>=2&&hour<7)return'LONDON';
  if(hour>=7&&hour<12)return'NEW_YORK_AM';
  return'OFF_SESSION';
}
function ranges(candles){
  const out={ASIA:[],LONDON:[],NEW_YORK_AM:[]};
  for(const c of candles||[]){const s=session(nyParts(c.t).hour);if(out[s])out[s].push(c);}
  const result={};
  for(const [k,rows] of Object.entries(out))if(rows.length)result[k]={high:Math.max(...rows.map(x=>+x.h)),low:Math.min(...rows.map(x=>+x.l)),count:rows.length};
  return result;
}
function evaluate(candles,side){
  const rows=Array.isArray(candles)?candles:[];
  if(!rows.length)return{valid:false,reason:'NO_CANDLES'};
  const map=ranges(rows.slice(0,-1));
  const last=rows.at(-1),current=session(nyParts(last.t).hour);
  const reference=current==='LONDON'?map.ASIA:current==='NEW_YORK_AM'?(map.LONDON||map.ASIA):null;
  if(!reference)return{valid:false,current,ranges:map,reason:'REFERENCE_SESSION_MISSING'};
  const sellSweep=+last.l<reference.low&&+last.c>reference.low;
  const buySweep=+last.h>reference.high&&+last.c<reference.high;
  const direction=sellSweep?'LONG':buySweep?'SHORT':null;
  return{valid:!!direction&&direction===side,side:direction,current,reference,sellSweep,buySweep,judas:!!direction,reason:direction===side?'SESSION_LIQUIDITY_REVERSAL':direction?'SESSION_DIRECTION_CONFLICT':'NO_SESSION_SWEEP'};
}
module.exports={nyParts,session,ranges,evaluate};
