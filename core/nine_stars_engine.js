'use strict';

function body(c){return Math.abs(+c.c-+c.o);}
function range(c){return Math.max(+c.h-+c.l,1e-9);}
function evaluate(candles,options={}){
  const rows=(candles||[]).slice(-9);
  if(rows.length<9)return{valid:false,reason:'INSUFFICIENT_DATA'};
  const dirs=rows.map(c=>+c.c>+c.o?1:+c.c<+c.o?-1:0);
  const bull=dirs.filter(x=>x>0).length,bear=dirs.filter(x=>x<0).length;
  const impulseSide=bull>=7?'LONG':bear>=7?'SHORT':null;
  const first=rows.slice(0,6),last=rows.slice(6);
  const avgBody=first.reduce((s,c)=>s+body(c),0)/first.length;
  const exhaustion=last.reduce((s,c)=>s+body(c)/range(c),0)/last.length<0.45;
  const reversal=impulseSide==='LONG'?+rows.at(-1).c<+rows.at(-1).o:impulseSide==='SHORT'?+rows.at(-1).c>+rows.at(-1).o:false;
  const continuation=impulseSide==='LONG'?+rows.at(-1).c>Math.max(...rows.slice(0,8).map(x=>+x.h)):impulseSide==='SHORT'?+rows.at(-1).c<Math.min(...rows.slice(0,8).map(x=>+x.l)):false;
  const mode=continuation?'CONTINUATION':exhaustion&&reversal?'EXHAUSTION_REVERSAL':'INCOMPLETE';
  const side=mode==='EXHAUSTION_REVERSAL'?(impulseSide==='LONG'?'SHORT':'LONG'):impulseSide;
  const valid=!!impulseSide&&mode!=='INCOMPLETE';
  return{valid,side,impulseSide,mode,bullCount:bull,bearCount:bear,avgBody:+avgBody.toFixed(8),exhaustion,reversal,continuation,score:valid?(mode==='CONTINUATION'?80:100):0,reason:valid?'NINE_STARS_CONFIRMED':!impulseSide?'NINE_STARS_DIRECTION_MISSING':'NINE_STARS_SEQUENCE_INCOMPLETE'};
}
module.exports={body,range,evaluate};
