/*
 * GERÇEK MMxM filtresi backtesti — "GERÇEK ✓ (LTF onaylı + skor>=4)" vs diğerleri.
 * Yöntem (bakış açısı sızıntısız):
 *  - Tarihsel manipulation taraması: bot manipulation() ile aynı kurallar (prior-30 konsolidasyon,
 *    sweep >= %0.1, reclaim <= 3 mum) tüm geçmişte.
 *  - MMxM skoru RECLAIM ANINA KADARKİ veriyle hesaplanır (hist = candles[0..at]); LTF onay penceresi
 *    sweep -> reclaim+1 bar (canlıdan daha katı, ileriye bakmaz).
 *  - İşlem: giriş = geri alınan seviye (limit, reclaim sonrası 20 bar içinde dolum), stop = wick ±%0.3,
 *    TP1 = karşı range kenarı. Fitil bazlı; aynı barda SL+TP -> SL sayılır (muhafazakar).
 * Kullanım:
 *   node mmxm_backtest.js              -> varsayılan: 60m + 15m
 *   node mmxm_backtest.js 4h           -> sadece 4 saatlik
 *   node mmxm_backtest.js 4h 1d        -> 4 saatlik + günlük
 *   node mmxm_backtest.js all          -> 15m + 60m + 4h + 1d (uzun sürer)
 * Not: LTF kapsaması dışında kalan (çok eski) setuplar otomatik atlanır — 4h/1d'de test penceresi LTF sayfa sayısıyla sınırlıdır.
 */
const https = require('https');
const A = require('./analysis');

const SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT', 'LTCUSDT', 'TRXUSDT', 'DOTUSDT', 'NEARUSDT', 'UNIUSDT'];
// TF tanımları: LTF eşlemesi bot ile aynı; ltfPages = LTF kapsama penceresi (1000 mumluk sayfa başına)
const TF_DEF = {
  '15m': { ltf: '5m', ltfPages: 4 },    // ~10 gün pencere, tam kapsama
  '60m': { ltf: '15m', ltfPages: 5 },   // ~41 gün, tam kapsama
  '4h': { ltf: '15m', ltfPages: 10 },   // işlem TF ~166 gün; LTF kapsaması son ~104 gün
  '1d': { ltf: '60m', ltfPages: 15 },   // işlem TF ~2.7 yıl; LTF kapsaması son ~625 gün
};
const args = process.argv.slice(2).map(a => a.toLowerCase()).filter(a => a === 'all' || TF_DEF[a]);
const chosen = args.includes('all') ? Object.keys(TF_DEF) : (args.length ? args : ['60m', '15m']);
const SETS = chosen.map(iv => ({ iv, ...TF_DEF[iv] }));

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      let b = ''; r.on('data', d => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function klines(sym, iv, limit, endTime) {
  const u = 'https://api.mexc.com/api/v3/klines?symbol=' + sym + '&interval=' + iv + '&limit=' + limit + (endTime ? ('&endTime=' + endTime) : '');
  const raw = await get(u);
  if (!Array.isArray(raw)) throw new Error('kline yok: ' + sym + ' ' + iv);
  return raw.map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })).filter(x => isFinite(x.c) && x.c > 0);
}
async function klinesPaged(sym, iv, pages) {
  let out = [], endTime = null;
  for (let p = 0; p < pages; p++) {
    const part = await klines(sym, iv, 1000, endTime);
    if (!part.length) break;
    out = part.concat(out);
    endTime = part[0].t - 1;
    await sleep(120);
  }
  const seen = new Set(); const ded = [];
  for (const c of out) { if (!seen.has(c.t)) { seen.add(c.t); ded.push(c); } }
  ded.sort((a, b) => a.t - b.t);
  return ded;
}

// tarihsel manipulation taraması (bot manipulation() kurallarının aynısı, tüm geçmişte)
function findManips(candles) {
  const out = []; const rangeLen = 30; let skipUntil = -1;
  const barMs = candles.length > 1 ? candles[1].t - candles[0].t : 0;
  const maxW = barMs >= 20 * 3600000 ? 0.30 : 0.12;   // bot manipulation() ile aynı: günlükte %30 tavan
  for (let i = rangeLen; i < candles.length - 2; i++) {
    if (i < skipUntil) continue;
    const seg = candles.slice(i - rangeLen, i);
    let rH = -Infinity, rL = Infinity;
    for (const c of seg) { if (c.h > rH) rH = c.h; if (c.l < rL) rL = c.l; }
    const width = (rH - rL) / rL;
    if (width > maxW || width < 0.004) continue;
    const c = candles[i];
    let m = null;
    if (c.l < rL && (rL - c.l) / rL >= 0.001) {
      let at = -1; for (let j = i; j < Math.min(candles.length, i + 4); j++) if (candles[j].c > rL) { at = j; break; }
      if (at >= 0) m = { side: 'LONG', at, sweepAt: i, rangeFrom: i - rangeLen, rangeTo: i - 1, wick: c.l, level: rL, rangeHigh: rH, rangeLow: rL };
    }
    if (!m && c.h > rH && (c.h - rH) / rH >= 0.001) {
      let at = -1; for (let j = i; j < Math.min(candles.length, i + 4); j++) if (candles[j].c < rH) { at = j; break; }
      if (at >= 0) m = { side: 'SHORT', at, sweepAt: i, rangeFrom: i - rangeLen, rangeTo: i - 1, wick: c.h, level: rH, rangeHigh: rH, rangeLow: rL };
    }
    if (m) { out.push(m); skipUntil = m.at + 5; }
  }
  return out;
}

