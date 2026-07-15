/*
 * paper_engine.js — 7/24 KAĞIT (paper) işlem motoru. GitHub Actions cron'unda çalışır.
 * - Evren: MEXC PERP (contract) hacme göre TOP 50 USDT paritesi; contract API kapalıysa spot yedeği.
 * - Sinyal: analysis.js (DREYKO×yigit×SolCJ×JB sistemi), 60m TF + 15m LTF onayı; GÜVEN >= %75.
 * - Emirler GERÇEKÇİ: MARKET giriş (taker komisyon %0.02 + %0.05 kayma), TP limit (maker %0.01),
 *   SL market (taker + kayma). Yönetim: TP1'de %50 derisk + SL→BE (CJ/JB kuralı), kalan TP2'de.
 * - Boyutlama: risk = özkaynağın %1'i (yigit), rölatif kaldıraç tavanı 10x.
 * - Durum: paper_state.json (+ docs/ kopyası — Pages panosu aynı origin'den okur).
 * Çalıştır: node paper_engine.js   (env: PAPER_MAX_SYMS=n test için)
 */
const https = require('https'), fs = require('fs'), path = require('path');
const A = require('./analysis');

const STATE_F = process.env.PAPER_STATE ? path.resolve(process.env.PAPER_STATE) : path.join(__dirname, 'paper_state.json');
const DOCS_F = path.join(__dirname, 'docs', 'paper_state.json');
const MAX_SYMS = +(process.env.PAPER_MAX_SYMS || 50);
const MIN_CONF = 75;                     // güven eşiği (%)
const START_EQ = 10000;                  // başlangıç özkaynak (USDT)
const RISK_PCT = 0.01;                   // işlem başına risk (yigit %1)
const LEV_CAP = 10;                      // notional tavanı = özkaynak × 10
const FEE_TAKER = 0.0002, FEE_MAKER = 0.0001, SLIP = 0.0005;
const TF_LIST = [['1d', '60m'], ['4h', '15m'], ['60m', '15m'], ['15m', '5m']];   // [sinyal TF, LTF onayı] — yüksek TF öncelikli
// ---- v2 SIKI FİLTRELER (50 işlemlik -40R analizinden: B notlular WR%5, dar stoplar gürültüye süpürüldü,
// aynı saatte 4-5 korele işlem, ters-bias shortlar; A+ ve GERÇEK✓ görece iyiydi) ----
const MIN_RISK = { '15m': 0.008, '60m': 0.012, '4h': 0.02, '1d': 0.03 };   // min stop mesafesi (giriş %'si)
const MAX_OPEN = 6;                    // toplam eşzamanlı pozisyon tavanı (korelasyon freni)
const MAX_NEW_PER_RUN = 2;             // koşum başına yeni işlem tavanı
const TP1_R = 1.5;                     // TP1 = 1.5R sabit (derisk gerçekten çalışsın); TP-F = yapısal hedef

function get(url, timeout) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: timeout || 20000 }, x => {
      let b = ''; x.on('data', d => b += d);
      x.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error('json ' + url.slice(0, 60))); } });
    });
    r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (v, d) => { const m = Math.pow(10, d == null ? 6 : d); return Math.round(v * m) / m; };

