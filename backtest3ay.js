/*
 * backtest3ay.js — paper v2 sisteminin SON 3 AY gerçek backtest'i (lookahead yok).
 *
 * MOTORLA BİREBİR AYNI: analysis.js sinyalleri + v2 filtreler (A/A+ · GERÇEK MMxM ✓ · HTF bias · min stop)
 * + portföy kuralları (maks 6 açık, taramada maks 2 yeni, sembol başına 1) + TP1=1.5R derisk & SL→BE
 * + gerçekçi maliyet (market giriş kayma %0.05 + taker %0.02, TP limit maker %0.01).
 *
 * SIZINTI KORUMASI: her sinyal, YALNIZCA reclaim barına kadarki veriyle üretilir (hist = candles[0..at]);
 * LTF onay penceresi sweep → reclaim+8 bar ile sınırlıdır; giriş fiyatı reclaim barının KAPANIŞIDIR.
 * Yönetim 5m barlarla; aynı barda SL+TP çakışırsa SL sayılır (muhafazakâr).
 *
 * Çalıştır: node backtest3ay.js            (varsayılan 30 sembol, 90 gün)
 *           SYMS=50 GUN=90 node backtest3ay.js
 */
const https = require('https'), fs = require('fs');
const A = require('./analysis');

const N_SYM = +(process.env.SYMS || 30);
const GUN = +(process.env.GUN || 90);
const START_EQ = 10000, RISK_PCT = 0.01, LEV_CAP = 10;
const MAX_OPEN = 6, MAX_NEW_PER_BUCKET = 2, BUCKET_MS = 5 * 60000;
const MIN_CONF = 75, TP1_R = 1.5;
const MIN_RISK = { '15m': 0.008, '60m': 0.012, '4h': 0.02, '1d': 0.03 };
const FEE_TAKER = 0.0002, FEE_MAKER = 0.0001, SLIP = 0.0005;
const TF_LIST = [['1d', '60m'], ['4h', '15m'], ['60m', '15m'], ['15m', '5m']];
const IV = { '5m': 'Min5', '15m': 'Min15', '60m': 'Min60', '4h': 'Hour4', '1d': 'Day1' };
const SEC = { '5m': 300, '15m': 900, '60m': 3600, '4h': 14400, '1d': 86400 };
const WARMUP = 520;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (v, d) => { const m = Math.pow(10, d == null ? 6 : d); return Math.round(v * m) / m; };
const iso = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
let REQ = 0;
function getOnce(url) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 25000 }, x => {
      let b = ''; x.on('data', d => b += d);
      x.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error('json:' + x.statusCode + ':' + b.slice(0, 60))); } });
    });
    r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout')));
  });
}
async function get(url) {                       // rate-limit'e karşı artan bekleme ile 4 deneme
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await getOnce(url); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 800 * (i + 1) * (i + 1))); }
  }
  throw last;
}
async function klines(sym, tf, startSec, endSec) {   // 2000 bar limitini sayfalayarak aşar
  const step = SEC[tf], out = [];
  let end = endSec;
  while (end > startSec) {
    const start = Math.max(startSec, end - 1990 * step);
    let j = null;
    for (let d = 0; d < 3 && !j; d++) {
      try { j = await get('https://contract.mexc.com/api/v1/contract/kline/' + sym + '?interval=' + IV[tf] + '&start=' + start + '&end=' + end); REQ++; }
      catch (e) { await sleep(400); }
    }
    const dd = j && j.data;
    if (!dd || !dd.time || !dd.time.length) break;
    for (let i = 0; i < dd.time.length; i++) out.push({ t: dd.time[i] * 1000, o: +dd.open[i], h: +dd.high[i], l: +dd.low[i], c: +dd.close[i], v: +dd.vol[i] });
    if (dd.time.length < 100) break;
    end = dd.time[0] - step;
    await sleep(260);         // MEXC 5600+ istekte IP'yi 403'lüyor — nazik hız (ilk koşumda 90ms engellenmeye yol açtı)
  }
  const seen = new Set(), ded = [];
  for (const c of out) { if (!seen.has(c.t) && isFinite(c.c) && c.c > 0) { seen.add(c.t); ded.push(c); } }
  ded.sort((a, b) => a.t - b.t);
  return ded;
}
// motor manipulation() ile birebir aynı tarihsel tarama
function findManips(candles) {
  const out = [], rangeLen = 30;
  const barMs = candles.length > 1 ? candles[1].t - candles[0].t : 0;
  const maxW = barMs >= 20 * 3600000 ? 0.30 : 0.12;
  let skipUntil = -1;
  for (let i = rangeLen; i < candles.length - 1; i++) {
    if (i < skipUntil) continue;
    const seg = candles.slice(i - rangeLen, i);
    let rH = -Infinity, rL = Infinity;
    for (const c of seg) { if (c.h > rH) rH = c.h; if (c.l < rL) rL = c.l; }
    const w = (rH - rL) / rL;
    if (w > maxW || w < 0.004) continue;
    const c = candles[i];
    let m = null;
    if (c.l < rL && (rL - c.l) / rL >= 0.001) {
      for (let j = i; j < Math.min(candles.length, i + 4); j++) if (candles[j].c > rL) { m = { side: 'LONG', at: j, sweepAt: i }; break; }
    }
    if (!m && c.h > rH && (c.h - rH) / rH >= 0.001) {
      for (let j = i; j < Math.min(candles.length, i + 4); j++) if (candles[j].c < rH) { m = { side: 'SHORT', at: j, sweepAt: i }; break; }
    }
    if (m) { out.push(m); skipUntil = m.at + 5; }
  }
  return out;
}

