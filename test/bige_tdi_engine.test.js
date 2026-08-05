'use strict';
const assert=require('assert');
const B=require('../core/bige_tdi_engine');
const rows=[];
for(let i=0;i<45;i++){
  const c=i<25?120-i*0.5:107.5+(i-25)*0.8;
  rows.push({t:i,o:c-0.2,h:c+0.6,l:c-0.6,c});
}
const ha=B.heikenAshi(rows);
assert.equal(ha.length,rows.length);
assert.ok(ha.every(x=>x.h>=x.o&&x.h>=x.c));
const st=B.stochastic(rows);
assert.equal(st.k.length,rows.length);
const r=B.evaluate(rows);
assert.ok(['BIGE_CONFIRMED','TDI_CROSS_MISSING','TDI_ANGLE_WEAK','STOCHASTIC_NOT_CONFIRMED','HEIKEN_ASHI_NOT_CONFIRMED'].includes(r.reason));
assert.equal(B.evaluate(rows.slice(0,10)).reason,'INSUFFICIENT_DATA');
console.log('bige_tdi_engine tests passed');
