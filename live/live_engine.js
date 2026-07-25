/*
 * live_engine.js — CANLI (Vultr) işlem motoru. Paper'dan TAMAMEN AYRI: ayrı kasa, ayrı state, ayrı pano.
 * - Sinyal: ../analysis.js (DREYKO×yigit×SolCJ×JB) + paper v2 filtreleri (A/A+ + GERÇEK MMxM + bias + min stop).
 * - Döngü: tarama 5 dk'da bir, YÖNETİM 30 sn'de bir (cron yok — gerçek 7/24; paper'daki gecikme derdi burada yok).
 * - Modlar: DRY_RUN=1 (varsayılan; emir gitmez, sanal kasa) → LIVE: .env'de DRY_RUN=0 + MEXC anahtarları (ccxt).
 * - Emir: MARKET giriş; TP1(1.5R)'de %50 kapat + SL→BE; final TP / SL market kapanış (motor yönetimli, 30sn kontrol).
 * Çalıştır: node live_engine.js   (systemd: crypto-live.service) — pano: http://SUNUCU_IP:8080
 */
try { require('dotenv').config(); } catch (e) {}   // dotenv yoksa ortam değişkenleriyle devam
const https = require('https'), http = require('http'), fs = require('fs'), path = require('path');
const A = require('../analysis');

const DRY = process.env.DRY_RUN !== '0';
const RISK_PCT = +(process.env.RISK_PCT || 0.03);        // küçük kasada min-kontrat engelini aşmak için (büyüdükçe düşür)
const MAX_OPEN = +(process.env.MAX_OPEN || 2);
const MAX_NEW_PER_SCAN = 2;
const MIN_CONF = 75;
const MIN_RISK = { '15m': 0.008, '60m': 0.012, '4h': 0.02, '1d': 0.03 };
const TP1_R = 1.5;
const TF_LIST = [['1d', '60m'], ['4h', '15m'], ['60m', '15m'], ['15m', '5m']];
const MAX_SYMS = +(process.env.MAX_SYMS || 50);
const SCAN_MS = 5 * 60000, MNG_MS = 30000;
const FEE_TAKER = 0.0002, SLIP = 0.0005;                 // DRY simülasyonu için; LIVE'da gerçek dolum fiyatı kullanılır
const STATE_F = path.join(__dirname, 'live_state.json');
const PORT = +(process.env.PANO_PORT || 8080);
const LEV = +(process.env.LEVERAGE || 5);

function get(url) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, x => {
      let b = ''; x.on('data', d => b += d);
      x.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error('json')); } });
    });
    r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (v, d) => { const m = Math.pow(10, d == null ? 6 : d); return Math.round(v * m) / m; };
const log = (...a) => console.log(new Date().toISOString().slice(5, 19), ...a);

// ---- MEXC perp public data ----
const IV = { '1m': 'Min1', '5m': 'Min5', '15m': 'Min15', '60m': 'Min60', '4h': 'Hour4', '1d': 'Day1' };
const SEC = { '1m': 60, '5m': 300, '15m': 900, '60m': 3600, '4h': 14400, '1d': 86400 };
async function topSymbols() {
  const j = await get('https://contract.mexc.com/api/v1/contract/ticker');
  return (j.data || []).filter(x => /_USDT$/.test(x.symbol) && +x.amount24 > 0)
    .sort((a, b) => +b.amount24 - +a.amount24).slice(0, MAX_SYMS).map(x => x.symbol);
}
async function klines(sym, iv, bars) {
  const end = Math.floor(Date.now() / 1000), start = end - bars * SEC[iv];
  const j = await get('https://contract.mexc.com/api/v1/contract/kline/' + sym + '?interval=' + IV[iv] + '&start=' + start + '&end=' + end);
  const d = j.data || {};
  if (!d.time || !d.time.length) throw new Error('kline yok ' + sym);
  return d.time.map((t, i) => ({ t: t * 1000, o: +d.open[i], h: +d.high[i], l: +d.low[i], c: +d.close[i], v: +d.vol[i] }));
}