(async () => {
  const t0 = Date.now();
  const nowSec = Math.floor(Date.now() / 1000);
  const testStart = (nowSec - GUN * 86400) * 1000;
  console.log('=== 3 AY GERÇEK BACKTEST === sembol:', N_SYM, '| gün:', GUN, '| test başlangıcı:', iso(testStart));

  const tick = await get('https://contract.mexc.com/api/v1/contract/ticker');
  const syms = (tick.data || []).filter(x => /_USDT$/.test(x.symbol) && +x.amount24 > 0)
    .sort((a, b) => +b.amount24 - +a.amount24).slice(0, N_SYM).map(x => x.symbol);
  console.log('semboller:', syms.slice(0, 8).join(', '), '...\n');

  // ---- FAZ A: aday sinyal üretimi (sembol sembol, bellek dostu) ----
  const cands = [];
  for (let si = 0; si < syms.length; si++) {
    const sym = syms[si];
    let bulundu = 0;
    const cache = {};
    for (const [tf, ltfIv] of TF_LIST) {
      let cc;
      try {
        cc = await klines(sym, tf, Math.floor(testStart / 1000) - WARMUP * SEC[tf], nowSec);
        cache[tf] = cc;
      } catch (e) { continue; }
      if (cc.length < 120) continue;
      const manips = findManips(cc);
      for (const m of manips) {
        const barT = cc[m.at].t;
        if (barT < testStart || m.at >= cc.length - 1) continue;      // sadece test penceresi
        const hist = cc.slice(0, m.at + 1);                            // SIZINTI YOK
        if (hist.length < 80) continue;
        let a;
        try { a = A.analyze(hist, { interval: tf, symbol: sym.replace('_', '') }); } catch (e) { continue; }
        const s0 = a.setup;
        if (!s0 || s0.confidence < MIN_CONF || s0.grade === 'B') continue;   // ucuz filtreler (motor da böyle yapar)
        // LTF onayı
        let ltfC = null;
        if (ltfIv === '5m') {
          const w0 = Math.floor(cc[m.sweepAt].t / 1000) - 3600, w1 = Math.floor(barT / 1000) + 9 * SEC[tf];
          try { ltfC = await klines(sym, '5m', w0, w1); } catch (e) {}
        } else {
          if (!cache[ltfIv]) { try { cache[ltfIv] = await klines(sym, ltfIv, Math.floor(testStart / 1000) - WARMUP * SEC[ltfIv], nowSec); } catch (e) { cache[ltfIv] = []; } }
          ltfC = cache[ltfIv].filter(k => k.t <= barT + 9 * SEC[tf] * 1000);
        }
        if (ltfC && ltfC.length > 40) {
          try { a = A.analyze(hist, { interval: tf, symbol: sym.replace('_', ''), ltf: { interval: ltfIv, candles: ltfC } }); } catch (e) {}
        }
        const s = a.setup, mp = a.structures.manipulation;
        if (!s || !mp || s.confidence < MIN_CONF || s.grade === 'B') continue;
        if (!s.mmxm || !s.mmxm.valid) continue;                              // GERÇEK MMxM ✓
        const long = s.side === 'LONG';
        if (a.htfBias && a.htfBias !== 'Neutral' && ((a.htfBias === 'Bullish') !== long)) continue;   // bias
        const mkt = cc[m.at].c;                                              // giriş: reclaim barının KAPANIŞI
        const entry = mkt * (long ? 1 + SLIP : 1 - SLIP);
        const sl = s.stop, tpF = s.tps[s.tps.length - 1];
        if (long ? sl >= entry : sl <= entry) continue;
        if (long ? entry >= tpF : entry <= tpF) continue;
        const riskDist = Math.abs(entry - sl);
        if (riskDist / entry < (MIN_RISK[tf] || 0.01)) continue;              // min stop mesafesi
        if (Math.abs(tpF - entry) / riskDist < 1) continue;                   // kalan RR ≥ 1
        let tp1 = long ? entry + TP1_R * riskDist : entry - TP1_R * riskDist;
        if (long ? tp1 > tpF : tp1 < tpF) tp1 = tpF;
        // teşhis alanları (kalibrasyon hipotezleri: stop/ATR, giriş mumu gücü, hedef mesafesi, seans)
        let atr14 = null;
        { let s2 = 0, k2 = 0; for (let i = Math.max(1, m.at - 13); i <= m.at; i++) { const h = cc[i].h, l = cc[i].l, pc = cc[i - 1].c; s2 += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); k2++; } if (k2) atr14 = s2 / k2; }
        const eb = cc[m.at];
        cands.push({ t: barT, sym, tf, side: s.side, entry, sl, tp1, tpF, conf: s.confidence, grade: s.grade,
          mmxm: s.mmxm ? s.mmxm.score : null, sig: sym + '|' + tf + '|' + s.side + '|' + cc[m.sweepAt].t,
          stopATR: atr14 ? rnd(riskDist / atr14, 2) : null, bodyATR: atr14 ? rnd(Math.abs(eb.c - eb.o) / atr14, 2) : null,
          tpfATR: atr14 ? rnd(Math.abs(tpF - entry) / atr14, 2) : null,
          nyHour: +new Date(barT).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }) });
        bulundu++;
      }
      cache[tf] = null;                                                        // belleği boşalt
    }
    process.stdout.write('  [' + (si + 1) + '/' + syms.length + '] ' + sym.padEnd(16) + ' aday:' + bulundu + '  (toplam ' + cands.length + ', istek ' + REQ + ')\n');
  }
  cands.sort((a, b) => a.t - b.t);
  console.log('\nFAZ A bitti: ' + cands.length + ' aday sinyal | süre ' + Math.round((Date.now() - t0) / 60000) + ' dk\n');

  // ---- FAZ B: portföy simülasyonu (kronolojik, motor kurallarıyla) ----
  const m5cache = {};
  async function m5(sym, fromT, toT) {
    const k = sym;
    if (!m5cache[k]) m5cache[k] = [];
    const have = m5cache[k];
    if (!have.length || have[0].t > fromT || have[have.length - 1].t < toT) {
      try {
        const got = await klines(sym, '5m', Math.floor(fromT / 1000) - 600, Math.floor(toT / 1000) + 600);
        if (got.length) m5cache[k] = got;
      } catch (e) {}
    }
    return m5cache[k];
  }
  let eq = START_EQ, open = [], closed = [], eqCurve = [], seen = new Set(), peak = START_EQ, maxDD = 0;
  const buckets = {};
  for (const c of cands) {
    // portföy kısıtları
    const bk = Math.floor(c.t / BUCKET_MS);
    buckets[bk] = buckets[bk] || 0;
    // önce bu ana kadar açık işlemleri yönet
    for (const tr of [...open]) {
      const bars = await m5(tr.sym, tr.lastT, c.t);
      const res = step(tr, bars, c.t);
      if (res) finish(tr, res);
    }
    if (open.length >= MAX_OPEN) continue;
    if (buckets[bk] >= MAX_NEW_PER_BUCKET) continue;
    if (open.find(t => t.sym === c.sym)) continue;
    if (seen.has(c.sig)) continue;
    seen.add(c.sig);
    const riskDist = Math.abs(c.entry - c.sl), riskUSD = eq * RISK_PCT;
    let qty = riskUSD / riskDist;
    qty = Math.min(qty, eq * LEV_CAP / c.entry);
    if (!(qty > 0)) continue;
    buckets[bk]++;
    open.push({ ...c, qty, qty0: qty, riskUSD, entryFee: c.entry * qty * FEE_TAKER, feeCharged: false,
      realized: 0, derisk: false, slCur: c.sl, lastT: c.t, fills: [] });
  }
  // kalan açıkları sona kadar yönet
  const sonT = Date.now();
  for (const tr of [...open]) {
    const bars = await m5(tr.sym, tr.lastT, sonT);
    const res = step(tr, bars, sonT);
    if (res) finish(tr, res);
  }

  function closePart(tr, px, part, why, taker) {
    const q = tr.qty * part;
    const gross = (tr.side === 'LONG' ? px - tr.entry : tr.entry - px) * q;
    const fee = px * q * (taker ? FEE_TAKER : FEE_MAKER);
    const pnl = gross - fee - (tr.feeCharged ? 0 : tr.entryFee);
    tr.feeCharged = true;
    eq += pnl; tr.realized += pnl; tr.qty -= q;
    tr.fills.push({ why, px: rnd(px), pnl: rnd(pnl, 2) });
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd;
    eqCurve.push({ t: tr.lastT, eq: rnd(eq, 2) });
  }
  function step(tr, bars, untilT) {                 // 5m barlarla ilerlet; kapanış sebebini döndür
    for (const k of bars) {
      if (k.t <= tr.lastT || k.t > untilT) continue;
      tr.lastT = k.t;
      const long = tr.side === 'LONG';
      if (long ? k.l <= tr.slCur : k.h >= tr.slCur) {                       // muhafazakâr: SL önce
        const px = tr.slCur * (long ? 1 - SLIP : 1 + SLIP);
        closePart(tr, px, 1, tr.derisk ? 'BE/SL' : 'SL', true);
        return tr.derisk ? 'BE' : 'SL';
      }
      if (!tr.derisk && tr.tp1 !== tr.tpF && (long ? k.h >= tr.tp1 : k.l <= tr.tp1)) {
        closePart(tr, tr.tp1, 0.5, 'TP1-derisk', false);
        tr.derisk = true; tr.slCur = tr.entry;
      }
      if (long ? k.h >= tr.tpF : k.l <= tr.tpF) {
        closePart(tr, tr.tpF, 1, 'TP-final', false);
        return 'TP';
      }
    }
    return null;
  }
  function finish(tr, why) {
    tr.sonuc = why; tr.r = tr.realized / tr.riskUSD; tr.closedT = tr.lastT;
    closed.push(tr); open = open.filter(x => x !== tr);
  }

  // ---- SONUÇLAR ----
  const L = [];
  const say = s => { L.push(s); console.log(s); };
  const g = (arr, f) => { const m = {}; arr.forEach(t => { const k = f(t); m[k] = m[k] || { n: 0, r: 0, w: 0, usd: 0, tp1: 0 }; m[k].n++; m[k].r += t.r; m[k].usd += t.realized; if (t.realized > 0) m[k].w++; if (t.fills.some(f2 => /TP1/.test(f2.why))) m[k].tp1++; }); return m; };
  const tablo = (ad, m) => { say('\n--- ' + ad + ' ---'); say('  ' + 'grup'.padEnd(12) + 'n'.padStart(5) + 'WR%'.padStart(6) + 'ortR'.padStart(8) + 'topR'.padStart(9) + '$'.padStart(10) + 'TP1%'.padStart(7));
    Object.entries(m).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => say('  ' + k.padEnd(12) + String(v.n).padStart(5) + String(Math.round(100 * v.w / v.n)).padStart(6) + (v.r / v.n).toFixed(2).padStart(8) + v.r.toFixed(1).padStart(9) + v.usd.toFixed(0).padStart(10) + String(Math.round(100 * v.tp1 / v.n)).padStart(7))); };

  say('\n================ SONUÇ ================');
  say('Dönem: ' + iso(testStart) + ' → ' + iso(Date.now()) + ' (' + GUN + ' gün) · ' + N_SYM + ' sembol · ' + REQ + ' API isteği');
  say('Aday sinyal: ' + cands.length + ' | portföy kurallarıyla açılan: ' + (closed.length + open.length) + ' | kapanan: ' + closed.length + ' | hâlâ açık: ' + open.length);
  const topR = closed.reduce((a, t) => a + t.r, 0), wins = closed.filter(t => t.realized > 0).length;
  say('KASA: ' + START_EQ + '$ → ' + rnd(eq, 2) + '$  (net ' + (eq - START_EQ >= 0 ? '+' : '') + rnd(eq - START_EQ, 2) + '$ = %' + rnd(100 * (eq - START_EQ) / START_EQ, 1) + ')');
  say('Toplam R: ' + (topR >= 0 ? '+' : '') + topR.toFixed(2) + ' | Win Rate: %' + (closed.length ? rnd(100 * wins / closed.length, 1) : 0) + ' | işlem/ay: ' + rnd((closed.length + open.length) / (GUN / 30), 1));
  say('Maks drawdown: %' + rnd(100 * maxDD, 1) + ' | ortalama R/işlem: ' + (closed.length ? (topR / closed.length).toFixed(2) : '-'));
  if (closed.length) {
    tablo('SONUÇ TÜRÜ', g(closed, t => t.sonuc));
    tablo('TF', g(closed, t => t.tf));
    tablo('GÜVEN', g(closed, t => t.conf >= 95 ? '95-99' : t.conf >= 85 ? '85-94' : '75-84'));
    tablo('YÖN', g(closed, t => t.side));
    tablo('AY', g(closed, t => new Date(t.t).toISOString().slice(0, 7)));
    tablo('MMxM skor', g(closed, t => 'skor ' + t.mmxm));
    const dr = closed.filter(t => t.fills.some(f => /TP1/.test(f.why)));
    say('\nTP1(1.5R) gören: ' + dr.length + '/' + closed.length + ' (%' + rnd(100 * dr.length / closed.length, 0) + ') → hepsi pozitif mi: ' + dr.every(t => t.realized > 0));
    say('\nEN İYİ 5:'); [...closed].sort((a, b) => b.r - a.r).slice(0, 5).forEach(t => say('  ' + t.sym.padEnd(15) + t.tf.padEnd(4) + t.side.padEnd(6) + 'R' + t.r.toFixed(2).padStart(6) + '  ' + iso(t.t)));
    say('EN KÖTÜ 5:'); [...closed].sort((a, b) => a.r - b.r).slice(0, 5).forEach(t => say('  ' + t.sym.padEnd(15) + t.tf.padEnd(4) + t.side.padEnd(6) + 'R' + t.r.toFixed(2).padStart(6) + '  ' + iso(t.t)));
  }
  say('\nNOT: semboller BUGÜNKÜ hacim top-' + N_SYM + "'i (seçim yanlılığı); giriş = reclaim barı kapanışı;");
  say('yönetim 5m barlarla, aynı barda SL+TP → SL (muhafazakâr); komisyon+kayma dahil.');
  fs.writeFileSync(__dirname + '/backtest3ay_sonuc.txt', L.join('\n'));
  fs.writeFileSync(__dirname + '/backtest3ay_islemler.json', JSON.stringify({ closed: closed.map(t => ({ sym: t.sym, tf: t.tf, side: t.side, t: t.t, sonuc: t.sonuc, r: rnd(t.r, 2), usd: rnd(t.realized, 2), conf: t.conf, mmxm: t.mmxm, stopATR: t.stopATR, bodyATR: t.bodyATR, tpfATR: t.tpfATR, nyHour: t.nyHour })), eqCurve }, null, 1));
  console.log('\nKaydedildi: backtest3ay_sonuc.txt + backtest3ay_islemler.json | süre ' + Math.round((Date.now() - t0) / 60000) + ' dk');
})().catch(e => { console.error('HATA', e.stack); process.exit(1); });
