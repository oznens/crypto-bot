'use strict';

const GROUPS={BTC:['BTC','WBTC'],ETH:['ETH','WETH'],SOL:['SOL'],USD:['USDT','USDC','DAI']};
function root(symbol){const s=String(symbol||'').toUpperCase();for(const[k,items]of Object.entries(GROUPS))if(items.some(x=>s.includes(x)))return k;return s.replace(/USDT|USDC|USD|PERP|[-_/]/g,'');}
function evaluate(openTrades,symbol,side,options={}){
 const rows=Array.isArray(openTrades)?openTrades:[];const group=root(symbol);const same=rows.filter(t=>root(t.symbol)===group&&String(t.side).toUpperCase()===String(side).toUpperCase());
 const related=rows.filter(t=>{const g=root(t.symbol);return g===group||(group==='BTC'&&['ETH','SOL'].includes(g))||(group==='ETH'&&['BTC','SOL'].includes(g));});
 const maxSame=Number.isFinite(+options.maxSameGroup)?+options.maxSameGroup:1;const maxRelated=Number.isFinite(+options.maxRelated)?+options.maxRelated:3;
 const blocked=same.length>=maxSame||related.length>=maxRelated;
 const multiplier=blocked?0:(related.length===maxRelated-1?0.5:same.length?0.5:1);
 return{valid:!blocked,group,sameDirectionCount:same.length,relatedCount:related.length,riskMultiplier:multiplier,reason:blocked?'CORRELATION_EXPOSURE_LIMIT':multiplier<1?'CORRELATION_RISK_REDUCED':'CORRELATION_ACCEPTABLE'};
}
module.exports={root,evaluate};
