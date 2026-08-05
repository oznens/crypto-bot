'use strict';

function quarterFor(timestamp, minutes = 90) {
  const d = new Date(timestamp);
  const minuteOfDay = d.getUTCHours()*60 + d.getUTCMinutes();
  const index = Math.floor(minuteOfDay / minutes);
  return { index, startMinute:index*minutes, endMinute:(index+1)*minutes, label:`Q${index+1}` };
}

function rangeForQuarter(candles, quarter) {
  const rows=(candles||[]).filter(c=>quarterFor(c.t).index===quarter.index);
  if(!rows.length)return null;
  return { high:Math.max(...rows.map(x=>+x.h)), low:Math.min(...rows.map(x=>+x.l)), open:+rows[0].o, close:+rows[rows.length-1].c, count:rows.length };
}

function evaluate(candles) {
  const rows=Array.isArray(candles)?candles:[];
  if(!rows.length)return{valid:false,reason:'NO_CANDLES'};
  const current=quarterFor(rows[rows.length-1].t);
  const previous={...current,index:Math.max(0,current.index-1),label:`Q${Math.max(1,current.index)}`};
  const prevRange=rangeForQuarter(rows,previous);
  const last=rows[rows.length-1];
  if(!prevRange)return{valid:false,current,reason:'PREVIOUS_QUARTER_MISSING'};
  const long=+last.l<prevRange.low&&+last.c>prevRange.low;
  const short=+last.h>prevRange.high&&+last.c<prevRange.high;
  return { valid:long||short, side:long?'LONG':short?'SHORT':null, current, previous, previousRange:prevRange, reason:long||short?'QUARTER_LIQUIDITY_REVERSAL':'NO_QUARTER_REVERSAL' };
}

module.exports={quarterFor,rangeForQuarter,evaluate};