// ---- borsa (LIVE modda ccxt) ----
let ex = null;
async function exchange() {
  if (ex) return ex;
  const ccxt = require('ccxt');
  ex = new ccxt.mexc({ apiKey: process.env.MEXC_KEY, secret: process.env.MEXC_SECRET, options: { defaultType: 'swap' }, enableRateLimit: true });
  await ex.loadMarkets();
  return ex;
}
const ccxtSym = s => s.replace('_USDT', '/USDT:USDT');
async function liveBalance() {
  const e = await exchange();
  const b = await e.fetchBalance();
  return (b.USDT && (b.USDT.free ?? b.USDT.total)) || 0;
}
async function liveMarket(sym, side, qty, reduceOnly) {
  const e = await exchange();
  try { if (!reduceOnly) await e.setLeverage(LEV, ccxtSym(sym)); } catch (er) {}
  const o = await e.createOrder(ccxtSym(sym), 'market', side, qty, undefined, reduceOnly ? { reduceOnly: true } : {});
  const f = await e.fetchOrder(o.id, ccxtSym(sym)).catch(() => o);
  return { px: f.average || f.price || null, fee: (f.fee && f.fee.cost) || 0, id: o.id };
}

// ---- durum ----
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_F, 'utf8')); }
  catch (e) { return { mode: DRY ? 'DRY' : 'LIVE', equity: DRY ? 1000 : 0, startEquity: DRY ? 1000 : 0, open: [], closed: [], recentSigs: [], equityHistory: [], lastRun: null, runs: 0 }; }
}
const st = loadState();
function save() {
  st.mode = DRY ? 'DRY' : 'LIVE';
  const wins = st.closed.filter(t => t.realized > 0).length;
  st.stats = { closed: st.closed.length, wins, losses: st.closed.length - wins,
    winRate: st.closed.length ? rnd(100 * wins / st.closed.length, 1) : null,
    netPnl: rnd(st.equity - st.startEquity, 2),
    totalR: rnd(st.closed.reduce((a, t) => a + (t.r || 0), 0), 2),
    source: 'perp', minConf: MIN_CONF, tf: TF_LIST.map(x => x[0]).join('/') + ' · ' + (DRY ? 'DRY_RUN' : 'CANLI') };
  fs.writeFileSync(STATE_F, JSON.stringify(st, null, 1));
}

function makeSnap(a) {
  const c = a.candles.slice(-132), off = a.candles.length - c.length, mp = a.structures.manipulation;
  return { candles: c.map(k => [Math.round(k.t / 1000), rnd(k.o), rnd(k.h), rnd(k.l), rnd(k.c)]),
    manip: mp ? { rangeFrom: mp.rangeFrom - off, rangeTo: mp.rangeTo - off, sweepAt: mp.sweepAt - off, at: mp.at - off, rangeHigh: mp.rangeHigh, rangeLow: mp.rangeLow, wick: mp.wick, side: mp.side } : null };
}

