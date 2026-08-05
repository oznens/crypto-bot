'use strict';

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function mulberry32(seed){return function(){let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function maxDrawdown(sequence){let equity=0,peak=0,max=0;for(const r of sequence){equity+=r;peak=Math.max(peak,equity);max=Math.max(max,peak-equity);}return max;}
function percentile(values,p){if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor((s.length-1)*p))];}
function evaluate(trades,options={}){
  const returns=(trades||[]).map(x=>n(x.resultR??x.r));
  const minTrades=Number.isFinite(+options.minTrades)?+options.minTrades:30;
  if(returns.length<minTrades)return{available:false,status:'INSUFFICIENT_DATA',score:50,trades:returns.length};
  const simulations=Number.isFinite(+options.simulations)?+options.simulations:500;
  const rng=mulberry32(Number.isFinite(+options.seed)?+options.seed:1337);
  const totals=[],drawdowns=[],negative=[];
  for(let s=0;s<simulations;s++){
    const seq=[];for(let i=0;i<returns.length;i++)seq.push(returns[Math.floor(rng()*returns.length)]);
    const total=seq.reduce((a,b)=>a+b,0);totals.push(total);drawdowns.push(maxDrawdown(seq));negative.push(total<=0?1:0);
  }
  const lossProbability=negative.reduce((a,b)=>a+b,0)/simulations;
  const p05=percentile(totals,0.05),dd95=percentile(drawdowns,0.95);
  const status=lossProbability>0.35||p05<0?'FRAGILE':lossProbability>0.15?'CAUTION':'ROBUST';
  const score=status==='ROBUST'?100:status==='CAUTION'?55:15;
  return{available:true,status,score,trades:returns.length,simulations,lossProbability:+lossProbability.toFixed(3),totalR_P05:+p05.toFixed(3),maxDrawdownR_P95:+dd95.toFixed(3)};
}
module.exports={maxDrawdown,percentile,evaluate};