// ---- veri kaynağı: MEXC contract (perp) -> spot yedeği ----
let SRC = 'perp';
async function topSymbols() {
  try {
    const j = await get('https://contract.mexc.com/api/v1/contract/ticker');
    const list = (j.data || []).filter(x => /_USDT$/.test(x.symbol) && +x.amount24 > 0)
      .sort((a, b) => +b.amount24 - +a.amount24).slice(0, MAX_SYMS).map(x => x.symbol);
    if (list.length >= 5) return list;
    throw new Error('az sembol');
  } catch (e) {
    SRC = 'spot';
    const raw = await get('https://api.mexc.com/api/v3/ticker/24hr');
    const skip = /^(USDC|USDE|EUR|TUSD|FDUSD|DAI|BUSD|USTC|GUSD|PAX)/i;
    return raw.filter(x => x.symbol && x.symbol.endsWith('USDT') && !skip.test(x.symbol) && !/\d{3,}/.test(x.symbol))
      .sort((a, b) => (+b.quoteVolume || 0) - (+a.quoteVolume || 0)).slice(0, MAX_SYMS).map(x => x.symbol);
  }
}
const IV_PERP = { '1m': 'Min1', '5m': 'Min5', '15m': 'Min15', '60m': 'Min60', '4h': 'Hour4', '1d': 'Day1' };
const secPerBar = { '1m': 60, '5m': 300, '15m': 900, '60m': 3600, '4h': 14400, '1d': 86400 };
async function klines(sym, iv, bars) {
  if (SRC === 'perp') {
    const end = Math.floor(Date.now() / 1000), start = end - bars * secPerBar[iv];
    const j = await get('https://contract.mexc.com/api/v1/contract/kline/' + sym + '?interval=' + IV_PERP[iv] + '&start=' + start + '&end=' + end);
    const d = j.data || {};
    if (!d.time || !d.time.length) throw new Error('kline yok ' + sym);
    return d.time.map((t, i) => ({ t: t * 1000, o: +d.open[i], h: +d.high[i], l: +d.low[i], c: +d.close[i], v: +d.vol[i] }));
  }
  const spotSym = sym.replace('_', '');
  const raw = await get('https://api.mexc.com/api/v3/klines?symbol=' + spotSym + '&interval=' + iv + '&limit=' + Math.min(1000, bars));
  return raw.map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })).filter(x => isFinite(x.c) && x.c > 0);
}

// ---- durum ----
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_F, 'utf8')); }
  catch (e) { return { equity: START_EQ, startEquity: START_EQ, open: [], closed: [], recentSigs: [], equityHistory: [], lastRun: null, runs: 0 }; }
}
function saveState(st) {
  const s = JSON.stringify(st, null, 1);
  fs.writeFileSync(STATE_F, s);
  if (!process.env.PAPER_STATE) {                              // test modunda docs kopyasına dokunma
    try { fs.mkdirSync(path.dirname(DOCS_F), { recursive: true }); fs.writeFileSync(DOCS_F, s); } catch (e) {}
  }
}

// Panoda tıklanınca grafik çizilebilsin diye giriş anındaki mum + yapı anlık görüntüsü
function makeSnap(a) {
  const c = a.candles.slice(-132);
  const off = a.candles.length - c.length;
  const mp = a.structures.manipulation;
  return {
    candles: c.map(k => [Math.round(k.t / 1000), rnd(k.o), rnd(k.h), rnd(k.l), rnd(k.c)]),
    manip: mp ? { rangeFrom: mp.rangeFrom - off, rangeTo: mp.rangeTo - off, sweepAt: mp.sweepAt - off, at: mp.at - off, rangeHigh: mp.rangeHigh, rangeLow: mp.rangeLow, wick: mp.wick, side: mp.side } : null
  };
}

