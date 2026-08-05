'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function evaluate(results,options={}){
  const rows=Array.isArray(results)?results.filter(x=>Number.isFinite(Number(x.score??x.expectancy??x.value))):[];
  if(rows.length<3)return{available:false,status:'INSUFFICIENT_DATA',score:50,points:rows.length};
  const values=rows.map(x=>n(x.score??x.expectancy??x.value));
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const variance=values.reduce((a,b)=>a+(b-mean)**2,0)/values.length;
  const sd=Math.sqrt(variance);
  const cv=Math.abs(mean)>1e-9?sd/Math.abs(mean):Infinity;
  const positive=values.filter(x=>x>0).length/values.length;
  const best=Math.max(...values),worst=Math.min(...values);
  const status=cv<=0.35&&positive>=0.8?'STABLE':cv<=0.75&&positive>=0.6?'MIXED':'FRAGILE';
  const score=status==='STABLE'?100:status==='MIXED'?55:15;
  const required=Number.isFinite(+options.minScore)?+options.minScore:50;
  return{available:true,status,score,valid:score>=required,points:values.length,mean:+mean.toFixed(4),sd:+sd.toFixed(4),cv:Number.isFinite(cv)?+cv.toFixed(3):null,positiveRatio:+positive.toFixed(3),best:+best.toFixed(4),worst:+worst.toFixed(4)};
}
module.exports={evaluate};