function biasAt(hist, interval) {
  const htfMs = A.HTF_MAP[interval] || 4 * 3600000;
  const htfC = A.resample(hist, htfMs);
  const tr = A.marketStructure(htfC, A.swings(htfC, 2)).trend;
  return tr === 'up' ? 'Bullish' : tr === 'down' ? 'Bearish' : 'Neutral';
}

function simulate(candles, m, interval, ltfAll, ltfIv) {
  const long = m.side === 'LONG';
  const hist = candles.slice(0, m.at + 1);                    // reclaim anına kadar — sızıntı yok
  const entry = m.level;
  const stop = long ? m.wick * 0.997 : m.wick * 1.003;
  const risk = Math.abs(entry - stop); if (risk <= 0) return null;
  const ipda = [];
  [20, 40, 60].forEach(nn => { const s2 = hist.slice(-nn); if (s2.length >= 15) ipda.push(long ? Math.max(...s2.map(k => k.h)) : Math.min(...s2.map(k => k.l))); });
  const oppo = long ? m.rangeHigh : m.rangeLow;
  let tps = [oppo].concat(ipda.length ? [long ? Math.max(...ipda) : Math.min(...ipda)] : []);
  tps = tps.filter((t, i, a) => (long ? t > entry : t < entry) && a.indexOf(t) === i);
  if (!tps.length) return null;
  tps = long ? tps.sort((a, b) => a - b) : tps.sort((a, b) => b - a);
  const tp1 = tps[0];
  // MMxM skoru — reclaim anına kadarki veri + LTF
  const bias = biasAt(hist, interval);
  const barMs = candles[1].t - candles[0].t;
  const ltf = ltfAll && ltfAll.length ? { interval: ltfIv, candles: ltfAll.filter(k => k.t >= candles[m.sweepAt].t - barMs && k.t <= candles[m.at].t + 9 * barMs) } : null;
  const mx = A.mmxmFilter(hist, { manip: m, bias, interval, ltf, tps });
  if (!mx) return null;
  // giriş dolumu: reclaim sonrası 20 bar
  let ei = -1;
  for (let i = m.at + 1; i < Math.min(candles.length, m.at + 21); i++) { const k = candles[i]; if (long ? k.l <= entry : k.h >= entry) { ei = i; break; } }
  if (ei < 0) return { mx, filled: false };
  const rr1 = Math.abs(tp1 - entry) / risk;
  const tp2r = long ? entry + 2 * risk : entry - 2 * risk;   // varyant B: sabit 2R hedef
  const run = (tp, rWin) => {
    for (let i = ei; i < candles.length; i++) {
      const k = candles[i];
      if (long ? k.l <= stop : k.h >= stop) return { win: false, r: -1 };
      if (long ? k.h >= tp : k.l <= tp) return { win: true, r: rWin };
    }
    return null; // açık
  };
  const A1 = run(tp1, rr1), B2 = run(tp2r, 2);
  return { mx, filled: true, open: !A1, res1: A1, res2: B2 };
}