// ---- işlem yönetimi (gerçekçi dolumlar) ----
function closePart(st, tr, px, part, why, taker) {
  const qty = tr.qty * part;
  const gross = (tr.side === 'LONG' ? px - tr.entry : tr.entry - px) * qty;
  const fee = px * qty * (taker ? FEE_TAKER : FEE_MAKER);
  const pnl = gross - fee - (part === 1 || !tr.feeCharged ? tr.entryFee * (tr.feeCharged ? 0 : 1) : 0);
  if (!tr.feeCharged) tr.feeCharged = true;
  st.equity = rnd(st.equity + pnl, 2);
  tr.fills.push({ t: Date.now(), px: rnd(px), part: rnd(part, 3), why, pnl: rnd(pnl, 2) });
  tr.realized = rnd((tr.realized || 0) + pnl, 2);
  tr.qty = rnd(tr.qty - qty, 8);
  return pnl;
}
function finishTrade(st, tr, why) {
  tr.status = 'closed'; tr.closedAt = Date.now(); tr.closeReason = why;
  tr.r = rnd(tr.realized / tr.riskUSD, 2);
  st.closed.unshift(tr); if (st.closed.length > 400) st.closed.length = 400;
  st.closed.forEach((t, i) => { if (i >= 60 && t.snap) delete t.snap; });   // dosya şişmesin: grafik son 60 kapanışta kalır
  st.open = st.open.filter(x => x !== tr);
}
async function manageOpen(st) {
  for (const tr of [...st.open]) {
    let c5;
    try { c5 = await klines(tr.symbol, '5m', Math.min(900, Math.max(30, Math.ceil((Date.now() - tr.lastCheck) / 300000) + 10))); }
    catch (e) { continue; }
    const news = c5.filter(k => k.t > tr.lastCheck);
    for (const k of news) {
      const long = tr.side === 'LONG';
      const hitSL = long ? k.l <= tr.sl : k.h >= tr.sl;
      const hitT1 = !tr.deriskDone && (long ? k.h >= tr.tp1 : k.l <= tr.tp1);
      const hitTF = long ? k.h >= tr.tpF : k.l <= tr.tpF;
      if (hitSL) {                                            // muhafazakar: aynı barda SL önce
        const px = tr.sl * (long ? 1 - SLIP : 1 + SLIP);      // market SL: kayma + taker
        closePart(st, tr, px, 1, tr.deriskDone ? 'BE/SL' : 'SL', true);
        finishTrade(st, tr, tr.deriskDone ? 'BE' : 'SL');
        break;
      }
      if (hitT1 && tr.tp1 !== tr.tpF) {                       // TP1: %50 derisk (limit=maker) + SL->BE
        closePart(st, tr, tr.tp1, 0.5, 'TP1-derisk', false);
        tr.deriskDone = true; tr.sl = tr.entry;               // CJ/JB: SL -> BE
      }
      if (hitTF) {                                            // final TP (limit)
        closePart(st, tr, tr.tpF, 1, 'TP-final', false);
        finishTrade(st, tr, 'TP');
        break;
      }
    }
    // son mum hâlâ oluşuyor olabilir: lastCheck'i t-1 kur ki sonraki koşumda TAMAMLANMIŞ haliyle yeniden değerlendirilsin
    // (çift işlem riski yok: deriskDone ve closed guard'ları var)
    if (tr.status !== 'closed' && news.length) tr.lastCheck = news[news.length - 1].t - 1;
  }
}

// ---- yeni sinyal -> market giriş ----
function tryOpen(st, sym, a, mktPx, tf) {
  const s = a.setup; if (!s || s.confidence < MIN_CONF) return null;
  if (st.open.length >= MAX_OPEN) return null;                // v2: eşzamanlı pozisyon tavanı
  if (s.grade === 'B') return null;                           // v2: sadece A / A+ (B'ler WR %5 çıktı)
  if (!s.mmxm || !s.mmxm.valid) return null;                  // v2: sadece GERÇEK MMxM ✓ (LTF onaylı)
  if (a.htfBias && a.htfBias !== 'Neutral' && ((a.htfBias === 'Bullish') !== (s.side === 'LONG'))) return null;   // v2: yigit sert kuralı — ters bias'ta işlem yok
  if (st.open.find(t => t.symbol === sym)) return null;
  const mp = a.structures.manipulation; if (!mp) return null;
  const sig = sym + '|' + tf + '|' + s.side + '|' + (a.candles[mp.sweepAt] ? a.candles[mp.sweepAt].t : mp.sweepAt);
  if (st.recentSigs.includes(sig)) return null;
  const long = s.side === 'LONG';
  const entry = mktPx * (long ? 1 + SLIP : 1 - SLIP);         // MARKET giriş: aleyhte kayma
  const sl = s.stop, tps = s.tps;
  if (long ? sl >= entry : sl <= entry) return null;          // stop yanlış tarafta (fiyat kaçmış)
  const tpF = tps[tps.length - 1];
  if (long ? entry >= tpF : entry <= tpF) return null;        // hedef zaten geçilmiş
  const riskDist = Math.abs(entry - sl);
  if (riskDist / entry < (MIN_RISK[tf] || 0.01)) return null; // v2: dar stop = gürültü stopu -> işlem yok
  const rrAct = Math.abs(tpF - entry) / riskDist;
  if (rrAct < 1) return null;                                 // market girişten sonra en az 1R kalmalı
  let tp1 = long ? entry + TP1_R * riskDist : entry - TP1_R * riskDist;   // v2: TP1 = 1.5R (derisk çalışsın)
  if (long ? tp1 > tpF : tp1 < tpF) tp1 = tpF;
  const riskUSD = rnd(st.equity * RISK_PCT, 2);
  let qty = riskUSD / riskDist;
  qty = Math.min(qty, st.equity * LEV_CAP / entry);
  if (!(qty > 0)) return null;
  const entryFee = rnd(entry * qty * FEE_TAKER, 4);
  const tr = {
    id: sym + '-' + Date.now(), symbol: sym, side: s.side, src: SRC, tf,
    entry: rnd(entry), mkt: rnd(mktPx), slip: SLIP, entryFee, qty: rnd(qty, 8), notional: rnd(entry * qty, 2),
    sl: rnd(sl), tp1: rnd(tp1), tpF: rnd(tpF), riskUSD, rrPlan: s.rr,
    conf: s.confidence, grade: s.grade, model: s.model,
    mmxm: s.mmxm || null, reasons: (s.reasons || []).slice(0, 6),
    snap: makeSnap(a),                                          // panoda grafik için giriş anı görüntüsü
    openedAt: Date.now(), lastCheck: Date.now(), status: 'open', deriskDone: false, realized: 0, feeCharged: false, fills: []
  };
  st.open.push(tr);
  st.recentSigs.push(sig); if (st.recentSigs.length > 300) st.recentSigs.splice(0, st.recentSigs.length - 300);
  return tr;
}

