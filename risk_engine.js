// V4 Risk Engine
// Portfolio safety layer: weekly loss, directional exposure,
// correlation groups and trade admission checks.

const CORR_GROUPS = {
  BTC_BETA: ['BTC','ETH','SOL','AVAX','ARB','OP'],
  L1: ['SOL','SUI','APT','SEI','AVAX'],
  MEME: ['DOGE','PEPE','WIF','BONK','FLOKI']
};

function symbolBase(symbol){
  return String(symbol).replace('_USDT','').replace('USDT','').toUpperCase();
}

function groupOf(symbol){
  const s=symbolBase(symbol);
  for(const [g,list] of Object.entries(CORR_GROUPS)){
    if(list.includes(s)) return g;
  }
  return 'OTHER';
}

function directionalRisk(open, side){
  return open.filter(t=>t.side===side && !t.deriskDone)
    .reduce((a,t)=>a+(t.riskUSD||0),0);
}

function groupCount(open, symbol){
  const g=groupOf(symbol);
  return open.filter(t=>groupOf(t.symbol)===g).length;
}

function canOpen(state, candidate, limits={}){
  const maxDirectional = limits.maxDirectionalRisk || state.equity*0.03;
  const maxGroupTrades = limits.maxGroupTrades || 2;

  if(directionalRisk(state.open,candidate.side)+candidate.riskUSD>maxDirectional)
    return {ok:false,reason:'directional_risk'};

  if(groupCount(state.open, candidate.symbol)>=maxGroupTrades)
    return {ok:false,reason:'correlation_group'};

  return {ok:true};
}

function lossGuard(state){
  const now=Date.now();
  const week=state.closed.filter(t=>now-t.closedAt<604800000)
    .reduce((a,t)=>a+(t.r||0),0);

  return {
    blocked: week<=-5,
    weekR:week
  };
}

module.exports={canOpen,lossGuard,groupOf};