(async () => {
  const mk = () => ({ n: 0, f: 0, w1: 0, l1: 0, r1: 0, o1: 0, w2: 0, l2: 0, r2: 0, o2: 0 });
  const G = { ltfHi: mk(), ltfLo: mk(), noLtfHi: mk(), noLtfLo: mk(), ltfOk: mk(), ltfNo: mk() };
  const perSet = {};   // zaman dilimi bazında LTF etkisi
  let totalManips = 0;
  for (const set of SETS) {
    for (const sym of SYMS) {
      try {
        const tf = await klinesPaged(sym, set.iv, 1);
        await sleep(120);
        const lt = await klinesPaged(sym, set.ltf, set.ltfPages);
        const manips = findManips(tf);
        for (const m of manips) {
          if (m.at >= tf.length - 3) continue;
          if (!lt.length || tf[m.sweepAt].t < lt[0].t) continue;   // LTF kapsaması yoksa atla (dürüst kıyas)
          const sim = simulate(tf, m, set.iv, lt, set.ltf);
          if (!sim) continue;
          totalManips++;
          const ltfOk = sim.mx.checks[4].ok, htfScore = sim.mx.score - (ltfOk ? 1 : 0);   // LTF hariç HTF skoru (0-4)
          const ps = perSet[set.iv] || (perSet[set.iv] = { ok: mk(), no: mk() });
          const buckets = [ltfOk ? G.ltfOk : G.ltfNo, ltfOk ? (htfScore >= 2 ? G.ltfHi : G.ltfLo) : (htfScore >= 2 ? G.noLtfHi : G.noLtfLo), ltfOk ? ps.ok : ps.no];
          for (const g of buckets) {
            g.n++;
            if (!sim.filled) continue;
            g.f++;
            if (sim.res1) { if (sim.res1.win) { g.w1++; g.r1 += sim.res1.r; } else { g.l1++; g.r1 -= 1; } } else g.o1++;
            if (sim.res2) { if (sim.res2.win) { g.w2++; g.r2 += sim.res2.r; } else { g.l2++; g.r2 -= 1; } } else g.o2++;
          }
        }
        process.stdout.write('.');
      } catch (e) { process.stdout.write('x'); }
      await sleep(150);
    }
    process.stdout.write(' [' + set.iv + ' bitti]\n');
  }
  const L = [];
  const log = s => { L.push(s); console.log(s); };
  log('== GERÇEK MMxM FİLTRESİ BACKTESTİ ==');
  log('Tarih: ' + new Date().toLocaleString('tr-TR') + ' | Setup: ' + totalManips + ' | Semboller: ' + SYMS.length + ' | TF: ' + SETS.map(s => s.iv + '(LTF ' + s.ltf + ')').join(' + '));
  log('Kurallar: giriş=limit(geri alınan seviye), stop=wick±%0.3, aynı barda SL+TP→SL (muhafazakar), skor reclaim anı verisiyle (sızıntısız)');
  log('');
  const show = (name, g) => {
    const c1 = g.w1 + g.l1, c2 = g.w2 + g.l2;
    const wr1 = c1 ? (100 * g.w1 / c1).toFixed(1) : '-', e1 = c1 ? (g.r1 / c1).toFixed(2) : '-';
    const wr2 = c2 ? (100 * g.w2 / c2).toFixed(1) : '-', e2 = c2 ? (g.r2 / c2).toFixed(2) : '-';
    log(name.padEnd(30) + 'n ' + String(g.n).padStart(4) + ' | dolan ' + String(g.f).padStart(3) +
      ' | TP1(range): WR %' + wr1 + '  ' + e1 + 'R (' + c1 + ' işlem)' +
      ' | 2R: WR %' + wr2 + '  ' + e2 + 'R (' + c2 + ')');
  };
  log('— LTF onayı × HTF skoru (LTF hariç 0-4) —');
  show('LTF onay + HTF>=2', G.ltfHi);
  show('LTF onay + HTF<2', G.ltfLo);
  show('LTF yok + HTF>=2', G.noLtfHi);
  show('LTF yok + HTF<2', G.noLtfLo);
  log('');
  log('— zaman dilimi bazında LTF etkisi —');
  for (const iv of Object.keys(perSet)) {
    show(iv + ' · LTF onaylı', perSet[iv].ok);
    show(iv + ' · LTF onaysız', perSet[iv].no);
  }
  log('');
  log('— toplam LTF etkisi —');
  show('LTF onaylı (hepsi)', G.ltfOk);
  show('LTF onaysız (hepsi)', G.ltfNo);
  log('');
  const exOk = (G.ltfOk.w1 + G.ltfOk.l1) ? (G.ltfOk.r1 / (G.ltfOk.w1 + G.ltfOk.l1)).toFixed(2) : '-';
  const exNo = (G.ltfNo.w1 + G.ltfNo.l1) ? (G.ltfNo.r1 / (G.ltfNo.w1 + G.ltfNo.l1)).toFixed(2) : '-';
  log('SONUÇ: Edge kaynağı LTF CISD+MSS onayı. GERÇEK = LTF onay + skor>=3.');
  log('Bu koşum (TP1): LTF onaylı ' + exOk + 'R/işlem, onaysız ' + exNo + 'R/işlem — LTF onaysız girme.');
  log('Not: LTF-onaylı örneklem küçük; her koşum güncel pencereyi tarar, rakamlar oynar. Yönün kalıcılığı için ara ara tekrar koş.');
  require('fs').writeFileSync(__dirname + '/backtest_sonuc.txt', L.join('\n'), 'utf8');
  console.log('\nSonuçlar kaydedildi: backtest_sonuc.txt (panelde 📊 Backtest butonundan görüntülenir)');
})();
