'use strict';

/*
 * Son 30 gün — paper ile aynı strateji parametrelerini strategy_config.js'den okur.
 * Tarihsel yürütme/lookahead korumaları backtest3ay.js içinde kalır.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const CFG = require('./strategy_config');

process.env.GUN = process.env.GUN || '30';
process.env.SYMS = process.env.SYMS || String(CFG.MAX_SYMS);

const filename = path.join(__dirname, 'backtest3ay.js');
let src = fs.readFileSync(filename, 'utf8');

const q = v => Number.isFinite(v) ? String(v) : 'Number.POSITIVE_INFINITY';

src = src.replace(
  /const START_EQ = 10000, RISK_PCT = 0\.01, LEV_CAP = 10;/,
  `const START_EQ = ${q(CFG.START_EQ)}, RISK_PCT = ${q(CFG.RISK_PCT)}, LEV_CAP = ${q(CFG.LEVERAGE_CAP)};`
);
src = src.replace(
  /const MAX_OPEN = 6, MAX_NEW_PER_BUCKET = 2, BUCKET_MS = 5 \* 60000;/,
  `const MAX_OPEN = ${q(CFG.MAX_OPEN)}, MAX_NEW_PER_BUCKET = ${q(CFG.MAX_NEW_PER_RUN)}, BUCKET_MS = 5 * 60000;`
);
src = src.replace(
  /const MIN_CONF = 75, TP1_R = 1\.5;/,
  `const MIN_CONF = ${q(CFG.MIN_CONF)}, TP1_R = ${q(CFG.TP1_R)};`
);
src = src.replace(
  /const FEE_TAKER = 0\.0002, FEE_MAKER = 0\.0001, SLIP = 0\.0005;/,
  `const FEE_TAKER = ${q(CFG.FEE_TAKER)}, FEE_MAKER = ${q(CFG.FEE_MAKER)}, SLIP = ${q(CFG.SLIP)};`
);
src = src.replace(
  "const TF_LIST = [['1d', '60m'], ['4h', '15m'], ['60m', '15m'], ['15m', '5m']];",
  `const TF_LIST = [['${CFG.TF}', '${CFG.LTF}']];`
);
src = src.replace(
  /const MIN_RISK = \{ '15m': 0\.008, '60m': 0\.012, '4h': 0\.02, '1d': 0\.03 \};/,
  `const MIN_RISK = { '${CFG.TF}': ${q(CFG.MIN_RISK)} };`
);

const checks = [
  `const TF_LIST = [['${CFG.TF}', '${CFG.LTF}']];`,
  `RISK_PCT = ${q(CFG.RISK_PCT)}`,
  `MIN_CONF = ${q(CFG.MIN_CONF)}`,
  `TP1_R = ${q(CFG.TP1_R)}`,
  `MAX_OPEN = ${q(CFG.MAX_OPEN)}`,
  `SLIP = ${q(CFG.SLIP)}`
];
for (const s of checks) if (!src.includes(s)) throw new Error('Ortak config override uygulanamadı: ' + s);

console.log('strategy_config.js kullanılıyor:', JSON.stringify({
  syms: CFG.MAX_SYMS, tf: CFG.TF, ltf: CFG.LTF, minConf: CFG.MIN_CONF,
  riskPct: CFG.RISK_PCT, minRisk: CFG.MIN_RISK, tp1R: CFG.TP1_R,
  maxOpen: CFG.MAX_OPEN, maxNew: CFG.MAX_NEW_PER_RUN,
  feeTaker: CFG.FEE_TAKER, feeMaker: CFG.FEE_MAKER, slip: CFG.SLIP,
  leverageCap: Number.isFinite(CFG.LEVERAGE_CAP) ? CFG.LEVERAGE_CAP : 'Infinity'
}));

const m = new Module(filename, module);
m.filename = filename;
m.paths = module.paths;
m._compile(src, filename);