(async () => {
  const st = loadState();
  st.runs = (st.runs || 0) + 1;
  console.log('== PAPER RUN #' + st.runs + ' ==');
  const syms = await topSymbols();
  console.log('kaynak:', SRC, '| sembol:', syms.length, '| özkaynak:', st.equity);

  await manageOpen(st);                                       // önce açık işlemleri güncelle

  let scanned = 0, opened = 0, errors = 0;
  for (const sym of syms) {
    if (opened >= MAX_NEW_PER_RUN || st.open.length >= MAX_OPEN) break;   // v2: koşum/toplam tavanları
    if (st.open.find(t => t.symbol === sym)) continue;        // sembolde açık işlem varsa tarama (TF fark etmez)
    for (const [tf, ltfIv] of TF_LIST) {                      // yüksek TF öncelikli; işlem açılınca diğer TF'lere bakma
      try {
        const cc = await klines(sym, tf, 500);
        if (cc.length < 80) { await sleep(80); continue; }
        let a = A.analyze(cc, { interval: tf, symbol: sym.replace('_', '') });
        scanned++;
        if (a.setup && a.setup.confidence >= MIN_CONF) {
          try {                                                // LTF onayı ile yeniden değerlendir (GERÇEK MMxM)
            const cl = await klines(sym, ltfIv, 500);
            a = A.analyze(cc, { interval: tf, symbol: sym.replace('_', ''), ltf: { interval: ltfIv, candles: cl } });
          } catch (e) {}
          if (a.setup && a.setup.confidence >= MIN_CONF) {
            const tr = tryOpen(st, sym, a, cc[cc.length - 1].c, tf);
            if (tr) { opened++; console.log('AÇILDI:', sym, tf, tr.side, 'giriş', tr.entry, 'SL', tr.sl, 'TP', tr.tp1 + '/' + tr.tpF, 'güven %' + tr.conf, tr.grade); break; }
          }
        }
      } catch (e) { errors++; }
      await sleep(80);
    }
    await sleep(60);
  }

  st.lastRun = Date.now();
  st.equityHistory.push({ t: st.lastRun, eq: st.equity, open: st.open.length });
  if (st.equityHistory.length > 2000) st.equityHistory.splice(0, st.equityHistory.length - 2000);
  const wins = st.closed.filter(t => t.realized > 0).length;
  st.stats = {
    closed: st.closed.length, wins, losses: st.closed.filter(t => t.realized <= 0).length,
    winRate: st.closed.length ? rnd(100 * wins / st.closed.length, 1) : null,
    netPnl: rnd(st.equity - st.startEquity, 2),
    totalR: rnd(st.closed.reduce((s2, t) => s2 + (t.r || 0), 0), 2),
    source: SRC, minConf: MIN_CONF, tf: TF_LIST.map(x => x[0]).join('/')
  };
  saveState(st);
  console.log('tarandı:', scanned, '| açıldı:', opened, '| açık:', st.open.length, '| kapalı:', st.closed.length, '| hata:', errors);
  console.log('özkaynak:', st.equity, '| net PnL:', st.stats.netPnl, '| WR:', st.stats.winRate);
})().catch(e => { console.error('HATA', e.stack); process.exit(1); });
