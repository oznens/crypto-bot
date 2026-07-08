/*
 * kirsanov_backtest.js — Kirsanov golden-zone stratejisinin geçmiş winrate'i.
 * Strateji: A→B leg'i sonrası 0.618 golden zone'a geri çekilme = GİRİŞ; stop 0.786 ötesi; hedef 1.272/1.618 uzantı.
 *   Long = yükseliş legi (B tepe), Short = düşüş legi (B dip). Leg başını (A) geçen retracement = iptal.
 * Çalıştır: node kirsanov_backtest.js [sembol_sayısı] [interval'ler]
 */
const https = require('https');
const { swings, ema } = require('./analysis');
function get(u) { return new Promise((res, rej) => { https.get(u, { headers: { 'User-Agent': 'bt' }, timeout: 25000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TGT = ['1R', '2R', '3R', 'B(öncekiTepe/Dip ~3.7R)', '1.272ext ~5.3R'];

function backtest(candles) {
  const sw = swings(candles, 3);
  const e = ema(candles.map(c => c.c), 50);                 // trend/EW-yönü proxy'si (seçicilik)
  const piv = [...sw.highs.map(h => ({ i: h.i, p: h.price, t: 'H' })), ...sw.lows.map(l => ({ i: l.i, p: l.price, t: 'L' }))].sort((a, b) => a.i - b.i);
  const by = {}; TGT.forEach(t => by[t] = { w: 0, l: 0, aw: 0, al: 0 }); let signals = 0, aligned = 0;
  for (let k = 1; k < piv.length; k++) {
    const A = piv[k - 1], B = piv[k];
    if (A.t === B.t) continue;
    const range = B.p - A.p; if (Math.abs(range) / A.p < 0.01) continue;
    const long = B.t === 'H';
    const entry = B.p - range * 0.618, stop = B.p - range * 0.786;
    let ei = -1;
    for (let j = B.i + 1; j < candles.length; j++) {
      const c = candles[j];
      if (long ? c.l < A.p : c.h > A.p) { ei = -2; break; }
      if (long ? c.l <= entry : c.h >= entry) { ei = j; break; }
    }
    if (ei < 0) continue;
    const risk = Math.abs(entry - stop); if (risk <= 0) continue;
    signals++;
    const isAligned = e[ei] != null && (long ? candles[ei].c > e[ei] : candles[ei].c < e[ei]); // EW/trend yönü uyumlu mu
    if (isAligned) aligned++;
    const tgt = { '1R': long ? entry + risk : entry - risk, '2R': long ? entry + 2 * risk : entry - 2 * risk, '3R': long ? entry + 3 * risk : entry - 3 * risk, 'B(öncekiTepe/Dip ~3.7R)': B.p, '1.272ext ~5.3R': A.p + range * 1.272 };
    for (const name of TGT) {
      const tp = tgt[name]; let res = 'open';
      for (let j = ei; j < candles.length; j++) {
        const c = candles[j];
        if (long) { if (c.l <= stop) { res = 'loss'; break; } if (c.h >= tp) { res = 'win'; break; } }
        else { if (c.h >= stop) { res = 'loss'; break; } if (c.l <= tp) { res = 'win'; break; } }
      }
      if (res !== 'open') { by[name][res === 'win' ? 'w' : 'l']++; if (isAligned) by[name][res === 'win' ? 'aw' : 'al']++; }
    }
  }
  return { signals, aligned, by };
}
const tgtR = { '1R': 1, '2R': 2, '3R': 3, 'B(öncekiTepe/Dip ~3.7R)': 3.68, '1.272ext ~5.3R': 5.3 };

(async () => {
  const N = +process.argv[2] || 40;
  const intervals = (process.argv[3] || '4h,1d,1h').split(',').map(s => s === '1h' ? '60m' : s);
  const t = await get('https://api.mexc.com/api/v3/ticker/24hr');
  const skip = /^(USDC|USDE|EUR|TUSD|FDUSD|DAI|BUSD|USTC|PAX)/i;
  const syms = t.filter(x => x.symbol.endsWith('USDT') && !skip.test(x.symbol) && !/\d{3,}/.test(x.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, N).map(x => x.symbol);
  console.log('Kirsanov golden-zone backtest — ' + syms.length + ' sembol\nGiriş 0.618 · Stop 0.786 · stop fitille tetiklenir\n');
  for (const iv of intervals) {
    const agg = {}; TGT.forEach(t => agg[t] = { w: 0, l: 0, aw: 0, al: 0 }); let sig = 0, alg = 0;
    for (let i = 0; i < syms.length; i += 6) {
      const chunk = syms.slice(i, i + 6);
      await Promise.all(chunk.map(async sym => {
        try {
          const raw = await get('https://api.mexc.com/api/v3/klines?symbol=' + sym + '&interval=' + iv + '&limit=1000');
          const c = raw.map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
          const b = backtest(c); sig += b.signals; alg += b.aligned;
          TGT.forEach(t => { agg[t].w += b.by[t].w; agg[t].l += b.by[t].l; agg[t].aw += b.by[t].aw; agg[t].al += b.by[t].al; });
        } catch (e) {}
      }));
      await sleep(120);
    }
    console.log('=== ' + (iv === '60m' ? '1h' : iv) + ' === (sinyal: ' + sig + ' · EW/trend uyumlu: ' + alg + ')');
    console.log('  hedef'.padEnd(26) + 'TÜM (winrate/beklenti)        EW-YÖNÜ UYUMLU (winrate/beklenti)');
    TGT.forEach(t => {
      const a = agg[t], cl = a.w + a.l, wr = cl ? a.w / cl * 100 : 0, rr = tgtR[t], exp = cl ? wr / 100 * rr - (1 - wr / 100) : 0;
      const acl = a.aw + a.al, awr = acl ? a.aw / acl * 100 : 0, aexp = acl ? awr / 100 * rr - (1 - awr / 100) : 0;
      console.log('  ' + t.padEnd(24) + (wr.toFixed(1) + '%  ' + exp.toFixed(2) + 'R').padEnd(28) + awr.toFixed(1) + '%  ' + aexp.toFixed(2) + 'R');
    });
    console.log('');
  }
})().catch(e => { console.error('HATA', e.message); process.exit(1); });
