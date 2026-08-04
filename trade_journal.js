// V4 Trade Journal Engine
// Stores structured trade diagnostics for optimization and walk-forward analysis.

function createSnapshot(trade){
  return {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    model: trade.model || null,
    grade: trade.grade || null,
    tf: trade.tf || null,
    confidence: trade.conf || null,
    mmxm: trade.mmxm || null,
    reasons: trade.reasons || [],
    entry: trade.entry,
    sl: trade.sl,
    tpF: trade.tpF,
    riskUSD: trade.riskUSD,
    openedAt: trade.openedAt,
    diagnostics: trade.diag || {},
    mfe: 0,
    mae: 0,
    maxR: 0,
    minR: 0
  };
}

function updateExcursion(record, price){
  if(!record || !price) return record;
  const risk = Math.abs(record.entry-record.sl);
  if(!risk) return record;

  const move = record.side==='LONG'
    ? price-record.entry
    : record.entry-price;

  const r = move/risk;
  if(r>record.mfe) record.mfe=Number(r.toFixed(2));
  if(r<record.mae) record.mae=Number(r.toFixed(2));
  if(r>record.maxR) record.maxR=Number(r.toFixed(2));
  if(r<record.minR) record.minR=Number(r.toFixed(2));
  return record;
}

function finalize(record, trade){
  return {
    ...record,
    closedAt: trade.closedAt,
    closeReason: trade.closeReason,
    realizedR: trade.r,
    realizedUSD: trade.realized
  };
}

module.exports={createSnapshot,updateExcursion,finalize};
