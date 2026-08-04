'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'paper_engine.js');
let src = fs.readFileSync(file, 'utf8');

const oldBlock = `function recordRiskRejection(state, symbol, side, timeframe, decision) {
  state.riskRejections.unshift({
    t: Date.now(),
    symbol,
    side,
    tf: timeframe,
    reason: decision.reason,
    weekR: decision.weekR == null ? null : rnd(decision.weekR, 2),
    totalRiskUSD: decision.totalRiskUSD == null ? null : rnd(decision.totalRiskUSD, 2),
    directionalRiskUSD: decision.directionalRiskUSD == null ? null : rnd(decision.directionalRiskUSD, 2),
    correlated: decision.correlated == null ? null : decision.correlated
  });
  if (state.riskRejections.length > 100) state.riskRejections.length = 100;
}`;

const newBlock = `function recordRiskRejection(state, symbol, side, timeframe, decision) {
  const now = Date.now();
  const candidate = {
    symbol,
    side,
    tf: timeframe,
    reason: decision.reason
  };
  if (!TradePolicy.shouldRecordRiskRejection(state.riskRejections, candidate, { now })) return false;

  state.riskRejections.unshift({
    t: now,
    ...candidate,
    weekR: decision.weekR == null ? null : rnd(decision.weekR, 2),
    totalRiskUSD: decision.totalRiskUSD == null ? null : rnd(decision.totalRiskUSD, 2),
    directionalRiskUSD: decision.directionalRiskUSD == null ? null : rnd(decision.directionalRiskUSD, 2),
    correlated: decision.correlated == null ? null : decision.correlated
  });
  if (state.riskRejections.length > 100) state.riskRejections.length = 100;
  return true;
}`;

if (src.includes(newBlock)) {
  console.log('V5.4 zaten uygulanmış');
  process.exit(0);
}
if (!src.includes(oldBlock)) throw new Error('recordRiskRejection hedef bloğu bulunamadı');

src = src.replace(oldBlock, newBlock);
fs.writeFileSync(file, src);
console.log('V5.4 risk reddi tekrar engeli uygulandı');