// ---- işlem aç/kapa ----
async function openTrade(sym, a, mktPx, tf) {
  const s = a.setup;
  const long = s.side === 'LONG';
  let entry, entryFee, qty;
  const slPlan = s.stop;
  const riskDist0 = Math.abs(mktPx - slPlan);
  const riskUSD = rnd(st.equity * RISK_PCT, 2);
  qty = riskUSD / riskDist0;
  qty = Math.min(qty, st.equity * LEV / mktPx);
  if (!(qty > 0)) return null;
  let cs = 1, noDerisk = false;
  if (DRY) {
    // DRY'da da kontrat kurallarını uygula (anahtar varsa) — canlıda açılamayacak işlem DRY'da da açılmasın
    if (process.env.MEXC_KEY) {
      try {
        const e = await exchange();
        const mk = e.market(ccxtSym(sym));
        cs = mk.contractSize || 1;
        const minA = (mk.limits && mk.limits.amount && mk.limits.amount.min) || 1;
        let contracts = +e.amountToPrecision(ccxtSym(sym), qty / cs);
        if (!(contracts >= minA)) { log('ATLANDI [DRY]', sym, 'min kontrat altı (' + rnd(qty / cs, 4) + ' < ' + minA + ')'); return null; }
        if (contracts < 2 * minA) noDerisk = true;
        if ((contracts * cs * mktPx) / LEV > st.equity * 0.9) { log('ATLANDI [DRY]', sym, 'marj yetersiz'); return null; }
        qty = contracts * cs;
      } catch (er) { /* market bilgisi yoksa ham qty ile devam */ }
    }
    entry = mktPx * (long ? 1 + SLIP : 1 - SLIP);
    entryFee = rnd(entry * qty * FEE_TAKER, 4);
  } else {
    try {
      const e = await exchange();
      const mk = e.market(ccxtSym(sym));
      cs = mk.contractSize || 1;                                     // MEXC swap KONTRAT birimiyle çalışır
      let contracts = +e.amountToPrecision(ccxtSym(sym), qty / cs);
      const minA = (mk.limits && mk.limits.amount && mk.limits.amount.min) || 1;
      if (!(contracts >= minA)) { log('ATLANDI', sym, 'min kontrat altı (küçük kasa)'); return null; }
      if (contracts < 2 * minA) noDerisk = true;                     // yarım kapatma imkansız -> TP1 tam kapanış olur
      const notion = contracts * cs * mktPx;
      if (notion / LEV > st.equity * 0.9) { log('ATLANDI', sym, 'marj yetersiz'); return null; }
      const r = await liveMarket(sym, long ? 'buy' : 'sell', contracts, false);
      qty = contracts * cs;                                          // kayıtlar coin cinsinden
      entry = r.px || mktPx; entryFee = r.fee || rnd(entry * qty * FEE_TAKER, 4);
    } catch (er) { log('EMİR HATASI', sym, er.message.slice(0, 120)); return null; }
  }
  const riskDist = Math.abs(entry - slPlan); if (!(riskDist > 0)) return null;
  let tp1 = long ? entry + TP1_R * riskDist : entry - TP1_R * riskDist;
  const tpF = s.tps[s.tps.length - 1];
  if (long ? tp1 > tpF : tp1 < tpF) tp1 = tpF;
  const tr = { id: sym + '-' + Date.now(), symbol: sym, side: s.side, tf, src: 'perp', cs, noDerisk,
    entry: rnd(entry), sl: rnd(slPlan), tp1: rnd(tp1), tpF: rnd(tpF), qty: rnd(qty, 8), qty0: rnd(qty, 8),
    riskUSD, entryFee, conf: s.confidence, grade: s.grade, model: s.model, mmxm: s.mmxm || null,
    reasons: (s.reasons || []).slice(0, 6), snap: makeSnap(a),
    openedAt: Date.now(), lastCheck: Date.now(), status: 'open', deriskDone: false, realized: 0, feeCharged: false, fills: [] };
  st.open.push(tr);
  return tr;
}
async function closePart(tr, px, part, why, taker) {
  const qty = tr.qty * part;
  let fillPx = px, fee;
  if (DRY) { fee = px * qty * FEE_TAKER; }
  else {
    try {
      const e = await exchange();
      const cs = tr.cs || 1;
      let contracts = +e.amountToPrecision(ccxtSym(tr.symbol), qty / cs);
      if (!(contracts > 0)) contracts = Math.max(1, Math.round(qty / cs));   // son güvenlik: en az 1 kontrat
      const r = await liveMarket(tr.symbol, tr.side === 'LONG' ? 'sell' : 'buy', contracts, true);
      fillPx = r.px || px; fee = r.fee || fillPx * contracts * cs * FEE_TAKER;
    } catch (er) { log('KAPATMA HATASI', tr.symbol, er.message.slice(0, 120)); return false; }
  }
  const gross = (tr.side === 'LONG' ? fillPx - tr.entry : tr.entry - fillPx) * qty;
  const pnl = gross - fee - (tr.feeCharged ? 0 : tr.entryFee);
  tr.feeCharged = true;
  st.equity = rnd(st.equity + pnl, 2);
  tr.fills.push({ t: Date.now(), px: rnd(fillPx), part: rnd(part, 3), why, pnl: rnd(pnl, 2) });
  tr.realized = rnd((tr.realized || 0) + pnl, 2);
  tr.qty = rnd(tr.qty - qty, 8);
  return true;
}
async function finishTrade(tr, why) {
  tr.status = 'closed'; tr.closedAt = Date.now(); tr.closeReason = why;
  tr.r = rnd(tr.realized / tr.riskUSD, 2);
  try { const cc = await klines(tr.symbol, tr.tf, 140);
    tr.snapClose = { candles: cc.slice(-132).map(k => [Math.round(k.t / 1000), rnd(k.o), rnd(k.h), rnd(k.l), rnd(k.c)]) }; } catch (e) {}
  st.closed.unshift(tr); if (st.closed.length > 300) st.closed.length = 300;
  st.closed.forEach((t, i) => { if (i >= 40) { delete t.snap; delete t.snapClose; } });
  st.open = st.open.filter(x => x !== tr);
  log('KAPANDI', tr.symbol, why, 'R' + tr.r, '$' + tr.realized);
}

