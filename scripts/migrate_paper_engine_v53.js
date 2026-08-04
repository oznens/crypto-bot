'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'paper_engine.js');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

function replaceOnce(from, to, label) {
  if (src.includes(to)) return;
  if (!src.includes(from)) throw new Error('Migration target missing: ' + label);
  src = src.replace(from, to);
  changed = true;
}

replaceOnce(
  "const Risk = require('./core/risk_engine');\nconst { detect: detectRegime } = require('./core/regime_detector');",
  "const Risk = require('./core/risk_engine');\nconst TradePolicy = require('./core/paper_trade_policy');\nconst { detect: detectRegime } = require('./core/regime_detector');",
  'policy import'
);

replaceOnce(
`function updateExcursion(trade, candle) {
  const initialRiskDist = trade.initialRiskDist || Math.abs(trade.entry - trade.initialSL);
  if (!(initialRiskDist > 0)) return;
  const long = trade.side === 'LONG';
  const favorable = long ? candle.h - trade.entry : trade.entry - candle.l;
  const adverse = long ? trade.entry - candle.l : candle.h - trade.entry;
  trade.mfeR = Math.max(trade.mfeR || 0, favorable / initialRiskDist);
  trade.maeR = Math.max(trade.maeR || 0, adverse / initialRiskDist);
}`,
`function updateExcursion(trade, candle, options) {
  return TradePolicy.applyExcursion(trade, candle, options);
}`,
  'excursion adapter'
);

replaceOnce(
`      const long = trade.side === 'LONG';
      updateExcursion(trade, candle);

      const hitSL = long ? candle.l <= trade.sl : candle.h >= trade.sl;
      const hitT1 = !trade.deriskDone && (long ? candle.h >= trade.tp1 : candle.l <= trade.tp1);`,
`      const long = trade.side === 'LONG';
      const hitSL = long ? candle.l <= trade.sl : candle.h >= trade.sl;
      updateExcursion(trade, candle, { stopFirst: hitSL });

      const hitT1 = !trade.deriskDone && (long ? candle.h >= trade.tp1 : candle.l <= trade.tp1);`,
  'stop-first excursion ordering'
);

replaceOnce(
`  const riskUSD = rnd(state.equity * RISK_PCT, 2);
  const riskDecision = Risk.evaluateTrade(state, {
    symbol,
    side: setup.side,
    riskUSD
  }, RISK_CONFIG);
  if (!riskDecision.allowed) {
    recordRiskRejection(state, symbol, setup.side, timeframe, riskDecision);
    return null;
  }

  let qty = riskUSD / riskDist;
  qty = Math.min(qty, state.equity * LEV_CAP / entry);
  if (!(qty > 0)) return null;`,
`  const position = TradePolicy.calculatePosition({
    equity: state.equity,
    riskPct: RISK_PCT,
    leverageCap: LEV_CAP,
    entry,
    stop
  });
  if (!position.valid) return null;

  const qty = position.qty;
  const riskUSD = rnd(position.actualRiskUSD, 2);
  const riskDecision = Risk.evaluateTrade(state, {
    symbol,
    side: setup.side,
    riskUSD
  }, RISK_CONFIG);
  if (!riskDecision.allowed) {
    recordRiskRejection(state, symbol, setup.side, timeframe, riskDecision);
    return null;
  }`,
  'actual risk position sizing'
);

replaceOnce(
`    riskUSD,
    rrPlan: setup.rr,`,
`    riskUSD,
    plannedRiskUSD: rnd(position.plannedRiskUSD, 2),
    leverageCapped: position.leverageCapped,
    rrPlan: setup.rr,`,
  'position diagnostics'
);

if (changed) {
  fs.writeFileSync(file, src);
  console.log('paper_engine.js V5.3 migration applied');
} else {
  console.log('paper_engine.js already on V5.3');
}
