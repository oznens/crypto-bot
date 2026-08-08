'use strict';

/*
 * 90 gun daha muhafazakar live-exact test:
 * - Her gunun Top30 evreni, o gunun MEXC PERP gunluk turnover'i ile yeniden kurulur.
 * - Sinyal ancak kendi gununde Top30'daysa kabul edilir.
 * - Ortak paper strateji parametreleri strategy_config.js'den gelir.
 * - Kaldirac: islem basi ve tum acik portfoy toplam notional <= 5x equity.
 *
 * Not: MEXC API bugun listelenmeyen/delist olmus kontratlari vermedigi icin tam anlamiyla
 * survivorship-bias-free degildir; ancak "bugunku Top30'u gecmise tasima" yanliligini kaldirir.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const CFG = require('./strategy_config');

process.env.GUN = process.env.GUN || '90';
const DAYS = +process.env.GUN;
const TOPN = CFG.MAX_SYMS;
const TOTAL_LEV_CAP = +(process.env.BT_LEV_CAP || 5);
const nowSec = Math.floor(Date.now() / 1000);
const startSec = nowSec - (DAYS + 3) * 86400;

function get(url, timeout=25000) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout }, x => {
      let b=''; x.on('data', d => b += d);
      x.on('end', () => { try { res(JSON.parse(b)); } catch(e) { rej(new Error('json '+x.statusCode+' '+url)); } });
    });
    r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dailyTurnover(sym) {
  const url = 'https://contract.mexc.com/api/v1/contract/kline/' + sym + '?interval=Day1&start=' + startSec + '&end=' + nowSec;
  for (let a=0;a<3;a++) {
    try {
      const j = await get(url);
      const d = j.data || {};
      if (!d.time || !d.time.length) return [];
      const out=[];
      for (let i=0;i<d.time.length;i++) {
        const close=+d.close[i] || 0, vol=+d.vol[i] || 0;
        // MEXC contract kline cevabinda amount varsa quote turnover olarak tercih et.
        const amount = d.amount && isFinite(+d.amount[i]) ? +d.amount[i] : close * vol;
        out.push({ t:d.time[i]*1000, turnover:amount });
      }
      return out;
    } catch(e) { if (a===2) return []; await sleep(500*(a+1)); }
  }
  return [];
}

async function buildUniverse() {
  const tick = await get('https://contract.mexc.com/api/v1/contract/ticker');
  const syms = (tick.data || []).filter(x => /_USDT$/.test(x.symbol)).map(x => x.symbol);
  console.log('Tarihsel hacim evreni icin mevcut kontrat:', syms.length);
  const byDay = new Map();
  let done=0;
  const workers = Math.min(8, syms.length);
  let idx=0;
  async function worker() {
    while (true) {
      const i=idx++; if (i>=syms.length) return;
      const sym=syms[i], rows=await dailyTurnover(sym);
      for (const r of rows) {
        const day=new Date(r.t).toISOString().slice(0,10);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push({ sym, turnover:r.turnover });
      }
      done++; if (done%40===0) console.log('  gunluk hacim:',done+'/'+syms.length);
      await sleep(70);
    }
  }
  await Promise.all(Array.from({length:workers},worker));

  const days={}; const union=new Set();
  for (const [day, arr] of [...byDay.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
    arr.sort((a,b)=>b.turnover-a.turnover);
    const top=arr.filter(x=>x.turnover>0).slice(0,TOPN).map(x=>x.sym);
    if (top.length) { days[day]=top; top.forEach(s=>union.add(s)); }
  }
  console.log('Gun sayisi:',Object.keys(days).length,'| tarihsel Top30 union:',union.size);
  return { days, union:[...union] };
}

(async()=>{
  const hist = await buildUniverse();
  const histFile = path.join(__dirname,'.hist_top30_90d.json');
  fs.writeFileSync(histFile, JSON.stringify(hist));

  const filename=path.join(__dirname,'backtest3ay.js');
  let src=fs.readFileSync(filename,'utf8');
  const q=v=>Number.isFinite(v)?String(v):'Number.POSITIVE_INFINITY';

  src=src.replace(
    /const START_EQ = 10000, RISK_PCT = 0\.01, LEV_CAP = 10;/,
    `const START_EQ = ${q(CFG.START_EQ)}, RISK_PCT = ${q(CFG.RISK_PCT)}, LEV_CAP = ${TOTAL_LEV_CAP};\nconst TOTAL_LEV_CAP = ${TOTAL_LEV_CAP};\nconst HIST_UNIVERSE = require('./.hist_top30_90d.json');`
  );
  src=src.replace(
    /const MAX_OPEN = 6, MAX_NEW_PER_BUCKET = 2, BUCKET_MS = 5 \* 60000;/,
    `const MAX_OPEN = ${q(CFG.MAX_OPEN)}, MAX_NEW_PER_BUCKET = ${q(CFG.MAX_NEW_PER_RUN)}, BUCKET_MS = 5 * 60000;`
  );
  src=src.replace(/const MIN_CONF = 75, TP1_R = 1\.5;/,`const MIN_CONF = ${q(CFG.MIN_CONF)}, TP1_R = ${q(CFG.TP1_R)};`);
  src=src.replace(/const FEE_TAKER = 0\.0002, FEE_MAKER = 0\.0001, SLIP = 0\.0005;/,`const FEE_TAKER = ${q(CFG.FEE_TAKER)}, FEE_MAKER = ${q(CFG.FEE_MAKER)}, SLIP = ${q(CFG.SLIP)};`);
  src=src.replace("const TF_LIST = [['1d', '60m'], ['4h', '15m'], ['60m', '15m'], ['15m', '5m']];",`const TF_LIST = [['${CFG.TF}', '${CFG.LTF}']];`);
  src=src.replace(/const MIN_RISK = \{ '15m': 0\.008, '60m': 0\.012, '4h': 0\.02, '1d': 0\.03 \};/,`const MIN_RISK = { '${CFG.TF}': ${q(CFG.MIN_RISK)} };`);

  const oldUniverse = `  const tick = await get('https://contract.mexc.com/api/v1/contract/ticker');\n  const syms = (tick.data || []).filter(x => /_USDT$/.test(x.symbol) && +x.amount24 > 0)\n    .sort((a, b) => +b.amount24 - +a.amount24).slice(0, N_SYM).map(x => x.symbol);`;
  const newUniverse = `  const syms = HIST_UNIVERSE.union;\n  console.log('Tarihsel gunluk Top${TOPN} union sembol:', syms.length);`;
  if (!src.includes(oldUniverse)) throw new Error('evren blogu bulunamadi');
  src=src.replace(oldUniverse,newUniverse);

  const pushNeedle = `        cands.push({ t: barT, sym, tf, side: s.side, entry, sl, tp1, tpF, conf: s.confidence, grade: s.grade,`;
  const pushReplacement = `        const dayKey = new Date(barT).toISOString().slice(0, 10);\n        const dayTop = HIST_UNIVERSE.days[dayKey] || [];\n        if (!dayTop.includes(sym)) continue; // sinyal gununde gercek tarihsel Top30 disindaysa alma\n        cands.push({ t: barT, sym, tf, side: s.side, entry, sl, tp1, tpF, conf: s.confidence, grade: s.grade,`;
  if (!src.includes(pushNeedle)) throw new Error('aday push noktasi bulunamadi');
  src=src.replace(pushNeedle,pushReplacement);

  const levNeedle = `    qty = Math.min(qty, eq * LEV_CAP / c.entry);\n    if (!(qty > 0)) continue;`;
  const levReplacement = `    qty = Math.min(qty, eq * LEV_CAP / c.entry);\n    const openNotional = open.reduce((sum, t) => sum + t.qty * t.entry, 0);\n    const availableNotional = Math.max(0, eq * TOTAL_LEV_CAP - openNotional);\n    qty = Math.min(qty, availableNotional / c.entry);\n    if (!(qty > 0)) continue;`;
  if (!src.includes(levNeedle)) throw new Error('kaldirac noktasi bulunamadi');
  src=src.replace(levNeedle,levReplacement);

  src=src.replace(
    /say\('\\nNOT: semboller BUGÜNKÜ hacim top-' \+ N_SYM \+ "'i \(seçim yanlılığı\); giriş = reclaim barı kapanışı;"\);/,
    `say('\\nNOT: sembol evreni HER GUN yeniden hesaplanan tarihsel turnover Top${TOPN}; mevcut/delist olmayan kontratlar nedeniyle kalan survivorship riski vardir;');\n  say('Toplam portfoy notional limiti = ${TOTAL_LEV_CAP}x equity; giris = reclaim bari kapanisi;');`
  );

  process.env.SYMS=String(hist.union.length);
  console.log('Test ayarlari:',JSON.stringify({days:DAYS, dailyTop:TOPN, union:hist.union.length, leverageCap:TOTAL_LEV_CAP, totalNotionalCap:TOTAL_LEV_CAP+'x', tf:CFG.TF, ltf:CFG.LTF, riskPct:CFG.RISK_PCT}));
  const m=new Module(filename,module); m.filename=filename; m.paths=module.paths; m._compile(src,filename);
})().catch(e=>{console.error('HATA',e.stack);process.exit(1);});
