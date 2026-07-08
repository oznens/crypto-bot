/*
 * forever_backtest.js — Forever Model (YAKLAŞIK: FVG+trend) mantığının geçmiş winrate'i.
 * Top sembollerde, seçili zaman dilimlerinde geriye dönük test eder, toplu winrate basar.
 * NOT: gerçek kapalı-kaynak indikatörün birebir aynısı değil; dokümante mantığa dayalı yaklaşık.
 * Çalıştır: node forever_backtest.js
 */
const https = require('https');
const { backtest } = require('./analysis');
function get(u) { return new Promise((res, rej) => { https.get(u, { headers: { 'User-Agent': 'bt' }, timeout: 20000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const N = +process.argv[2] || 40;
  const intervals = (process.argv[3] || '15m,1h,4h').split(',').map(s => s === '1h' ? '60m' : s);
  const t = await get('https://api.mexc.com/api/v3/ticker/24hr');
  const skip = /^(USDC|USDE|EUR|TUSD|FDUSD|DAI|BUSD|USTC|PAX)/i;
  const syms = t.filter(x => x.symbol.endsWith('USDT') && !skip.test(x.symbol) && !/\d{3,}/.test(x.symbol))
    .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, N).map(x => x.symbol);
  console.log('Forever Model (yaklaşık FVG+trend) backtest — ' + syms.length + ' sembol\n');
  for (const iv of intervals) {
    const agg = {}; [1, 1.5, 2, 3].forEach(r => agg[r] = { win: 0, loss: 0 }); let sig = 0;
    for (let i = 0; i < syms.length; i += 6) {
      const chunk = syms.slice(i, i + 6);
      await Promise.all(chunk.map(async sym => {
        try {
          const raw = await get('https://api.mexc.com/api/v3/klines?symbol=' + sym + '&interval=' + iv + '&limit=1000');
          const c = raw.map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
          const b = backtest(c);
          sig += b.signals;
          for (const r of [1, 1.5, 2, 3]) { agg[r].win += b.perR[r].win; agg[r].loss += b.perR[r].loss; }
        } catch (e) {}
      }));
      await sleep(120);
    }
    const label = iv === '60m' ? '1h' : iv;
    console.log('=== ' + label + ' === (sinyal: ' + sig + ')');
    for (const r of [1, 1.5, 2, 3]) { const a = agg[r], cl = a.win + a.loss; const wr = cl ? (a.win / cl * 100) : 0; const exp = cl ? (wr / 100 * r - (1 - wr / 100)) : 0; console.log('  TP=' + r + 'R  winrate=' + wr.toFixed(1) + '%  (W' + a.win + '/L' + a.loss + ')  beklenti=' + exp.toFixed(2) + 'R'); }
    console.log('');
  }
})().catch(e => { console.error('HATA', e.message); process.exit(1); });
