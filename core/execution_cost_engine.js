'use strict';

function n(v,f=0){const x=Number(v);return Number.isFinite(x)?x:f;}
function evaluate(input={},options={}){
  const entry=n(input.entry),stop=n(input.stop),target=n(input.target);
  const feeBps=n(input.feeBps, n(options.feeBps,6));
  const slippageBps=n(input.slippageBps,n(options.slippageBps,4));
  const spreadBps=n(input.spreadBps,n(options.spreadBps,2));
  const side=String(input.side||'LONG').toUpperCase();
  const risk=Math.abs(entry-stop);
  const reward=side==='LONG'?target-entry:entry-target;
  if(!(entry>0&&risk>0&&reward>0))return{valid:false,reason:'INVALID_TRADE_GEOMETRY',netRR:0};
  const roundTripCost=entry*(2*feeBps+slippageBps+spreadBps)/10000;
  const grossRR=reward/risk;
  const netReward=reward-roundTripCost;
  const netRR=netReward/risk;
  const minNetRR=n(options.minNetRR,1.5);
  const costToRisk=roundTripCost/risk;
  return{valid:netRR>=minNetRR,reason:netRR>=minNetRR?'EXECUTION_COST_ACCEPTABLE':'NET_RR_TOO_LOW',grossRR:+grossRR.toFixed(3),netRR:+netRR.toFixed(3),roundTripCost:+roundTripCost.toFixed(8),costToRisk:+costToRisk.toFixed(3),feeBps,slippageBps,spreadBps};
}
module.exports={evaluate};