// ---- yönetim (30 sn) ----
let managing = false;
async function manage() {
  if (managing) return; managing = true;
  try {
    for (const tr of [...st.open]) {
      let c1;
      try { c1 = await klines(tr.symbol, '1m', Math.min(600, Math.max(10, Math.ceil((Date.now() - tr.lastCheck) / 60000) + 5))); }
      catch (e) { continue; }
      const news = c1.filter(k => k.t > tr.lastCheck);
      for (const k of news) {
        const long = tr.side === 'LONG';
        if (long ? k.l <= tr.sl : k.h >= tr.sl) {
          const px = tr.sl * (long ? 1 - SLIP : 1 + SLIP);
          if (await closePart(tr, DRY ? px : tr.sl, 1, tr.deriskDone ? 'BE/SL' : 'SL', true)) await finishTrade(tr, tr.deriskDone ? 'BE' : 'SL');
          break;
        }
        if (!tr.deriskDone && tr.tp1 !== tr.tpF && (long ? k.h >= tr.tp1 : k.l <= tr.tp1)) {
          if (tr.noDerisk) {                                        // pozisyon 1 kontrat: yarım kapatılamaz -> TP1'de tam kapanış
            if (await closePart(tr, tr.tp1, 1, 'TP1-tam', false)) { await finishTrade(tr, 'TP'); break; }
          } else if (await closePart(tr, tr.tp1, 0.5, 'TP1-derisk', false)) { tr.deriskDone = true; tr.sl = tr.entry; log('DERISK', tr.symbol, 'SL→BE'); }
        }
        if (long ? k.h >= tr.tpF : k.l <= tr.tpF) {
          if (await closePart(tr, tr.tpF, 1, 'TP-final', false)) await finishTrade(tr, 'TP');
          break;
        }
      }
      if (tr.status !== 'closed' && news.length) tr.lastCheck = news[news.length - 1].t - 1;
      await sleep(150);
    }
    save();
  } catch (e) { log('manage hata', e.message); }
  managing = false;
}

