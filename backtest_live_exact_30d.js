'use strict';

/*
 * Son 30 gün — canlı paper motoruyla aynı kurallar:
 * Top30, yalnız 60m + 15m LTF, güven >=75, A/A+, valid MMxM,
 * HTF bias, min stop %1.2, risk %1, TP1=1.5R,
 * maks 6 açık / 5 dakikalık bucket'ta maks 2 yeni işlem,
 * kaldıraç/notional tavanı YOK.
 *
 * Ana tarihsel simülatörü değiştirmeden, yalnız bu koşu için gerekli
 * sabitleri bellekte override eder. Lookahead korumaları ve 5m yönetimi
 * backtest3ay.js ile aynıdır.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.GUN = process.env.GUN || '30';
process.env.SYMS = process.env.SYMS || '30';

const filename = path.join(__dirname, 'backtest3ay.js');
let src = fs.readFileSync(filename, 'utf8');

src = src.replace(
  "const START_EQ = 10000, RISK_PCT = 0.01, LEV_CAP = 10;",
  "const START_EQ = 10000, RISK_PCT = 0.01, LEV_CAP = Number.POSITIVE_INFINITY;"
);

src = src.replace(
  "const TF_LIST = [['1d', '60m'], ['4h', '15m'], ['60m', '15m'], ['15m', '5m']];",
  "const TF_LIST = [['60m', '15m']];"
);

if (!src.includes("const TF_LIST = [['60m', '15m']];")) {
  throw new Error('TF_LIST override uygulanamadı');
}
if (!src.includes('LEV_CAP = Number.POSITIVE_INFINITY')) {
  throw new Error('Kaldıraç tavanı override uygulanamadı');
}

const m = new Module(filename, module);
m.filename = filename;
m.paths = module.paths;
m._compile(src, filename);
