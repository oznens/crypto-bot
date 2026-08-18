/*
 * ICT staged scanner: TS -> MSS -> OB -> IFVG -> retracement -> CISD -> entry -> liquidity target
 * Public Bybit V5 data only. No API key, no order placement.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = process.env.ICT_SCANNER_OUT || path.join(__dirname, 'docs', 'ict-scanner', 'data.json');
const MAX_SYMBOLS = +(process.env.ICT_MAX_SYMBOLS || 50);
const MIN_TURNOVER = +(process.env.ICT_MIN_TURNOVER || 1_000_000);
const BASE = 'https://api.bybit.com';

function getJSON(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'crypto-bot-ict-scanner/1.0' }, timeout }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          const j = JSON.parse(body);
          if (j.retCode !== 0) return reject(new Error(j.retMsg || `retCode=${j.retCode}`));
          resolve(j);
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const round = (x, n = 6) => Number.isFinite(+x) ? +(+x).toFixed(n) : null;

async function topSymbols() {
  const j = await getJSON(`${BASE}/v5/market/tickers?category=linear`);
  return (j.result?.list || [])
    .filter(x => /USDT$/.test(x.symbol || '') && +x.turnover24h >= MIN_TURNOVER && +x.lastPrice > 0)
    .sort((a, b) => +b.turnover24h - +a.turnover24h)
    .slice(0, MAX_SYMBOLS)
    .map(x => ({ symbol: x.symbol, lastPrice: +x.lastPrice, turnover24h: +x.turnover24h }));
}

async function klines(symbol, interval, limit = 300) {
  const j = await getJSON(`${BASE}/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  return (j.result?.list || []).map(r => ({
    t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5]
  })).filter(k => [k.t, k.o, k.h, k.l, k.c].every(Number.isFinite)).reverse();
}

function atr(c, period = 14) {
  if (c.length < period + 2) return 0;
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function pivots(c, wing = 3) {
  const highs = [], lows = [];
  for (let i = wing; i < c.length - wing; i++) {
    let hi = true, lo = true;
    for (let j = i - wing; j <= i + wing; j++) if (j !== i) {
      if (c[j].h >= c[i].h) hi = false;
      if (c[j].l <= c[i].l) lo = false;
    }
    if (hi) highs.push({ i, t: c[i].t, p: c[i].h });
    if (lo) lows.push({ i, t: c[i].t, p: c[i].l });
  }
  return { highs, lows };
}
function lastBefore(arr, i) { for (let n = arr.length - 1; n >= 0; n--) if (arr[n].i < i) return arr[n]; return null; }
function firstAfter(arr, i) { return arr.find(x => x.i > i) || null; }

function latestSweep(c, pv) {
  const start = Math.max(10, c.length - 55);
  let best = null;
  for (let i = start; i < c.length; i++) {
    const ph = lastBefore(pv.highs, i), pl = lastBefore(pv.lows, i);
    if (ph && c[i].h > ph.p && c[i].c < ph.p) best = { side: 'SHORT', i, t: c[i].t, level: ph.p, extreme: c[i].h, pivot: ph };
    if (pl && c[i].l < pl.p && c[i].c > pl.p) best = { side: 'LONG', i, t: c[i].t, level: pl.p, extreme: c[i].l, pivot: pl };
  }
  return best;
}

function findMSS(c, pv, sw) {
  if (!sw) return null;
  const a = atr(c.slice(0, Math.min(c.length, sw.i + 30))) || atr(c);
  const ref = sw.side === 'SHORT' ? lastBefore(pv.lows, sw.i + 1) : lastBefore(pv.highs, sw.i + 1);
  if (!ref) return null;
  for (let i = sw.i + 1; i < c.length; i++) {
    const body = Math.abs(c[i].c - c[i].o);
    const broken = sw.side === 'SHORT' ? c[i].c < ref.p : c[i].c > ref.p;
    const direction = sw.side === 'SHORT' ? c[i].c < c[i].o : c[i].c > c[i].o;
    if (broken && direction && body >= a * 0.55) return { i, t: c[i].t, level: ref.p, displacement: body / Math.max(a, 1e-12) };
  }
  return null;
}

function findOB(c, side, mss) {
  if (!mss) return null;
  for (let i = mss.i - 1; i >= Math.max(0, mss.i - 12); i--) {
    const opposite = side === 'SHORT' ? c[i].c > c[i].o : c[i].c < c[i].o;
    if (opposite) return { i, t: c[i].t, low: c[i].l, high: c[i].h, kind: side === 'SHORT' ? 'bearish' : 'bullish' };
  }
  return null;
}

function allFVG(c) {
  const out = [];
  for (let i = 2; i < c.length; i++) {
    if (c[i - 2].h < c[i].l) out.push({ type: 'bull', i, t: c[i].t, low: c[i - 2].h, high: c[i].l });
    if (c[i - 2].l > c[i].h) out.push({ type: 'bear', i, t: c[i].t, low: c[i].h, high: c[i - 2].l });
  }
  return out;
}

function findIFVG(c, side, sw, mss) {
  if (!mss) return null;
  const fvgs = allFVG(c).filter(f => f.i >= Math.max(2, sw.i - 10) && f.i <= mss.i + 8);
  const wanted = side === 'SHORT' ? 'bull' : 'bear';
  let best = null;
  for (const f of fvgs.filter(x => x.type === wanted)) {
    let inversion = -1;
    for (let i = f.i + 1; i < c.length; i++) {
      if ((side === 'SHORT' && c[i].c < f.low) || (side === 'LONG' && c[i].c > f.high)) { inversion = i; break; }
    }
    if (inversion < 0) continue;
    let retest = -1;
    for (let i = inversion + 1; i < c.length; i++) {
      const touches = c[i].h >= f.low && c[i].l <= f.high;
      if (touches) { retest = i; break; }
    }
    best = { ...f, inversion, inversionTime: c[inversion].t, retest, retestTime: retest >= 0 ? c[retest].t : null };
  }
  return best;
}

function overlap(a, b) {
  if (!a || !b) return null;
  const low = Math.max(a.low, b.low), high = Math.min(a.high, b.high);
  return high > low ? { low, high } : null;
}

function targetLiquidity(c, pv, side, fromIndex) {
  const px = c[c.length - 1].c;
  const pool = side === 'SHORT' ? pv.lows.filter(x => x.i < fromIndex && x.p < px) : pv.highs.filter(x => x.i < fromIndex && x.p > px);
  if (pool.length) return pool[pool.length - 1];
  const slice = c.slice(Math.max(0, fromIndex - 120), fromIndex + 1);
  if (!slice.length) return null;
  if (side === 'SHORT') {
    const k = slice.reduce((a, b) => a.l < b.l ? a : b); return { i: c.indexOf(k), t: k.t, p: k.l };
  }
  const k = slice.reduce((a, b) => a.h > b.h ? a : b); return { i: c.indexOf(k), t: k.t, p: k.h };
}

function ltfCISD(c, side) {
  if (!c || c.length < 25) return null;
  const a = atr(c) || 0;
  for (let i = c.length - 2; i >= Math.max(3, c.length - 45); i--) {
    const opp = side === 'SHORT' ? c[i].c > c[i].o : c[i].c < c[i].o;
    if (!opp) continue;
    const level = c[i].o;
    for (let j = i + 1; j < c.length; j++) {
      const body = Math.abs(c[j].c - c[j].o);
      const confirmed = side === 'SHORT' ? c[j].c < level : c[j].c > level;
      const dir = side === 'SHORT' ? c[j].c < c[j].o : c[j].c > c[j].o;
      if (confirmed && dir && body >= a * 0.35) return { i: j, t: c[j].t, level, sourceTime: c[i].t };
    }
  }
  return null;
}

function stageFor(x) {
  if (!x.sweep) return { n: 0, key: 'WAITING', label: 'Likidite süpürmesi bekleniyor' };
  if (!x.mss) return { n: 1, key: 'LIQUIDITY_SWEPT', label: 'TS+ tamam · MSS bekleniyor' };
  if (!x.ob) return { n: 2, key: 'MSS', label: 'MSS tamam · OB aranıyor' };
  if (!x.ifvg) return { n: 3, key: 'OB_FOUND', label: 'OB tamam · IFVG bekleniyor' };
  if (x.ifvg.retest < 0) return { n: 4, key: 'IFVG', label: 'IFVG hazır · retracement bekleniyor' };
  if (!x.cisd) return { n: 5, key: 'RETRACEMENT', label: 'Retracement tamam · CISD bekleniyor' };
  return { n: 7, key: 'ENTRY_READY', label: 'CISD onaylı · giriş hazır' };
}

async function analyzeSymbol(meta) {
  const c4 = await klines(meta.symbol, '240', 320);
  if (c4.length < 100) throw new Error('4H veri yetersiz');
  // Ignore the still-forming last 4H candle for structural confirmations, keep it for market price.
  const closed4 = c4.slice(0, -1);
  const pv = pivots(closed4, 3);
  const sweep = latestSweep(closed4, pv);
  const side = sweep?.side || null;
  const mss = sweep ? findMSS(closed4, pv, sweep) : null;
  const ob = mss ? findOB(closed4, side, mss) : null;
  const ifvg = mss ? findIFVG(closed4, side, sweep, mss) : null;
  const ov = overlap(ob, ifvg);
  let cisd = null, c15 = null;
  if (ifvg && ifvg.retest >= 0) {
    c15 = await klines(meta.symbol, '15', 260);
    cisd = ltfCISD(c15.slice(0, -1), side);
  }
  const target = sweep ? targetLiquidity(closed4, pv, side, sweep.i) : null;
  const current = c4[c4.length - 1].c;
  const invalidation = sweep ? sweep.extreme : null;
  const entryZone = ov || (ifvg ? { low: ifvg.low, high: ifvg.high } : ob ? { low: ob.low, high: ob.high } : null);
  const entry = entryZone ? (entryZone.low + entryZone.high) / 2 : null;
  const risk = entry && invalidation ? Math.abs(invalidation - entry) : null;
  const reward = entry && target ? Math.abs(target.p - entry) : null;
  const rr = risk > 0 ? reward / risk : null;
  const x = { sweep, mss, ob, ifvg, cisd };
  const stage = stageFor(x);
  const checks = [!!sweep, !!sweep, !!mss, !!ob, !!ifvg, !!(ifvg && ifvg.retest >= 0), !!cisd, !!target];
  const score = checks.filter(Boolean).length;
  const invalid = side === 'SHORT' ? current > invalidation : side === 'LONG' ? current < invalidation : false;
  const grade = score >= 8 && rr >= 1.5 ? 'A+' : score >= 6 && rr >= 1.25 ? 'A' : score >= 4 ? 'B' : 'WATCH';

  return {
    symbol: meta.symbol, side, price: round(current), turnover24h: round(meta.turnover24h, 0),
    updatedAt: Date.now(), score, maxScore: 8, grade, stage: invalid ? { n: stage.n, key: 'INVALIDATED', label: 'Setup geçersiz oldu' } : stage,
    levels: {
      sweep: sweep ? round(sweep.level) : null, sweepExtreme: sweep ? round(sweep.extreme) : null,
      mss: mss ? round(mss.level) : null,
      ob: ob ? { low: round(ob.low), high: round(ob.high), time: ob.t } : null,
      ifvg: ifvg ? { low: round(ifvg.low), high: round(ifvg.high), time: ifvg.t, inversionTime: ifvg.inversionTime, retestTime: ifvg.retestTime } : null,
      overlap: ov ? { low: round(ov.low), high: round(ov.high) } : null,
      cisd: cisd ? round(cisd.level) : null,
      target: target ? round(target.p) : null,
      invalidation: invalidation ? round(invalidation) : null,
      entry: entry ? round(entry) : null,
      rr: rr ? round(rr, 2) : null
    },
    events: {
      sweep: sweep ? { time: sweep.t, label: side === 'SHORT' ? 'TS+ buyside sweep' : 'TS+ sellside sweep' } : null,
      mss: mss ? { time: mss.t, label: 'MSS', displacementATR: round(mss.displacement, 2) } : null,
      cisd: cisd ? { time: cisd.t, label: 'CISD', tf: '15m' } : null
    },
    checks: [
      { key: 'sweep', label: side === 'LONG' ? 'Sellside sweep' : 'Buyside sweep', ok: !!sweep },
      { key: 'ts', label: 'Turtle Soup (TS+)', ok: !!sweep },
      { key: 'mss', label: side === 'LONG' ? 'Bullish MSS' : 'Bearish MSS', ok: !!mss },
      { key: 'ob', label: side === 'LONG' ? 'Bullish OB' : 'Bearish OB', ok: !!ob },
      { key: 'ifvg', label: 'IFVG inversion', ok: !!ifvg },
      { key: 'retrace', label: 'IFVG retracement', ok: !!(ifvg && ifvg.retest >= 0) },
      { key: 'cisd', label: '15M CISD', ok: !!cisd },
      { key: 'target', label: side === 'LONG' ? 'Buyside hedef' : 'Sellside hedef', ok: !!target }
    ],
    candles4h: c4.slice(-150).map(k => [Math.floor(k.t / 1000), round(k.o), round(k.h), round(k.l), round(k.c)]),
    methodology: 'Mechanical approximation: confirmed pivots, close-back-inside liquidity sweep (TS), ATR displacement MSS, last opposite candle OB, inverted 3-candle FVG, 15m CISD proxy.'
  };
}

(async () => {
  const startedAt = Date.now();
  const symbols = await topSymbols();
  const results = [], errors = [];
  for (const meta of symbols) {
    try {
      results.push(await analyzeSymbol(meta));
      process.stdout.write(`✓ ${meta.symbol} ${results[results.length - 1].stage.key} ${results[results.length - 1].score}/8\n`);
    } catch (e) {
      errors.push({ symbol: meta.symbol, error: String(e.message || e) });
      process.stdout.write(`✗ ${meta.symbol} ${e.message}\n`);
    }
    await sleep(80);
  }
  results.sort((a, b) => (b.score - a.score) || ((b.levels.rr || 0) - (a.levels.rr || 0)) || (b.turnover24h - a.turnover24h));
  const payload = {
    version: 1,
    source: 'Bybit USDT Perpetual',
    generatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    universe: { requested: MAX_SYMBOLS, scanned: results.length },
    model: { htf: '4H', trigger: '15M', stages: ['TS+', 'MSS', 'OB', 'IFVG', 'Retracement', 'CISD', 'Entry', 'Liquidity TP'] },
    results,
    errors
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(`Yazıldı: ${OUT} (${results.length} parite, ${errors.length} hata)`);
})().catch(e => { console.error(e); process.exit(1); });