// ---- tarama (5 dk) ----
let scanning = false;
async function scan() {
  if (scanning) return; scanning = true;
  try {
    st.runs = (st.runs || 0) + 1;
    if (!DRY) { try { st.equity = rnd(await liveBalance(), 2); if (!st.startEquity) st.startEquity = st.equity; } catch (e) { log('bakiye okunamadı', e.message.slice(0, 80)); } }
    else if (!st.realBalSeen && process.env.MEXC_KEY) {              // DRY: gerçek kasayı başlangıç yap (boyutlama gerçekçi olsun)
      try { const b = await liveBalance(); if (b > 0) { st.equity = st.startEquity = rnd(b, 2); log('DRY kasa gerçek bakiyeye ayarlandı:', st.equity); } st.realBalSeen = true; } catch (e) { st.realBalSeen = true; }
    }
    const syms = await topSymbols();
    let opened = 0;
    for (const sym of syms) {
      if (opened >= MAX_NEW_PER_SCAN || st.open.length >= MAX_OPEN) break;
      if (st.open.find(t => t.symbol === sym)) continue;
      for (const [tf, ltfIv] of TF_LIST) {
        try {
          const cc = await klines(sym, tf, 500);
          if (cc.length < 80) { await sleep(60); continue; }
          let a = A.analyze(cc, { interval: tf, symbol: sym.replace('_', '') });
          const s0 = a.setup;
          if (s0 && s0.confidence >= MIN_CONF && s0.grade !== 'B') {
            const cl = await klines(sym, ltfIv, 500).catch(() => null);
            if (cl) a = A.analyze(cc, { interval: tf, symbol: sym.replace('_', ''), ltf: { interval: ltfIv, candles: cl } });
            const s = a.setup, mp = a.structures.manipulation;
            const long = s && s.side === 'LONG';
            const mkt = cc[cc.length - 1].c;
            if (s && mp && s.confidence >= MIN_CONF && s.grade !== 'B' && s.mmxm && s.mmxm.valid
              && !(a.htfBias && a.htfBias !== 'Neutral' && ((a.htfBias === 'Bullish') !== long))
              && (long ? s.stop < mkt : s.stop > mkt)
              && Math.abs(mkt - s.stop) / mkt >= (MIN_RISK[tf] || 0.01)
              && (long ? mkt < s.tps[s.tps.length - 1] : mkt > s.tps[s.tps.length - 1])
              && Math.abs(s.tps[s.tps.length - 1] - mkt) / Math.abs(mkt - s.stop) >= 1) {
              const sig = sym + '|' + tf + '|' + s.side + '|' + (a.candles[mp.sweepAt] ? a.candles[mp.sweepAt].t : mp.sweepAt);
              if (!st.recentSigs.includes(sig)) {
                const tr = await openTrade(sym, a, mkt, tf);
                if (tr) { opened++; st.recentSigs.push(sig); if (st.recentSigs.length > 300) st.recentSigs.splice(0, 100);
                  log('AÇILDI', (DRY ? '[DRY] ' : '[CANLI] ') + sym, tf, tr.side, 'giriş', tr.entry, 'SL', tr.sl, 'TP', tr.tp1 + '/' + tr.tpF, '%' + tr.conf, tr.grade); break; }
              }
            }
          }
        } catch (e) {}
        await sleep(60);
      }
      await sleep(50);
    }
    st.lastRun = Date.now();
    st.equityHistory.push({ t: st.lastRun, eq: st.equity, open: st.open.length });
    if (st.equityHistory.length > 3000) st.equityHistory.splice(0, 500);
    save();
    log('tarama bitti | açık:', st.open.length, '| kapalı:', st.closed.length, '| kasa:', st.equity, DRY ? '(DRY)' : '(CANLI)');
  } catch (e) { log('scan hata', e.message); }
  scanning = false;
}

// ---- pano (paper panosunu aynen kullanır; state alias'lı) ----
http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    try {
      let h = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
      h = h.replace(/Paper Trading/g, 'CANLI — Vultr' + (DRY ? ' (DRY_RUN)' : '')).replace('📄', DRY ? '🧪' : '🔴');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(h);
    } catch (e) { res.writeHead(500); return res.end('pano yok'); }
  }
  if (u === '/paper_state.json' || u === '/live_state.json') {
    try { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(STATE_F)); }
    catch (e) { res.writeHead(404); return res.end('{}'); }
  }
  res.writeHead(404); res.end('yok');
}).listen(PORT, () => log('pano: http://0.0.0.0:' + PORT + '  mod:', DRY ? 'DRY_RUN' : '🔴 CANLI'));

log('motor başladı | mod:', DRY ? 'DRY_RUN (emir gitmez)' : '🔴 CANLI', '| risk %' + (RISK_PCT * 100), '| maksAçık', MAX_OPEN);
scan(); manage();
setInterval(scan, SCAN_MS);
setInterval(manage, MNG_MS);
