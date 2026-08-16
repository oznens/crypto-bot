/*
 * analysis.js — SMC / ICT analiz motoru (v2)
 * yigitalagozoglu çerçevesi:
 *   1) HTF + LTF bias (trendi takip et)           2) likidite beklentisi (key level / eşit dip-tepe)
 *   3) market yapısı (BOS/CHoCH)                   4) giriş modelleri: TURTLE SOUP, PO3/Range, FVG/OB
 *   5) RSI teyit + premium/discount (EQ)
 * HTF, ekstra ağ isteği olmadan LTF mumları yeniden örneklenerek hesaplanır.
 * Saf JS, bağımlılık yok.
 */
'use strict';

function round(v, p) {
  if (!isFinite(v)) return v;
  const abs = Math.abs(v);
  let d = p != null ? p : abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

// ----------------------------- RSI -----------------------------
function rsi(closes, period) {
  period = period || 14;
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const c = closes[i] - closes[i - 1]; if (c >= 0) g += c; else l -= c; }
  let aG = g / period, aL = l / period;
  out[period] = aL === 0 ? 100 : 100 - 100 / (1 + aG / aL);
  for (let i = period + 1; i < closes.length; i++) {
    const c = closes[i] - closes[i - 1];
    aG = (aG * (period - 1) + (c > 0 ? c : 0)) / period;
    aL = (aL * (period - 1) + (c < 0 ? -c : 0)) / period;
    out[i] = aL === 0 ? 100 : 100 - 100 / (1 + aG / aL);
  }
  return out;
}

// ----------------------------- swing pivotları -----------------------------
function swings(candles, k) {
  k = k || 2;
  const highs = [], lows = [];
  for (let i = k; i < candles.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isH = false;
      if (candles[j].l <= candles[i].l) isL = false;
    }
    if (isH) highs.push({ i, price: candles[i].h, type: 'H' });
    if (isL) lows.push({ i, price: candles[i].l, type: 'L' });
  }
  return { highs, lows };
}

// ----------------------------- market yapısı (BOS / CHoCH) -----------------------------
function marketStructure(candles, sw) {
  const pts = [...sw.highs, ...sw.lows].sort((a, b) => a.i - b.i);
  const events = [];
  let trend = 'range', lastHigh = null, lastLow = null;
  for (const p of pts) {
    if (p.type === 'H') {
      if (lastHigh && p.price > lastHigh.price) { events.push({ i: p.i, price: p.price, kind: trend === 'down' ? 'CHoCH' : 'BOS', dir: 'up' }); trend = 'up'; }
      lastHigh = p;
    } else {
      if (lastLow && p.price < lastLow.price) { events.push({ i: p.i, price: p.price, kind: trend === 'up' ? 'CHoCH' : 'BOS', dir: 'down' }); trend = 'down'; }
      lastLow = p;
    }
  }
  return { events, trend };
}

// ----------------------------- likidite (eşit tepe/dip) -----------------------------
function liquidity(sw, tol) {
  tol = tol || 0.0015;
  const pools = [];
  function cluster(points, kind) {
    const used = new Array(points.length).fill(false);
    for (let a = 0; a < points.length; a++) {
      if (used[a]) continue;
      const group = [points[a]];
      for (let b = a + 1; b < points.length; b++) {
        if (used[b]) continue;
        if (Math.abs(points[b].price - points[a].price) / points[a].price <= tol) { group.push(points[b]); used[b] = true; }
      }
      if (group.length >= 2) {
        const price = group.reduce((s, g) => s + g.price, 0) / group.length;
        pools.push({ price, type: kind, from: Math.min(...group.map(g => g.i)), touches: group.length, label: kind === 'BSL' ? 'Eşit Tepe (BSL)' : 'Eşit Dip (SSL)' });
      }
    }
  }
  cluster(sw.highs, 'BSL'); cluster(sw.lows, 'SSL');
  return pools.sort((a, b) => a.price - b.price);
}

// ----------------------------- FVG -----------------------------
function fvgs(candles, minGapPct) {
  minGapPct = minGapPct || 0.0008;
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], c = candles[i];
    if (c.l > a.h && (c.l - a.h) / a.h >= minGapPct) out.push({ type: 'bull', top: c.l, bottom: a.h, from: i - 2, to: i, mid: (c.l + a.h) / 2 });
    if (c.h < a.l && (a.l - c.h) / a.l >= minGapPct) out.push({ type: 'bear', top: a.l, bottom: c.h, from: i - 2, to: i, mid: (a.l + c.h) / 2 });
  }
  return out;
}

// ----------------------------- Order Block -----------------------------
function orderBlocks(candles, ms) {
  const out = [];
  for (const ev of ms.events) {
    const idx = ev.i;
    if (ev.dir === 'up') {
      for (let j = idx - 1; j >= Math.max(0, idx - 12); j--) if (candles[j].c < candles[j].o) { out.push({ type: 'bull', top: Math.max(candles[j].o, candles[j].h), bottom: candles[j].l, from: j, anchor: idx }); break; }
    } else {
      for (let j = idx - 1; j >= Math.max(0, idx - 12); j--) if (candles[j].c > candles[j].o) { out.push({ type: 'bear', top: candles[j].h, bottom: Math.min(candles[j].o, candles[j].l), from: j, anchor: idx }); break; }
    }
  }
  return out;
}

// ----------------------------- Equilibrium / premium-discount -----------------------------
// Güncel dealing range — fiyatı her zaman kapsar (premium/discount anlamlı kalır).
function equilibrium(candles, win) {
  win = win || 90;
  const seg = candles.slice(-win);
  if (seg.length < 10) return null;
  let high = -Infinity, low = Infinity, hi = 0, li = 0;
  const base = candles.length - seg.length;
  for (let i = 0; i < seg.length; i++) {
    if (seg[i].h > high) { high = seg[i].h; hi = base + i; }
    if (seg[i].l < low) { low = seg[i].l; li = base + i; }
  }
  if (high <= low) return null;
  return { high, low, mid: (high + low) / 2, fromHigh: hi, fromLow: li };
}

// ----------------------------- HTF: LTF mumlarını yeniden örnekle -----------------------------
const HTF_MAP = { '1m': 15 * 60000, '5m': 60 * 60000, '15m': 4 * 3600000, '30m': 4 * 3600000, '60m': 24 * 3600000, '4h': 24 * 3600000, '1d': 7 * 24 * 3600000 };
const HTF_LABEL = { '1m': '15m', '5m': '1sa', '15m': '4sa', '30m': '4sa', '60m': '1g', '4h': '1g', '1d': '1hf' };

function resample(candles, bucketMs) {
  if (!candles.length) return [];
  const out = [];
  let cur = null, key = null;
  for (const c of candles) {
    const k = Math.floor(c.t / bucketMs);
    if (k !== key) { if (cur) out.push(cur); cur = { t: k * bucketMs, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }; key = k; }
    else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.v += c.v; }
  }
  if (cur) out.push(cur);
  return out;
}

// ----------------------------- HTF Key Level'ları -----------------------------
// HTF salınımlarından, fiyatın tepki verdiği belirgin seviyeler.
function keyLevels(htfCandles, price) {
  const sw = swings(htfCandles, 2);
  const all = [];
  sw.highs.forEach(h => all.push({ price: h.price, kind: 'high' }));
  sw.lows.forEach(l => all.push({ price: l.price, kind: 'low' }));
  // önemli son tepe/dip + tüm zamanların ekstremleri
  if (htfCandles.length) {
    all.push({ price: Math.max(...htfCandles.map(c => c.h)), kind: 'high' });
    all.push({ price: Math.min(...htfCandles.map(c => c.l)), kind: 'low' });
  }
  // kümele (yakın seviyeleri birleştir, dokunuşu say)
  const tol = 0.004;
  const merged = [];
  all.sort((a, b) => a.price - b.price).forEach(lv => {
    const m = merged.find(x => Math.abs(x.price - lv.price) / lv.price <= tol && x.kind === lv.kind);
    if (m) { m.touches++; m.price = (m.price * (m.touches - 1) + lv.price) / m.touches; }
    else merged.push({ price: lv.price, kind: lv.kind, touches: 1, htf: true });
  });
  // fiyata en yakın güçlü seviyeleri seç
  return merged
    .map(l => ({ ...l, dist: Math.abs(l.price - price) / price }))
    .sort((a, b) => (b.touches - a.touches) || (a.dist - b.dist))
    .slice(0, 6)
    .sort((a, b) => a.price - b.price);
}

// ----------------------------- TURTLE SOUP (imza model) -----------------------------
// Bir seviyeyi (likidite/key level) fitille kıran ama geri kapatan = sahte kırılım -> dönüş.
function detectTurtleSoup(candles, levels) {
  const n = candles.length;
  const look = 6; // son birkaç mum
  let best = null;
  for (let i = n - look; i < n; i++) {
    if (i < 1) continue;
    const c = candles[i];
    for (const lv of levels) {
      // BOĞA TS: dip seviyesinin altını fitille aldı, üstünde kapattı
      if (lv.kind === 'low' && c.l < lv.price && c.c > lv.price) {
        const pen = (lv.price - c.l) / lv.price;            // fitil derinliği
        const body = Math.abs(c.c - c.o) / lv.price;
        if (pen >= 0.0006) {
          const sc = (lv.htf ? 3 : lv.touches >= 2 ? 2 : 1) + Math.min(pen * 50, 2) + (c.c > c.o ? 0.5 : 0) + (n - 1 - i <= 2 ? 1 : 0);
          if (!best || sc > best.score) best = { side: 'LONG', model: 'Turtle Soup', level: lv, wick: c.l, at: i, atHTF: !!lv.htf, score: sc };
        }
      }
      // AYI TS: tepe seviyesinin üstünü fitille aldı, altında kapattı
      if (lv.kind === 'high' && c.h > lv.price && c.c < lv.price) {
        const pen = (c.h - lv.price) / lv.price;
        if (pen >= 0.0006) {
          const sc = (lv.htf ? 3 : lv.touches >= 2 ? 2 : 1) + Math.min(pen * 50, 2) + (c.c < c.o ? 0.5 : 0) + (n - 1 - i <= 2 ? 1 : 0);
          if (!best || sc > best.score) best = { side: 'SHORT', model: 'Turtle Soup', level: lv, wick: c.h, at: i, atHTF: !!lv.htf, score: sc };
        }
      }
    }
  }
  return best;
}

// ----------------------------- PO3 / Range (AMD) -----------------------------
// Yatay range + bir tarafın manipülasyonu (sweep) + geri alım -> diğer tarafa dağıtım.
function detectPO3(candles, eq) {
  if (!eq) return null;
  const n = candles.length, look = 8;
  const width = (eq.high - eq.low) / eq.mid;
  if (width > 0.12 || width < 0.004) return null; // makul bir range
  // range içinde mi salınmış? (son 40 mumun çoğu band içinde)
  const seg = candles.slice(-40);
  const inside = seg.filter(c => c.h <= eq.high * 1.01 && c.l >= eq.low * 0.99).length;
  if (inside < seg.length * 0.55) return null;
  for (let i = n - look; i < n; i++) {
    if (i < 1) continue;
    const c = candles[i];
    if (c.l < eq.low && c.c > eq.low) return { side: 'LONG', model: 'PO3 / Range', level: { price: eq.low, kind: 'low' }, wick: c.l, at: i, range: { high: eq.high, low: eq.low } };
    if (c.h > eq.high && c.c < eq.high) return { side: 'SHORT', model: 'PO3 / Range', level: { price: eq.high, kind: 'high' }, wick: c.h, at: i, range: { high: eq.high, low: eq.low } };
  }
  return null;
}

// ----------------------------- FVG/OB retest (yedek model) -----------------------------
function detectFVGOB(price, fvg, ob, inDiscount, inPremium) {
  const bullF = fvg.filter(f => f.type === 'bull' && price >= f.bottom * 0.999 && price <= f.top * 1.004).slice(-1)[0];
  const bullO = ob.filter(o => o.type === 'bull' && price >= o.bottom * 0.999 && price <= o.top * 1.004).slice(-1)[0];
  const bearF = fvg.filter(f => f.type === 'bear' && price <= f.top * 1.001 && price >= f.bottom * 0.996).slice(-1)[0];
  const bearO = ob.filter(o => o.type === 'bear' && price <= o.top * 1.001 && price >= o.bottom * 0.996).slice(-1)[0];
  if (inDiscount && (bullF || bullO)) return { side: 'LONG', model: 'FVG/OB Retest', zone: bullO || bullF };
  if (inPremium && (bearF || bearO)) return { side: 'SHORT', model: 'FVG/OB Retest', zone: bearO || bearF };
  return null;
}

function dedupTargets(arr, entry, dir) {
  const out = [];
  for (const v of arr) {
    if (dir === 'up' && v <= entry) continue;
    if (dir === 'down' && v >= entry) continue;
    if (out.some(o => Math.abs(o - v) / v < 0.0015)) continue;
    out.push(v);
  }
  return dir === 'up' ? out.sort((a, b) => a - b) : out.sort((a, b) => b - a);
}

// ----------------------------- setup üretimi (model + HTF bias) -----------------------------
function buildSetup(candles, ctx) {
  const { eq, liq, fvg, ob, rsiArr, htfBias, kls } = ctx;
  const last = candles[candles.length - 1];
  const price = last.c;
  if (!eq) return null;
  const curRsi = rsiArr[rsiArr.length - 1];
  const inDiscount = price < eq.mid, inPremium = price > eq.mid;

  // sweep modelleri için seviye havuzu: HTF key level + eşit dip/tepe
  const levels = [
    ...kls,
    ...liq.map(l => ({ price: l.price, kind: l.type === 'BSL' ? 'high' : 'low', touches: l.touches, htf: false }))
  ];

  const candidates = [];
  const ts = detectTurtleSoup(candles, levels); if (ts) candidates.push(ts);
  const po3 = detectPO3(candles, eq); if (po3) candidates.push(po3);
  const fo = detectFVGOB(price, fvg, ob, inDiscount, inPremium); if (fo) candidates.push(fo);
  if (!candidates.length) return null;

  // her aday için skor + entry/sl/tp
  const recent = candles.slice(-30);
  function build(cand) {
    const side = cand.side;
    const reasons = [];
    let score = 1;
    const wyName = (cand.model === 'Turtle Soup' || cand.model === 'PO3 / Range')
      ? (side === 'LONG' ? 'SW-A (Wyckoff Accumulation)' : 'SW-D (Wyckoff Distribution)')
      : (side === 'LONG' ? 'RA (Re-Accumulation)' : 'MMC (MM Continuation)');
    reasons.push('Model: ' + wyName);

    if (cand.model === 'Turtle Soup') {
      reasons.push(side === 'LONG' ? 'Dip likiditesi fitille süpürüldü, üstüne geri kapandı (sahte kırılım)' : 'Tepe likiditesi fitille süpürüldü, altına geri kapandı (sahte kırılım)');
      score += 2;
      if (cand.atHTF) { reasons.push('Süpürülen seviye HTF Key Level (A+ bölge)'); score += 2; }
      else if (cand.level.touches >= 2) { reasons.push('Eşit ' + (side === 'LONG' ? 'dip' : 'tepe') + ' likiditesi'); score += 1; }
    } else if (cand.model === 'PO3 / Range') {
      reasons.push(side === 'LONG' ? 'Range altı manipüle edildi, geri alındı (accumulation→manipulation)' : 'Range üstü manipüle edildi, geri alındı');
      score += 2.5;
    } else {
      reasons.push(side === 'LONG' ? 'Boğa FVG/OB bölgesinde giriş' : 'Ayı FVG/OB bölgesinde giriş');
      score += 1;
    }

    // HTF bias uyumu — onun 1. kuralı: trendi takip et
    let htfAligned = null;
    if (htfBias === 'up') htfAligned = side === 'LONG';
    else if (htfBias === 'down') htfAligned = side === 'SHORT';
    if (htfAligned === true) { reasons.push('HTF bias uyumlu (' + htfBias + ')'); score += 2; }
    else if (htfAligned === false) { reasons.push('⚠ HTF bias ters — düşük olasılık'); score -= 2; }

    // premium/discount
    if (side === 'LONG' && inDiscount) { reasons.push('Discount bölge (EQ altı)'); score += 1; }
    if (side === 'SHORT' && inPremium) { reasons.push('Premium bölge (EQ üstü)'); score += 1; }

    // RSI
    if (curRsi != null) {
      if (side === 'LONG' && curRsi < 42) { reasons.push('RSI düşük (' + Math.round(curRsi) + ')'); score += 1; }
      if (side === 'SHORT' && curRsi > 58) { reasons.push('RSI yüksek (' + Math.round(curRsi) + ')'); score += 1; }
    }

    // entry / sl / tp
    let entry, stop, tps;
    if (side === 'LONG') {
      const z = cand.zone;
      entry = z ? (z.top + z.bottom) / 2 : price;
      const wick = cand.wick != null ? cand.wick : Math.min(...recent.slice(-8).map(c => c.l));
      stop = Math.min(wick, z ? z.bottom : wick) * 0.998;
      const t = [];
      if (entry < eq.mid) t.push(eq.mid);
      liq.filter(l => l.price > entry).forEach(l => t.push(l.price));
      kls.filter(l => l.price > entry).forEach(l => t.push(l.price));
      t.push(eq.high);
      tps = dedupTargets(t, entry, 'up').slice(0, 3);
    } else {
      const z = cand.zone;
      entry = z ? (z.top + z.bottom) / 2 : price;
      const wick = cand.wick != null ? cand.wick : Math.max(...recent.slice(-8).map(c => c.h));
      stop = Math.max(wick, z ? z.top : wick) * 1.002;
      const t = [];
      if (entry > eq.mid) t.push(eq.mid);
      liq.filter(l => l.price < entry).forEach(l => t.push(l.price));
      kls.filter(l => l.price < entry).forEach(l => t.push(l.price));
      t.push(eq.low);
      tps = dedupTargets(t, entry, 'down').slice(0, 3);
    }
    if (!tps.length) return null;
    // gerçekçi stop: çok dar stop'lar R/R'yi şişirir -> %0.15 taban uygula
    const minRisk = entry * 0.0015;
    if (Math.abs(entry - stop) < minRisk) stop = side === 'LONG' ? entry - minRisk : entry + minRisk;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) return null;
    let rr = Math.abs(tps[tps.length - 1] - entry) / risk;
    rr = Math.min(rr, 20); // görsel sağduyu

    let grade = 'B';
    if (score >= 7 && rr >= 2.5 && htfAligned !== false) grade = 'A+';
    else if (score >= 5 && rr >= 1.8 && htfAligned !== false) grade = 'A';
    const confidence = Math.max(10, Math.min(99, Math.round((score / 10) * 60 + Math.min(rr, 5) / 5 * 40)));

    const originAt = cand.at != null ? cand.at : (cand.zone && cand.zone.from != null ? cand.zone.from : null);
    const o = originAt != null ? originAt : candles.length - 1;
    // fiyat girişe değdi mi? (TW pozisyon aracı yalnız değdikten sonra gösterilir)
    let entryIdx = -1;
    for (let i = o; i < candles.length; i++) {
      if (side === 'LONG' && candles[i].l <= entry) { entryIdx = i; break; }
      if (side === 'SHORT' && candles[i].h >= entry) { entryIdx = i; break; }
    }
    const entryStatus = entryIdx >= 0 ? 'active' : 'pending';
    // STOP bütünlüğü: son leg boyunca (en az son ~20 mum + sinyalden bu yana) fiyat stop'u FİTİLLE gördüyse
    //   -> stop son legin ekstremi değil (kalitesiz sweep) ya da zaten stop olmuş -> setup geçersiz, gösterme
    const win = Math.max(0, Math.min(o, candles.length - 20));
    for (let i = win; i < candles.length; i++) {
      if (side === 'LONG' && candles[i].l <= stop) return null;
      if (side === 'SHORT' && candles[i].h >= stop) return null;
    }
    // HEDEF tamamlandı mı? girişe değdikten sonra SON TP'yi gördüyse -> işlem bitti -> gösterme
    if (entryIdx >= 0) {
      const tFinal = tps[tps.length - 1];
      for (let i = entryIdx; i < candles.length; i++) {
        if (side === 'LONG' && candles[i].h >= tFinal) return null;
        if (side === 'SHORT' && candles[i].l <= tFinal) return null;
      }
    }
    return { side, model: cand.model, grade, confidence, entry: round(entry), stop: round(stop), tps: tps.map(t => round(t)), rr: Math.round(rr * 10) / 10, riskPct: round(risk / entry * 100, 2), htfAligned, htfBias, sweptLevel: cand.level ? round(cand.level.price) : null, sweepAt: cand.at != null ? cand.at : null, sweepWick: cand.wick != null ? round(cand.wick) : null, originAt, entryStatus, atHTF: !!cand.atHTF, reasons, _score: score };
  }

  const built = candidates.map(build).filter(Boolean);
  if (!built.length) return null;
  built.sort((a, b) => b._score - a._score);
  const best = built[0];
  if (best._score < 3 || best.rr < 1.3) return null; // izleme modu
  delete best._score;
  return best;
}

// ----------------------------- SolCJ: Seans DOL'ları (Asya/Londra/NY) -----------------------------
function sessionLevels(candles, interval) {
  if (interval === '4h' || interval === '1d') return [];
  const sess = c => { const h = new Date(c.t).getUTCHours(); return h < 7 ? 'Asya' : h < 13 ? 'Londra' : 'NY'; };
  const cutoff = candles[candles.length - 1].t - 2 * 24 * 3600000;
  const groups = {};
  for (const c of candles) {
    if (c.t < cutoff) continue;
    const d = new Date(c.t), key = d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate() + '|' + sess(c);
    const g = groups[key] || (groups[key] = { name: sess(c), t1: c.t, high: c.h, low: c.l });
    g.high = Math.max(g.high, c.h); g.low = Math.min(g.low, c.l); g.t1 = c.t;
  }
  const latest = {};
  Object.values(groups).forEach(g => { if (!latest[g.name] || g.t1 > latest[g.name].t1) latest[g.name] = g; });
  const price = candles[candles.length - 1].c;
  return ['Asya', 'Londra', 'NY'].filter(n => latest[n]).map(n => ({
    name: n, high: round(latest[n].high), low: round(latest[n].low),
    highSwept: price > latest[n].high, lowSwept: price < latest[n].low
  }));
}

// ----------------------------- SolCJ: Wyckoff model + olay etiketleri + diagonal trendline -----------------------------
// Gerçek grafiklerinden öğrenilen yerleşim:
//  Distribution: PSY -> BC(en yüksek tepe) -> AR(BC sonrası ilk dip) -> UT-B(ara upthrust) -> UTAD(sweep) -> BOS/LPSY.
//    Diagonal: TEPELERİ birleştirir (BC -> UTAD), sağa uzatılır.
//  Accumulation: PS -> SC(en düşük dip) -> AR(SC sonrası ilk tepe) -> ST -> Spring(sweep) -> SOS/LPS.
//    Diagonal: DİPLERİ birleştirir (SC -> Spring).
function wyckoffModel(candles, eq, setup, sw, ms) {
  if (!eq || candles.length < 40) return null;
  const n = candles.length, last = candles[n - 1];
  const W = Math.min(140, n), base = n - W;
  const winH = (sw.highs || []).filter(h => h.i >= base);
  const winL = (sw.lows || []).filter(l => l.i >= base);
  // pencere ekstremleri (fallback)
  let hi = -Infinity, lo = Infinity, hiI = base, loI = base;
  for (let i = base; i < n; i++) { if (candles[i].h > hi) { hi = candles[i].h; hiI = i; } if (candles[i].l < lo) { lo = candles[i].l; loI = i; } }
  const range = { high: round(eq.high), low: round(eq.low) };
  const E = (at, price, label, pos) => ({ at, price: round(price), label, pos });
  let model = null, phase = 'Range', bias = 'range', events = [], trendline = null;

  if (!setup) {
    events = [E(hiI, hi, 'Tepe', 'top'), E(loI, lo, 'Dip', 'bottom')];
    return { model, phase, bias, range, events, trendline };
  }
  const long = setup.side === 'LONG';
  bias = long ? 'accumulation' : 'distribution';
  const isSweep = setup.model === 'Turtle Soup' || setup.model === 'PO3 / Range';
  model = isSweep ? (long ? 'SW-A' : 'SW-D') : (long ? 'RA' : 'MMC');

  if (!long) {
    // DISTRIBUTION
    let bc = null; winH.forEach(h => { if (!bc || h.price > bc.price) bc = h; });
    if (!bc) bc = { i: hiI, price: hi };
    const psy = winH.filter(h => h.i < bc.i).slice(-1)[0];                 // BC öncesi son tepe
    const ar = winL.filter(l => l.i > bc.i)[0];                            // BC sonrası ilk dip
    const utI = setup.sweepAt != null ? setup.sweepAt : null;             // UTAD = sweep
    const utP = utI != null ? (setup.sweepWick != null ? setup.sweepWick : candles[utI].h) : null;
    const utb = winH.filter(h => h.i > bc.i && (utI == null || h.i < utI) && h.price >= bc.price * 0.999).slice(-1)[0]; // ara upthrust
    if (psy) events.push(E(psy.i, psy.price, 'PSY', 'top'));
    events.push(E(bc.i, bc.price, 'BC', 'top'));
    if (ar) events.push(E(ar.i, ar.price, 'AR', 'bottom'));
    if (utb) events.push(E(utb.i, utb.price, 'UT-B', 'top'));
    if (utI != null) events.push(E(utI, utP, 'UTAD', 'top'));
    const bos = (ms && ms.events || []).filter(e => e.dir === 'down' && e.i > bc.i).slice(-1)[0];
    if (bos) events.push(E(bos.i, bos.price, 'BOS', 'bottom'));
    events.push(E(n - 1, last.c, 'LPSY', 'top'));
    phase = isSweep ? (utI != null ? 'UTAD → LPSY' : 'BC → LPSY') : 'MM Continuation';
    // diagonal: tepeleri birleştir (BC -> UTAD / son tepe)
    const end = utI != null ? { at: utI, price: utP } : (winH.slice(-1)[0] ? { at: winH.slice(-1)[0].i, price: winH.slice(-1)[0].price } : null);
    if (end && end.at > bc.i) trendline = { kind: 'dist', from: { at: bc.i, price: round(bc.price) }, to: { at: end.at, price: round(end.price) } };
  } else {
    // ACCUMULATION
    let sc = null; winL.forEach(l => { if (!sc || l.price < sc.price) sc = l; });
    if (!sc) sc = { i: loI, price: lo };
    const ps = winL.filter(l => l.i < sc.i).slice(-1)[0];                  // SC öncesi son dip
    const ar = winH.filter(h => h.i > sc.i)[0];                            // SC sonrası ilk tepe
    const spI = setup.sweepAt != null ? setup.sweepAt : null;             // Spring = sweep
    const spP = spI != null ? (setup.sweepWick != null ? setup.sweepWick : candles[spI].l) : null;
    const st = winL.filter(l => l.i > sc.i && (spI == null || l.i < spI) && l.price <= sc.price * 1.001).slice(-1)[0]; // ST
    if (ps) events.push(E(ps.i, ps.price, 'PS', 'bottom'));
    events.push(E(sc.i, sc.price, 'SC', 'bottom'));
    if (ar) events.push(E(ar.i, ar.price, 'AR', 'top'));
    if (st) events.push(E(st.i, st.price, 'ST', 'bottom'));
    if (spI != null) events.push(E(spI, spP, 'Spring', 'bottom'));
    const sos = (ms && ms.events || []).filter(e => e.dir === 'up' && e.i > sc.i).slice(-1)[0];
    if (sos) events.push(E(sos.i, sos.price, 'SOS', 'top'));
    events.push(E(n - 1, last.c, 'LPS', 'bottom'));
    phase = isSweep ? (spI != null ? 'Spring → LPS' : 'SC → LPS') : 'Re-Accumulation';
    // diagonal: dipleri birleştir (SC -> Spring / son dip)
    const end = spI != null ? { at: spI, price: spP } : (winL.slice(-1)[0] ? { at: winL.slice(-1)[0].i, price: winL.slice(-1)[0].price } : null);
    if (end && end.at > sc.i) trendline = { kind: 'acc', from: { at: sc.i, price: round(sc.price) }, to: { at: end.at, price: round(end.price) } };
  }
  // aynı muma düşen etiketleri ele (çakışma)
  const seen = new Set();
  events = events.filter(e => { if (seen.has(e.at)) return false; seen.add(e.at); return true; });
  return { model, phase, bias, range, events, trendline };
}

// ============================= @tradermiraz stili: klasik TA + harmonik + Fibonacci =============================

// EMA
function ema(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1); let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < closes.length; i++) { prev = closes[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

// "2-618" Fibonacci stratejisi: son impuls leg -> 0.618 reaksiyon zonu (giriş), uzantı hedefleri (1.272/1.618/2.618)
function fib2618(candles, sw) {
  const lastH = sw.highs[sw.highs.length - 1], lastL = sw.lows[sw.lows.length - 1];
  if (!lastH || !lastL) return null;
  let A, B, dir;
  if (lastH.i > lastL.i) { const s = sw.lows.filter(l => l.i < lastH.i).slice(-1)[0] || lastL; A = { i: s.i, price: s.price }; B = { i: lastH.i, price: lastH.price }; dir = 'up'; }
  else { const s = sw.highs.filter(h => h.i < lastL.i).slice(-1)[0] || lastH; A = { i: s.i, price: s.price }; B = { i: lastL.i, price: lastL.price }; dir = 'down'; }
  const range = B.price - A.price; if (!range) return null;
  const lvl = r => B.price - range * r;                 // B'den A'ya doğru geri çekilme
  const tgt = r => round(A.price + range * r);          // A->B leg ölçülü hareket uzantısı
  const levels = { '0': round(B.price), '0.382': round(lvl(0.382)), '0.5': round(lvl(0.5)), '0.618': round(lvl(0.618)), '0.786': round(lvl(0.786)), '1': round(A.price) };
  const targets = { '1.272': tgt(1.272), '1.618': tgt(1.618), '2.618': tgt(2.618) };
  const strategyZone = { top: round(Math.max(lvl(0.5), lvl(0.786))), bottom: round(Math.min(lvl(0.5), lvl(0.786))) };
  return { dir, A: { i: A.i, price: round(A.price) }, B: { i: B.i, price: round(B.price) }, levels, targets, strategyZone, entry: round(lvl(0.618)), invalid: round(A.price) };
}

// Formasyonlar: Çift Tepe/Dip, Üçgen, Yükselen/Düşen Kama
function chartPatterns(candles, sw) {
  const out = [], n = candles.length;
  const H = sw.highs, L = sw.lows;
  if (H.length >= 2) { const a = H[H.length - 2], b = H[H.length - 1]; if (b.i > a.i && Math.abs(a.price - b.price) / a.price < 0.013) out.push({ type: 'Çift Tepe', dir: 'bear', box: { from: a.i, to: b.i, top: Math.max(a.price, b.price) * 1.0015, bottom: Math.min(a.price, b.price) * 0.9985 } }); }
  if (L.length >= 2) { const a = L[L.length - 2], b = L[L.length - 1]; if (b.i > a.i && Math.abs(a.price - b.price) / a.price < 0.013) out.push({ type: 'Çift Dip', dir: 'bull', box: { from: a.i, to: b.i, top: Math.max(a.price, b.price) * 1.0015, bottom: Math.min(a.price, b.price) * 0.9985 } }); }
  if (H.length >= 3 && L.length >= 3) {
    const h = H.slice(-3), l = L.slice(-3);
    const hS = (h[2].price - h[0].price) / Math.max(1, h[2].i - h[0].i), lS = (l[2].price - l[0].price) / Math.max(1, l[2].i - l[0].i);
    const from = Math.min(h[0].i, l[0].i);
    if (hS < 0 && lS > 0) out.push({ type: 'Üçgen', dir: 'range', box: { from, to: n - 1, top: h[0].price, bottom: l[0].price } });
    else if (hS < 0 && lS < 0 && Math.abs(hS) > Math.abs(lS) * 1.2) out.push({ type: 'Düşen Kama', dir: 'bull', box: { from, to: n - 1, top: h[0].price, bottom: l[2].price } });
    else if (hS > 0 && lS > 0 && Math.abs(lS) > Math.abs(hS) * 1.2) out.push({ type: 'Yükselen Kama', dir: 'bear', box: { from, to: n - 1, top: h[2].price, bottom: l[0].price } });
  }
  return out.slice(0, 2);
}

// Harmonik XABCD (Bat, Gartley, Butterfly, Crab, Shark) + PRZ
function harmonics(candles, sw) {
  const pts = [...sw.highs.map(h => ({ i: h.i, p: h.price, t: 'H' })), ...sw.lows.map(l => ({ i: l.i, p: l.price, t: 'L' }))].sort((a, b) => a.i - b.i);
  const alt = [];
  for (const p of pts) { const last = alt[alt.length - 1]; if (!last || last.t !== p.t) alt.push(p); else if ((p.t === 'H' && p.p > last.p) || (p.t === 'L' && p.p < last.p)) alt[alt.length - 1] = p; }
  if (alt.length < 5) return null;
  const [X, A, B, C, D] = alt.slice(-5);
  const XA = A.p - X.p; if (!XA) return null;
  const rB = Math.abs((B.p - A.p) / XA), rC = Math.abs((C.p - B.p) / (B.p - A.p || 1)), rD = Math.abs((D.p - X.p) / XA);
  const near = (v, t, tol) => Math.abs(v - t) <= tol;
  let name = null;
  if (near(rB, 0.618, 0.06) && near(rD, 0.786, 0.07)) name = 'Gartley';
  else if (rB >= 0.34 && rB <= 0.55 && near(rD, 0.886, 0.07)) name = 'Bat';
  else if (near(rB, 0.786, 0.07) && rD >= 1.2 && rD <= 1.7) name = 'Butterfly';
  else if (rB >= 0.34 && rB <= 0.68 && near(rD, 1.618, 0.1)) name = 'Crab';
  else if (rD >= 0.84 && rD <= 1.15 && rC >= 1.1) name = 'Shark';
  if (!name) return null;
  const dir = D.t === 'L' ? 'bull' : 'bear';
  return { name, dir, points: { X: { i: X.i, price: round(X.p) }, A: { i: A.i, price: round(A.p) }, B: { i: B.i, price: round(B.p) }, C: { i: C.i, price: round(C.p) }, D: { i: D.i, price: round(D.p) } }, prz: { top: round(D.p * 1.004), bottom: round(D.p * 0.996) } };
}

// Miraz setup: öncelik harmonik PRZ'de fiyat -> harmonik; yoksa 2-618 fib planı
function buildMirazSetup(candles, ctx) {
  const { fib, harm, patterns, htfBias, rsiArr } = ctx;
  const price = candles[candles.length - 1].c, n = candles.length;
  const curRsi = rsiArr[rsiArr.length - 1];
  let cand = null;
  // 1) harmonik PRZ aktif mi?
  if (harm && price <= harm.prz.top * 1.01 && price >= harm.prz.bottom * 0.99) {
    const long = harm.dir === 'bull';
    cand = { model: 'Harmonik (' + harm.name + ')', side: long ? 'LONG' : 'SHORT', entry: harm.points.D.price, stop: long ? round(harm.prz.bottom * 0.99) : round(harm.prz.top * 1.01), originAt: harm.points.D.i, reasons: ['Harmonik ' + harm.name + ' ' + (long ? 'BULL' : 'BEAR'), 'Fiyat PRZ (Potansiyel Dönüş Bölgesi) içinde'] };
    // hedefler: XA'nın fib geri çekilmeleri (0.382/0.618 of AD)
    const A = harm.points.A.price, D = harm.points.D.price;
    cand.tps = [round(D + (A - D) * 0.382), round(D + (A - D) * 0.618), round(A)];
  } else if (fib) {
    const long = fib.dir === 'up';
    // geçersiz: fiyat impuls başını (A) tamamen geçtiyse
    if (long && price < fib.invalid) return null;
    if (!long && price > fib.invalid) return null;
    cand = { model: '2-618 Strateji', side: long ? 'LONG' : 'SHORT', entry: fib.entry, stop: long ? round(fib.levels['0.786'] * 0.997) : round(fib.levels['0.786'] * 1.003), originAt: fib.A.i, reasons: ['2-618 Fibonacci stratejisi (' + (long ? 'yükseliş' : 'düşüş') + ' legi)', 'Giriş: 0.618 geri çekilme reaksiyon zonu'] };
    cand.tps = [fib.targets['1.272'], fib.targets['1.618'], fib.targets['2.618']];
  }
  if (!cand) return null;
  // confluence
  let score = 2;
  if (patterns && patterns.length) { const p = patterns.find(x => (x.dir === 'bull' && cand.side === 'LONG') || (x.dir === 'bear' && cand.side === 'SHORT')); if (p) { cand.reasons.push('Formasyon: ' + p.type); score += 1.5; } }
  let htfAligned = null;
  if (htfBias === 'up') htfAligned = cand.side === 'LONG'; else if (htfBias === 'down') htfAligned = cand.side === 'SHORT';
  if (htfAligned === true) { cand.reasons.push('Üst vade trend uyumlu (' + htfBias + ')'); score += 2; }
  else if (htfAligned === false) { cand.reasons.push('⚠ Üst vade trend ters'); score -= 1.5; }
  if (curRsi != null) { if (cand.side === 'LONG' && curRsi < 45) { cand.reasons.push('RSI düşük (' + Math.round(curRsi) + ')'); score += 1; } if (cand.side === 'SHORT' && curRsi > 55) { cand.reasons.push('RSI yüksek (' + Math.round(curRsi) + ')'); score += 1; } }
  // entry status + risk/rr
  const tps = cand.tps.filter(t => cand.side === 'LONG' ? t > cand.entry : t < cand.entry);
  if (!tps.length) return null;
  let entryStatus = 'pending';
  const tol = cand.entry * 0.004;
  if (Math.abs(price - cand.entry) <= tol) entryStatus = 'active';
  else if (cand.side === 'LONG' && price <= cand.entry) entryStatus = 'active';
  else if (cand.side === 'SHORT' && price >= cand.entry) entryStatus = 'active';
  const risk = Math.abs(cand.entry - cand.stop); if (risk <= 0) return null;
  const rr = Math.min(Math.abs(tps[tps.length - 1] - cand.entry) / risk, 20);
  let grade = 'B'; if (score >= 5.5 && rr >= 2 && htfAligned !== false) grade = 'A+'; else if (score >= 4 && rr >= 1.6) grade = 'A';
  const confidence = Math.max(10, Math.min(99, Math.round(score / 8 * 60 + Math.min(rr, 5) / 5 * 40)));
  return { side: cand.side, model: cand.model, grade, confidence, entry: round(cand.entry), stop: round(cand.stop), tps: tps.map(t => round(t)), rr: Math.round(rr * 10) / 10, riskPct: round(risk / cand.entry * 100, 2), htfAligned, htfBias, originAt: cand.originAt, entryStatus, reasons: cand.reasons };
}

// ============================= Forever Model (FVG + OB + ERL + SMT + Bias) =============================

// SMT divergence: korele varlıkla (BTC<->ETH) son swing'lerde uyumsuzluk
function smtDivergence(candles, corr) {
  if (!corr || !corr.length) return null;
  const map = new Map(corr.map(c => [c.t, c]));
  const sw = swings(candles, 3);
  const h = sw.highs.slice(-2), l = sw.lows.slice(-2);
  if (h.length === 2) {
    const a = h[0], b = h[1], ca = map.get(candles[a.i].t), cb = map.get(candles[b.i].t);
    if (ca && cb && b.price > a.price && cb.h <= ca.h) return { type: 'bear', a: { i: a.i, price: round(a.price) }, b: { i: b.i, price: round(b.price) } };
  }
  if (l.length === 2) {
    const a = l[0], b = l[1], ca = map.get(candles[a.i].t), cb = map.get(candles[b.i].t);
    if (ca && cb && b.price < a.price && cb.l >= ca.l) return { type: 'bull', a: { i: a.i, price: round(a.price) }, b: { i: b.i, price: round(b.price) } };
  }
  return null;
}

// ERL (External Range Liquidity): büyük swing tepe/dipleri = dış likidite hedefleri
function externalLiquidity(candles) {
  const big = swings(candles, 4);
  const highs = big.highs.slice(-3).map(h => ({ type: 'high', price: round(h.price), at: h.i }));
  const lows = big.lows.slice(-3).map(l => ({ type: 'low', price: round(l.price), at: l.i }));
  return [...highs, ...lows];
}

// FVG'leri mitigation (fiyatın doldurması) durumuyla işaretle
function fvgState(candles, fvg) {
  return fvg.map(f => {
    let mit = false;
    for (let j = f.to + 1; j < candles.length; j++) { if (f.type === 'bull' && candles[j].l <= f.bottom) { mit = true; break; } if (f.type === 'bear' && candles[j].h >= f.top) { mit = true; break; } }
    return { type: f.type, top: round(f.top), bottom: round(f.bottom), from: f.from, to: f.to, mitigated: mit };
  });
}

// Forever Model setup: Giriş = OB (order block) · Stop = SMT invalidation noktası · Hedef = 2R
function buildForeverSetup(candles, ctx) {
  const { obList, smt, bias, rsiArr, corrTicker } = ctx;
  if (!smt) return null;                          // SMT divergence yoksa SETUP YOK
  const price = candles[candles.length - 1].c;
  const long = smt.type === 'bull';
  const dir = long ? 'LONG' : 'SHORT';
  const buf = 0.002;
  // STOP = SMT invalidation: divergence ekstremi (smt.b) kırılırsa SMT geçersiz
  const stop = long ? round(smt.b.price * (1 - buf)) : round(smt.b.price * (1 + buf));
  // GİRİŞ = yön yönündeki OB (order block), invalidation'ın doğru tarafında, fiyata en yakın
  const obDir = long ? 'bull' : 'bear';
  let ob = null, best = Infinity;
  for (const o of (obList || [])) {
    if (o.type !== obDir) continue;
    const mid = (o.top + o.bottom) / 2;
    if (long && mid <= stop) continue;            // long girişi stop'un üstünde olmalı
    if (!long && mid >= stop) continue;           // short girişi stop'un altında olmalı
    const d = Math.abs(mid - price) / price;
    if (d < best) { best = d; ob = o; }
  }
  if (!ob) return null;
  const entry = round((ob.top + ob.bottom) / 2);  // OB ortası
  const risk = Math.abs(entry - stop); if (risk <= 0) return null;
  const tp = round(long ? entry + 2 * risk : entry - 2 * risk);   // HEDEF = 2R
  const rr = 2;
  let entryStatus = 'pending';
  if ((long && price <= entry * 1.002) || (!long && price >= entry * 0.998)) entryStatus = 'active';
  let score = 4; const reasons = ['SMT divergence (' + (corrTicker || '') + ') — ' + (long ? 'boğa' : 'ayı'), 'Giriş: ' + (long ? '+OB' : '-OB') + ' (order block)', 'Stop: SMT invalidation', 'Hedef: 2R'];
  if (bias !== 'Neutral' && (bias === 'Bullish') === long) { reasons.push('Bias uyumlu (' + bias + ')'); score += 1; }
  const curRsi = rsiArr[rsiArr.length - 1];
  if (curRsi != null) { if (long && curRsi < 45) { reasons.push('RSI ' + Math.round(curRsi)); score += 1; } if (!long && curRsi > 55) { reasons.push('RSI ' + Math.round(curRsi)); score += 1; } }
  let grade = 'B'; if (score >= 6) grade = 'A+'; else if (score >= 5) grade = 'A';
  const confidence = Math.max(10, Math.min(99, Math.round(score / 7 * 70 + 20)));
  return { side: dir, model: 'OB+SMT', grade, confidence, entry, stop, tps: [tp], rr, riskPct: round(risk / entry * 100, 2), htfBias: bias, htfAligned: null, originAt: ob.at != null ? ob.at : ob.from, entryStatus, reasons };
}

// ----------------------------- Miraz çizim katmanı (zonlar, formasyon, kanal, projeksiyon hedefleri) -----------------------------
function mirazDraw(candles, sw, bias) {
  const n = candles.length, price = candles[n - 1].c;
  function cluster(pts) {
    const s = [...pts].sort((a, b) => a.price - b.price), out = [];
    for (const p of s) { const last = out[out.length - 1]; if (last && Math.abs(p.price - last.mid) / last.mid < 0.013) { last.lo = Math.min(last.lo, p.price); last.hi = Math.max(last.hi, p.price); last.mid = (last.lo + last.hi) / 2; last.from = Math.min(last.from, p.i); last.n++; } else out.push({ lo: p.price, hi: p.price, mid: p.price, from: p.i, n: 1 }); }
    return out;
  }
  const highs = cluster(sw.highs), lows = cluster(sw.lows);
  const resC = highs.filter(c => c.mid > price).sort((a, b) => a.mid - b.mid)[0];
  const supC = lows.filter(c => c.mid < price).sort((a, b) => b.mid - a.mid)[0];
  const resZone = resC ? { top: round(resC.hi * 1.002), bottom: round(resC.lo * 0.998), from: resC.from } : null;
  const supZone = supC ? { top: round(supC.hi * 1.002), bottom: round(supC.lo * 0.998), from: supC.from } : null;
  // trend çizgisi (çapraz): yukarı trend -> son 2 dip; aşağı -> son 2 tepe
  let trend = null;
  const up = bias === 'Bullish';
  const pivs = up ? sw.lows.slice(-2) : sw.highs.slice(-2);
  if (pivs.length === 2 && pivs[1].i > pivs[0].i) trend = { a: { i: pivs[0].i, price: round(pivs[0].price) }, b: { i: pivs[1].i, price: round(pivs[1].price) } };
  // projeksiyon hedefleri (bias yönünde sonraki 2 seviye, ok ile)
  let targets = [];
  if (bias === 'Bearish') targets = lows.filter(c => c.mid < price).sort((a, b) => b.mid - a.mid).slice(0, 2).map((c, i) => ({ price: round(c.mid), dir: 'down', color: i === 0 ? 'red' : 'purple' }));
  else if (bias === 'Bullish') targets = highs.filter(c => c.mid > price).sort((a, b) => a.mid - b.mid).slice(0, 2).map((c, i) => ({ price: round(c.mid), dir: 'up', color: i === 0 ? 'green' : 'purple' }));
  // formasyon: önce kutu (Çift Tepe/Dip vb.), sonra kavis (Çanak/Ters Çanak)
  const pats = chartPatterns(candles, sw);
  let formation = pats[0] ? { type: pats[0].type, dir: pats[0].dir, box: pats[0].box } : null;
  let arc = null;
  const W = Math.min(48, n), base = n - W; let hi = -Infinity, lo = Infinity, hiI = base, loI = base;
  for (let i = base; i < n; i++) { if (candles[i].h > hi) { hi = candles[i].h; hiI = i; } if (candles[i].l < lo) { lo = candles[i].l; loI = i; } }
  const ctr = base + W / 2, tol = W * 0.32;
  if (!formation && Math.abs(hiI - ctr) < tol && candles[base].h < hi * 0.985 && price < hi * 0.985)
    arc = { type: 'Ters Çanak', dir: 'bear', from: base, peakAt: hiI, peak: round(hi), rim: round(Math.max(candles[base].h, price)) };
  else if (!formation && Math.abs(loI - ctr) < tol && candles[base].l > lo * 1.015 && price > lo * 1.015)
    arc = { type: 'Çanak', dir: 'bull', from: base, peakAt: loI, peak: round(lo), rim: round(Math.min(candles[base].l, price)) };
  const neckline = bias === 'Bearish' ? (supZone ? supZone.bottom : null) : (resZone ? resZone.top : null);
  return { supportZone: supZone, resistanceZone: resZone, trend, targets, formation, arc, neckline };
}

// ----------------------------- Miraz üslubunda otomatik yorum -----------------------------
function mirazComment(candles, ctx) {
  const { bias, rsiNow, interval, base } = ctx;
  const price = candles[candles.length - 1].c;
  const sw = swings(candles, 3);
  const f = v => v >= 1 ? (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)) : v.toFixed(v >= 0.01 ? 4 : 6);
  const res = [...new Set(sw.highs.map(h => h.price))].filter(p => p > price).sort((a, b) => a - b).slice(0, 3);
  const sup = [...new Set(sw.lows.map(l => l.price))].filter(p => p < price).sort((a, b) => b - a).slice(0, 3);
  const ltf = marketStructure(candles, sw).trend;
  const trTxt = t => t === 'up' ? 'yukarı yönlü' : t === 'down' ? 'aşağı yönlü' : 'yatay';
  const ivName = { '1m': '1 dakikalık', '5m': '5 dakikalık', '15m': '15 dakikalık', '30m': '30 dakikalık', '60m': 'saatlik', '4h': '4 saatlik', '1d': 'günlük' }[interval] || interval;
  const keyRes = res[res.length - 1];
  const L = [];
  L.push((base || 'Fiyat') + ' | ' + ivName.charAt(0).toUpperCase() + ivName.slice(1) + ' Analiz 📊');
  L.push('Fiyat şu an ' + f(price) + '$. Kısa vadede yapı ' + trTxt(ltf) + ', üst vadede ' + (bias === 'Bullish' ? 'boğa' : bias === 'Bearish' ? 'ayı' : 'nötr') + ' görünüm hâkim.');
  if (keyRes) L.push('Kalıcı bir dönüşten söz edebilmek için ' + f(keyRes) + '$ üzerinde net bir kapanış görmemiz gerekiyor; bu olmadan gelen yükselişler tepki alımından öteye geçmez.');
  if (res.length >= 2 && sup.length >= 1) L.push('🔹 İyimser: ' + f(sup[0]) + '$ korunur, ' + f(res[0]) + '$ – ' + f(res[1]) + '$ kırılır → ' + f(res[res.length - 1]) + '$ test edilir.');
  if (sup.length >= 2) L.push('🔹 Zayıf: ' + f(sup[0]) + '$ altı kapanış → ' + f(sup[1]) + '$' + (sup[2] ? ' – ' + f(sup[2]) + '$' : '') + ' bölgesi gündeme gelir.');
  const down = bias === 'Bearish' || ltf === 'down';
  L.push(down
    ? '📌 Bana daha yakın gelen senaryo: önce ' + f(sup[0] || price) + '$ desteğinin test edilmesi; ' + (keyRes ? f(keyRes) + '$ aşılmadan ' : '') + 'orta vadede aşağı yönlü beklentimi koruyorum.'
    : '📌 Bana daha yakın gelen senaryo: ' + f(sup[0] || price) + '$ korundukça yukarı tepkilerin sürmesi; teyit için ' + (keyRes ? f(keyRes) + '$ kapanışı' : 'direnç kırılımı') + ' bekliyorum.');
  const r = rsiNow;
  L.push('RSI ' + (r != null ? r : '-') + ' — ' + (r == null ? '' : (r < 35 ? 'aşırı satım bölgesine yakın, tepki gelebilir' : r > 65 ? 'aşırı alım bölgesinde, dikkatli olun' : 'ne aşırı alım ne aşırı satım; yön seviyelere bağlı')) + '. Yatırımınızla inatlaşmayın, dikkatli olunuz.');
  return L.join('\n');
}

// ============================= @kirsanovtrade stili: Elliott Wave + Fib golden zone + Liquidity =============================

// EW tek derece tespiti (verilen swing kümesinden): 5-dalga impulse ya da ABC; etiketler dışarıdan
function ewDetect(sw, labImpulse, labAbc) {
  const pts = [...sw.highs.map(h => ({ i: h.i, p: h.price, t: 'H' })), ...sw.lows.map(l => ({ i: l.i, p: l.price, t: 'L' }))].sort((a, b) => a.i - b.i);
  const alt = [];
  for (const p of pts) { const last = alt[alt.length - 1]; if (!last || last.t !== p.t) alt.push(p); else if ((p.t === 'H' && p.p > last.p) || (p.t === 'L' && p.p < last.p)) alt[alt.length - 1] = p; }
  if (alt.length < 4) return null;
  const s6 = alt.slice(-6);
  if (s6.length === 6) {
    const [p0, p1, p2, p3, p4, p5] = s6;
    const bull = p0.t === 'L' && p1.t === 'H' && p2.t === 'L' && p3.t === 'H' && p4.t === 'L' && p5.t === 'H';
    const bear = p0.t === 'H' && p1.t === 'L' && p2.t === 'H' && p3.t === 'L' && p4.t === 'H' && p5.t === 'L';
    if (bull || bear) {
      const w1 = Math.abs(p1.p - p0.p), w3 = Math.abs(p3.p - p2.p), w5 = Math.abs(p5.p - p4.p);
      const ok = !(w3 < w1 && w3 < w5) && (bull ? (p2.p > p0.p && p4.p > p1.p) : (p2.p < p0.p && p4.p < p1.p));
      if (ok) return {
        dir: bull ? 'up' : 'down', type: 'impulse', start: { at: p0.i, price: round(p0.p) },
        points: [p1, p2, p3, p4, p5].map((p, i) => ({ label: labImpulse[i], at: p.i, price: round(p.p) })),
        measured: { from: { at: p4.i, price: round(p4.p) }, price: round(bull ? p4.p + w1 : p4.p - w1) }
      };
    }
  }
  const s4 = alt.slice(-4);
  if (s4.length === 4) {
    const [p0, a, b, c] = s4; const A = Math.abs(a.p - p0.p);
    return {
      dir: a.t === 'L' ? 'down' : 'up', type: 'abc', start: { at: p0.i, price: round(p0.p) },
      points: [a, b, c].map((p, i) => ({ label: labAbc[i], at: p.i, price: round(p.p) })),
      measured: { from: { at: b.i, price: round(b.p) }, price: round(a.t === 'L' ? b.p - A : b.p + A) }
    };
  }
  return null;
}
// Çok dereceli Elliott Wave: büyük derece (i)-(v) (k=5) + küçük derece (1)-(5) (k=2)
function elliottWave(candles) {
  const major = ewDetect(swings(candles, 5), ['(i)', '(ii)', '(iii)', '(iv)', '(v)'], ['(A)', '(B)', '(C)']);
  const minor = ewDetect(swings(candles, 2), ['1', '2', '3', '4', '5'], ['a', 'b', 'c']);
  if (!major && !minor) return null;
  const primary = major || minor;
  return { major, minor, dir: primary.dir, type: primary.type, start: primary.start, points: primary.points, measured: primary.measured };
}

// RSI divergence: fiyat HH ama RSI LH -> bear; fiyat LL ama RSI HL -> bull
function rsiDivergence(rsiArr, sw) {
  const h = sw.highs.slice(-2), l = sw.lows.slice(-2);
  if (h.length === 2) { const ra = rsiArr[h[0].i], rb = rsiArr[h[1].i]; if (ra != null && rb != null && h[1].price > h[0].price && rb < ra - 1) return { type: 'bear', a: { at: h[0].i, price: round(h[0].price), rsi: Math.round(ra) }, b: { at: h[1].i, price: round(h[1].price), rsi: Math.round(rb) } }; }
  if (l.length === 2) { const ra = rsiArr[l[0].i], rb = rsiArr[l[1].i]; if (ra != null && rb != null && l[1].price < l[0].price && rb > ra + 1) return { type: 'bull', a: { at: l[0].i, price: round(l[0].price), rsi: Math.round(ra) }, b: { at: l[1].i, price: round(l[1].price), rsi: Math.round(rb) } }; }
  return null;
}

// Projeksiyon yolu: şu an -> küçük tepki -> hedef (golden zone/ölçülü hareket). rel = mum sonrası ofset
function projection(candles, fib, ew) {
  const price = candles[candles.length - 1].c, n = candles.length;
  let target = ew && ew.measured ? ew.measured.price : (fib ? fib.targets['1.272'] : null);
  if (!target || !isFinite(target)) return null;
  const down = target < price;
  const bounce = round(price + (target - price) * -0.28);
  return { dir: down ? 'down' : 'up', target: round(target), points: [{ rel: 0, price: round(price) }, { rel: 7, price: bounce }, { rel: 20, price: round(target) }] };
}

// Supply / Demand zonları (en yakın tepe/dip kümesi)
function supplyDemand(candles, sw) {
  const price = candles[candles.length - 1].c;
  function near(points, above) {
    const cand = points.filter(p => above ? p.price > price : p.price < price);
    if (!cand.length) return null;
    const pick = above ? cand.reduce((m, p) => p.price < m.price ? p : m) : cand.reduce((m, p) => p.price > m.price ? p : m);
    const tol = pick.price * 0.012;
    const grp = points.filter(p => Math.abs(p.price - pick.price) <= tol);
    return { top: round(Math.max(...grp.map(g => g.price)) * 1.002), bottom: round(Math.min(...grp.map(g => g.price)) * 0.998), from: Math.min(...grp.map(g => g.i)) };
  }
  return { supply: near(sw.highs, true), demand: near(sw.lows, false) };
}

// Kirsanov setup: golden zone (0.618) girişi · stop 0.786 ötesi · HEDEF 1R/2R (backtest en iyi beklenti)
//   SEÇİCİLİK: EW yönü ZORUNLU + SMT/üst-vade/RSI confluence (en az 2 teyit) -> winrate artar.
function buildKirsanovSetup(candles, ctx) {
  const { fib, ew, rsiArr, smt, bias, corrTicker } = ctx;
  if (!fib) return null;
  const price = candles[candles.length - 1].c;
  const long = fib.dir === 'up';
  if (long && price < fib.invalid) return null;
  if (!long && price > fib.invalid) return null;
  if (ew && ew.dir !== fib.dir) return null;            // EW YÖNÜ filtresi: işlem dalga yönünde olmalı
  const entry = fib.entry;
  const stop = long ? round(fib.levels['0.786'] * 0.996) : round(fib.levels['0.786'] * 1.004);
  const risk = Math.abs(entry - stop); if (risk <= 0) return null;
  const tps = long ? [round(entry + risk), round(entry + 2 * risk)] : [round(entry - risk), round(entry - 2 * risk)]; // 1R + 2R
  // CONFLUENCE
  let conf = 0; const reasons = ['Golden zone girişi (0.618), stop 0.786'];
  if (ew) { conf++; reasons.push('EW yönü uyumlu: ' + (ew.type === 'impulse' ? '5-dalga' : 'ABC') + ' (' + (long ? 'yükseliş' : 'düşüş') + ')'); }
  const smtOk = smt && ((smt.type === 'bull') === long);
  if (smtOk) { conf++; reasons.push('SMT divergence (' + (corrTicker || '') + ') uyumlu'); }
  const biasOk = bias !== 'Neutral' && (bias === 'Bullish') === long;
  if (biasOk) { conf++; reasons.push('Üst vade trend uyumlu (' + bias + ')'); }
  const curRsi = rsiArr[rsiArr.length - 1];
  const rsiOk = curRsi != null && (long ? curRsi < 45 : curRsi > 55);
  if (rsiOk) { conf++; reasons.push('RSI ' + Math.round(curRsi)); }
  if (conf < 2) return null;                            // en az 2 confluence (EW + 1) — seçicilik
  reasons.push('Hedef: 1R / 2R');
  // STOP/TP olmuş setupları ele
  const tFinal = tps[tps.length - 1];
  let entryIdx = -1;
  for (let i = fib.B.i; i < candles.length; i++) { const k = candles[i]; if (long ? k.l <= entry : k.h >= entry) { entryIdx = i; break; } }
  if (entryIdx >= 0) for (let i = entryIdx; i < candles.length; i++) { const k = candles[i]; if (long ? (k.l <= stop || k.h >= tFinal) : (k.h >= stop || k.l <= tFinal)) return null; }
  const entryStatus = entryIdx >= 0 ? 'active' : 'pending';
  const rr = Math.round(Math.abs(tFinal - entry) / risk * 10) / 10;
  let grade = 'B'; if (conf >= 4) grade = 'A+'; else if (conf >= 3) grade = 'A';
  const confidence = Math.max(20, Math.min(99, Math.round(conf / 4 * 80 + 15)));
  return { side: long ? 'LONG' : 'SHORT', model: ew ? (ew.type === 'impulse' ? 'EW Impulse' : 'EW ABC') : 'Golden Zone', grade, confidence, entry: round(entry), stop, tps, rr, riskPct: round(risk / entry * 100, 2), htfBias: bias, htfAligned: biasOk, conf, originAt: fib.A.i, entryStatus, reasons };
}

// Kirsanov üslubunda yorum
function kirsanovComment(candles, ctx) {
  const { ew, fib, sd, bias, rsiNow, base, rsiDiv } = ctx;
  const price = candles[candles.length - 1].c;
  const f = v => v >= 1 ? (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)) : v.toFixed(v >= 0.01 ? 4 : 6);
  const L = [];
  L.push((base || 'Asset') + ' | Elliott Wave 🧠');
  if (rsiDiv) L.push('🔸 RSI ' + (rsiDiv.type === 'bear' ? 'AYI uyumsuzluğu (fiyat yükseldi, RSI yükselmedi → zayıflık)' : 'BOĞA uyumsuzluğu (fiyat düştü, RSI düşmedi → güç)') + ' [' + rsiDiv.a.rsi + '→' + rsiDiv.b.rsi + '].');
  if (ew) L.push('Yapı ' + (ew.type === 'impulse' ? '5 dalgalık impulse' : 'ABC düzeltme') + ' (' + (ew.dir === 'up' ? 'yükseliş' : 'düşüş') + '); şu an ' + ew.points[ew.points.length - 1].label + ' civarı. Fiyat ' + f(price) + '$.');
  else L.push('Net dalga yapısı oluşmadı; fiyat ' + f(price) + '$, üst vade ' + (bias === 'Bullish' ? 'boğa' : bias === 'Bearish' ? 'ayı' : 'nötr') + '.');
  if (fib) L.push('Golden zone (0.618–0.786): ' + f(Math.min(fib.strategyZone.top, fib.strategyZone.bottom)) + '$ – ' + f(Math.max(fib.strategyZone.top, fib.strategyZone.bottom)) + '$. Bu bölgeden ' + (fib.dir === 'up' ? 'tepki/long' : 'reddetme/short') + ' beklentisi.');
  if (ew && ew.measured) L.push('🔹 Dalga eşitliği (100%) ölçülü hareket hedefi: ' + f(ew.measured.price) + '$.');
  if (sd && sd.supply) L.push('🔹 Üstte arz (supply): ' + f(sd.supply.bottom) + '$ – ' + f(sd.supply.top) + '$ (likidite/0.786 sweep bölgesi).');
  if (sd && sd.demand) L.push('🔹 Altta talep (demand): ' + f(sd.demand.bottom) + '$ – ' + f(sd.demand.top) + '$.');
  if (fib) L.push('📌 Invalidation: ' + f(fib.invalid) + '$ (' + (fib.dir === 'up' ? 'altı' : 'üstü') + ' kapanış senaryoyu bozar). RSI ' + (rsiNow != null ? rsiNow : '-') + '.');
  return L.join('\n');
}

// ============================= @jaxiwnl21 (DREYKO) stili: ICT + Open Interest (Larry Williams) =============================

// Classic Range Manipulation (DREYKO): ÖNCEKİ konsolidasyon range'inin LOW/HIGH'ını süpürüp GERİ ALMA (reclaim).
//  Range = sweep ÖNCESİ pencere (manipülasyon wick'i dahil DEĞİL). Sweep + reclaim -> Smart Money Reversal (MMBM/MMSM).
function manipulation(candles) {
  const n = candles.length, look = 10, rangeLen = 30;
  const barMs = n > 1 ? candles[1].t - candles[0].t : 0;
  const maxW = barMs >= 20 * 3600000 ? 0.30 : 0.12;             // günlükte 30 mumluk konsolidasyon doğal olarak daha geniş
  let best = null;
  for (let i = Math.max(rangeLen, n - look); i < n; i++) {
    const seg = candles.slice(i - rangeLen, i);                 // sweep öncesi konsolidasyon
    let rHigh = -Infinity, rLow = Infinity;
    for (const c of seg) { if (c.h > rHigh) rHigh = c.h; if (c.l < rLow) rLow = c.l; }
    const width = (rHigh - rLow) / rLow;
    if (width > maxW || width < 0.004) continue;                // makul range/konsolidasyon
    const c = candles[i];
    // BUY: prior range LOW altına sweep + reclaim (bu ya da sonraki ~3 mumda LOW üstüne kapanış)
    if (c.l < rLow && (rLow - c.l) / rLow >= 0.001) {
      let at = -1; for (let j = i; j < Math.min(n, i + 4); j++) if (candles[j].c > rLow) { at = j; break; }
      if (at >= 0) best = { side: 'LONG', at, sweepAt: i, rangeFrom: i - rangeLen, rangeTo: i - 1, wick: round(c.l), level: round(rLow), rangeHigh: round(rHigh), rangeLow: round(rLow), box: { top: round(rLow), bottom: round(c.l) } };
    }
    // SELL: prior range HIGH üstüne sweep + reclaim
    if (c.h > rHigh && (c.h - rHigh) / rHigh >= 0.001) {
      let at = -1; for (let j = i; j < Math.min(n, i + 4); j++) if (candles[j].c < rHigh) { at = j; break; }
      if (at >= 0) best = { side: 'SHORT', at, sweepAt: i, rangeFrom: i - rangeLen, rangeTo: i - 1, wick: round(c.h), level: round(rHigh), rangeHigh: round(rHigh), rangeLow: round(rLow), box: { top: round(c.h), bottom: round(rHigh) } };
    }
  }
  return best;
}

// IPDA seviyeleri (ICT): 20/40/60 lookback high/low
function ipdaLevels(candles) {
  const out = [];
  [20, 40, 60].forEach(nn => { const seg = candles.slice(-nn); if (seg.length < Math.min(nn, 15)) return; out.push({ n: nn, high: round(Math.max(...seg.map(c => c.h))), low: round(Math.min(...seg.map(c => c.l))) }); });
  return out;
}

// Open Interest analizi: son belirgin OI düşüşü ("BIG OI drop" = program değişimi)
function oiState(oi) {
  if (!oi || oi.length < 10) return null;
  const vals = oi.map(o => o.oi);
  const recent = vals.slice(-20), mx = Math.max(...recent), last = vals[vals.length - 1];
  const dropPct = mx > 0 ? (mx - last) / mx * 100 : 0;
  return { last: round(last), maxRecent: round(mx), dropPct: Math.round(dropPct * 10) / 10, bigDrop: dropPct >= 8 };
}

// ----- yigit (SMC) katmanı — Telegram kulübü (996 mesaj / 209 grafik) çekirdek kuralları:
// FVG'nin EQ'su (CE) kazanılmadan işlem yok · hedef likiditesi zaten alınmışsa kovalama ·
// giriş = kazanılan FVG'nin retesti · HTF bias dönmeden ters işlem yok · risk %1 = 1R.
function fvgEqDurumu(candles, fvgList, side) {
  const last = candles[candles.length - 1].c;
  const want = side === 'LONG' ? 'bull' : 'bear';
  let best = null;
  for (const f of fvgList) {
    if (f.type !== want) continue;
    const d = Math.abs(last - f.mid) / last;
    if (!best || d < best.d) best = { f, d };
  }
  if (!best) return null;
  const f = best.f;
  const won = side === 'LONG' ? last > f.mid : last < f.mid;   // EQ (CE) model yönünde kazanılmış mı
  return { top: round(f.top), bottom: round(f.bottom), ce: round(f.mid), won, from: f.from };
}

// ----- SolCJ (Wyckoff+ICT) katmanı — solcj/STYLE.md (286 tweet / 202 grafik):
// Volume Profile (POC/VAH/VAL) confluence · iFVG (geçersizleşen FVG ters POI olur) · Wyckoff olay dili (Spring/UTAD/SOS/SOW).
function volumeProfile(candles, bins) {
  const seg = candles.slice(-120);
  let lo = Infinity, hi = -Infinity;
  for (const c of seg) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
  if (!(hi > lo) || seg.length < 30) return null;
  const B = bins || 24, w = (hi - lo) / B, vol = new Array(B).fill(0);
  for (const c of seg) { const tp = (c.h + c.l + c.c) / 3; const bi = Math.min(B - 1, Math.max(0, Math.floor((tp - lo) / w))); vol[bi] += c.v || 0; }
  let poc = 0; for (let i = 1; i < B; i++) if (vol[i] > vol[poc]) poc = i;
  const total = vol.reduce((a, b) => a + b, 0);
  let acc = vol[poc], up = poc, dn = poc;
  while (acc < total * 0.7 && (up < B - 1 || dn > 0)) {           // %70 Value Area
    const vu = up < B - 1 ? vol[up + 1] : -1, vd = dn > 0 ? vol[dn - 1] : -1;
    if (vu >= vd) { up++; acc += vu; } else { dn--; acc += vd; }
  }
  const mid = i => lo + w * (i + 0.5);
  return { poc: round(mid(poc)), vah: round(lo + w * (up + 1)), val: round(lo + w * dn), lo: round(lo), hi: round(hi), bins: vol.map((v, i) => ({ p: round(mid(i)), v: Math.round(v) })) };
}

function invertedFvgs(candles, fvgList) {
  const out = [];
  for (const f of fvgList) {
    for (let i = f.to + 1; i < candles.length; i++) {
      const c = candles[i];
      if (f.type === 'bull' && c.c < f.bottom) { out.push({ type: 'bear', top: round(f.top), bottom: round(f.bottom), mid: round(f.mid), from: i }); break; }  // destek -> direnç
      if (f.type === 'bear' && c.c > f.top) { out.push({ type: 'bull', top: round(f.top), bottom: round(f.bottom), mid: round(f.mid), from: i }); break; }     // direnç -> destek
    }
  }
  return out.slice(-3);
}

// ----- JB (Boybrandcoin/JBTradesx) katmanı — boybrand/ arşivi (235 tweet/135 grafik):
// Wyckoff M1/M2 + "2xHOB backed by fib": giriş HOB (gizli OB) bandında ve bacağın 0.618–0.786 (OTE) düzeltmesinde olmalı;
// yönetim: TP1'de derisk (%25-50), runner Trail SL ile.
function oteZone(candles, manip) {
  if (!manip) return null;
  const long = manip.side === 'LONG';
  const end = Math.min(candles.length - 1, manip.at + 10);
  let ext = long ? -Infinity : Infinity;
  for (let i = manip.at; i <= end; i++) { if (long) { if (candles[i].h > ext) ext = candles[i].h; } else { if (candles[i].l < ext) ext = candles[i].l; } }
  if (!isFinite(ext)) return null;
  const leg = Math.abs(ext - manip.wick); if (leg <= 0) return null;
  const a = long ? ext - leg * 0.618 : ext + leg * 0.618;
  const b = long ? ext - leg * 0.786 : ext + leg * 0.786;
  return { top: round(Math.max(a, b)), bottom: round(Math.min(a, b)), ext: round(ext), side: manip.side };
}

// SolCJ Wyckoff olay etiketleri — pivot mumlara yazılır (SW1-D: BC→AR→UT-B→UTAD→Test · SW1-A: SC→AR→ST→Spring→Test)
function wyckoffEvents(candles, manip) {
  if (!manip || manip.rangeFrom == null || manip.rangeTo == null) return null;
  const from = Math.max(0, manip.rangeFrom), to = manip.rangeTo, long = manip.side === 'LONG';
  if (to <= from + 4) return null;
  const ev = [];
  const hi = (a, b) => { let k = a; for (let i = a; i <= b; i++) if (candles[i].h > candles[k].h) k = i; return k; };
  const lo = (a, b) => { let k = a; for (let i = a; i <= b; i++) if (candles[i].l < candles[k].l) k = i; return k; };
  const early = from + Math.max(3, Math.floor((to - from) * 0.6));   // BC/SC range'in ERKEN bölümünde aranır (CJ şeması)
  if (long) {
    const sc = lo(from, early); ev.push({ i: sc, label: 'SC', pos: 'bottom' });
    if (sc < to - 1) {
      const arWin = Math.min(to, sc + Math.max(3, Math.floor((to - from) * 0.4)));   // AR = klimaks SONRASI İLK büyük tepki (erken pencere; Faz B çökmesin)
      const ar = hi(sc + 1, arWin); ev.push({ i: ar, label: 'AR', pos: 'top' });
      // ST: SC seviyesinin testi; SC'nin ALTINA sarktıysa ST-B (CJ adlandırması)
      if (ar < to - 1) { const st = lo(ar + 1, to); if (st !== sc) ev.push({ i: st, label: candles[st].l < candles[sc].l ? 'ST-B' : 'ST', pos: 'bottom' }); }
    }
    ev.push({ i: manip.sweepAt, label: 'Spring', pos: 'bottom', key: true });
    if (manip.at !== manip.sweepAt) ev.push({ i: manip.at, label: 'Test', pos: 'bottom' });
    // LPS: reclaim sonrası range kenarına (level) geri test (CJ: son destek noktası)
    for (let i = manip.at + 2; i < candles.length; i++) { if (Math.abs(candles[i].l - manip.level) / manip.level <= 0.004 && candles[i].c > manip.level) { ev.push({ i, label: 'LPS', pos: 'bottom' }); break; } }
  } else {
    const bc = hi(from, early); ev.push({ i: bc, label: 'BC', pos: 'top' });
    if (bc < to - 1) {
      const arWin = Math.min(to, bc + Math.max(3, Math.floor((to - from) * 0.4)));   // AR = klimaks SONRASI İLK büyük tepki (erken pencere; Faz B çökmesin)
      const ar = lo(bc + 1, arWin); ev.push({ i: ar, label: 'AR', pos: 'bottom' });
      // BC'nin ÜSTÜNE çıktıysa UT-B, çıkamadıysa sadece ST (Secondary Test)
      if (ar < to - 1) { const ut = hi(ar + 1, to); if (ut !== bc && ut > ar) ev.push({ i: ut, label: candles[ut].h > candles[bc].h ? 'UT-B' : 'ST', pos: 'top' }); }
    }
    ev.push({ i: manip.sweepAt, label: 'UTAD', pos: 'top', key: true });
    if (manip.at !== manip.sweepAt) ev.push({ i: manip.at, label: 'Test', pos: 'top' });
    // LPSY: reclaim sonrası range kenarına (level) geri test (CJ: son arz noktası — giriş bölgesi)
    for (let i = manip.at + 2; i < candles.length; i++) { if (Math.abs(candles[i].h - manip.level) / manip.level <= 0.004 && candles[i].c < manip.level) { ev.push({ i, label: 'LPSY', pos: 'top' }); break; } }
  }
  // ---- Wyckoff TR eklentileri (TradingView 'Wyckoff Trading Range' esinli) ----
  // Faz ayırıcıları: A (durdurma: BC/SC+AR) · B (cause inşası) · C (Spring/UTAD+Test) · D (teyit/LPS-LPSY) · E (range dışı trend)
  const arEv = ev.find(e => e.label === 'AR');
  const phases = [];
  const aEnd = arEv ? arEv.i : from + Math.max(2, Math.floor((to - from) * 0.25));
  phases.push({ label: 'A', from, to: aEnd });
  phases.push({ label: 'B', from: aEnd + 1, to: Math.max(aEnd + 1, manip.sweepAt - 1) });
  phases.push({ label: 'C', from: manip.sweepAt, to: manip.at });
  let eStart = -1;
  for (let i = manip.at + 1; i < candles.length; i++) { if (long ? candles[i].c > manip.rangeHigh : candles[i].c < manip.rangeLow) { eStart = i; break; } }
  phases.push({ label: 'D', from: manip.at + 1, to: eStart > 0 ? eStart - 1 : candles.length - 1 });
  if (eStart > 0) phases.push({ label: 'E', from: eStart, to: candles.length - 1 });
  // PNF hedef sayımı (Wyckoff cause->effect): cause = range genişliği × süre çarpanı; hedefler DAIMA range dışında
  const width = manip.rangeHigh - manip.rangeLow;
  const causeK = Math.min(2, Math.max(1, (to - from + 1) / 20));   // uzun range -> büyük etki (tavan 2×)
  const base = long ? manip.rangeHigh : manip.rangeLow;
  const pnf = { base: round(base), side: manip.side, targets: [1, 2, 3].map(k => round(long ? base + width * k * causeK : base - width * k * causeK)) };
  // yelpaze (BC/SC -> sweep) + kavis (AR -> sweep) için referans indeksler
  return { side: manip.side, events: ev, phases, pnf, fanFrom: ev[0].i, fanTo: manip.sweepAt, arcFrom: (ev[1] && ev[1].i) || ev[0].i };
}

// DREYKO setup: Manipulation (likidite avı) sonrası dönüş · stop sweep ötesi · hedef karşı range/IPDA · OI/bias confluence
function buildDreykoSetup(candles, ctx) {
  const { manip, eq, ipda, bias, rsiArr, oi, fvgList, liq, vp, ifvg, ote, hob } = ctx;
  if (!manip || !eq) return null;
  const price = candles[candles.length - 1].c, long = manip.side === 'LONG';
  const entry = manip.level;                                    // geri alınan range kenarı
  const stop = long ? round(manip.wick * 0.997) : round(manip.wick * 1.003);
  const risk = Math.abs(entry - stop); if (risk <= 0) return null;
  // hedefler: TP1 = karşı range kenarı; TP2 = sonraki IPDA seviyesi
  const oppo = long ? manip.rangeHigh : manip.rangeLow;
  const ipTgt = long ? Math.max(...ipda.map(x => x.high)) : Math.min(...ipda.map(x => x.low));
  let tps = [oppo, ipTgt].filter((t, i, a) => (long ? t > entry : t < entry) && a.indexOf(t) === i);
  if (!tps.length) tps = [long ? round(entry + risk * 2) : round(entry - risk * 2)];
  tps = (long ? tps.sort((a, b) => a - b) : tps.sort((a, b) => b - a)).slice(0, 2);
  // confluence
  let conf = 1; const reasons = ['Manipulation: range ' + (long ? 'altı süpürüldü, geri alındı (likidite avı / Turtle Soup)' : 'üstü süpürüldü, geri alındı (Turtle Soup)'), 'Smart Money Reversal'];
  // CISD / displacement teyidi (kanonik MMxM Phase 3): reclaim mumu son 10 mumun ortalama gövdesinden belirgin büyük ve model yönünde mü
  const rc = candles[manip.at];
  const bodies = candles.slice(Math.max(0, manip.at - 10), manip.at).map(k => Math.abs(k.c - k.o));
  const avgB = bodies.length ? bodies.reduce((a, b) => a + b, 0) / bodies.length : 0;
  if (rc && avgB > 0 && Math.abs(rc.c - rc.o) >= avgB * 1.2 && (long ? rc.c > rc.o : rc.c < rc.o)) { conf++; reasons.push('CISD / displacement teyidi (güçlü geri alım mumu)'); }
  const oiS = oiState(oi);
  if (oiS && oiS.bigDrop) { conf++; reasons.push('BIG OI drop (%' + oiS.dropPct + ') → program değişimi / MMBM konfirmesi'); }
  const biasOk = bias !== 'Neutral' && (bias === 'Bullish') === long;
  if (biasOk) { conf++; reasons.push('Bias uyumlu (' + bias + ')'); }
  const curRsi = rsiArr[rsiArr.length - 1];
  if (curRsi != null && (long ? curRsi < 45 : curRsi > 55)) { conf++; reasons.push('RSI ' + Math.round(curRsi)); }
  // ---- yigit (SMC) kontrolleri ----
  // 1) FVG EQ kazanımı: model yönlü en yakın FVG'nin EQ'su (CE) kazanılmış mı
  const fvgEq = fvgList && fvgList.length ? fvgEqDurumu(candles, fvgList.slice(-12), manip.side) : null;
  if (fvgEq && fvgEq.won) { conf++; reasons.push('FVG EQ kazanımı ✓ (yigit: EQ kazanılmadan işlem yok)'); }
  else if (fvgEq) reasons.push('⚠ FVG EQ (' + fvgEq.ce + ') henüz kazanılmadı — yigit: teyit bekle');
  // 2) Hedef yönü likiditesi zaten alınmışsa kovalama (yigit: "likiditeler alınmış → trade yok")
  if (liq && liq.length) {
    const tgt = long ? liq.filter(l => l.type === 'BSL' && l.price > entry) : liq.filter(l => l.type === 'SSL' && l.price < entry);
    const near = tgt.sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0];
    if (near) {
      let swept = false;
      for (let i = Math.max(0, candles.length - 20); i < candles.length; i++) { const k = candles[i]; if (long ? k.h > near.price : k.l < near.price) { swept = true; break; } }
      if (swept) { conf = Math.max(1, conf - 1); reasons.push('⚠ Hedef likiditesi (' + round(near.price) + ') son 20 barda zaten alınmış — yigit: kovalamak riskli'); }
    }
  }
  // 3) FVG retest girişi (yigit giriş modeli): reclaim sonrası model yönlü ilk FVG'nin CE'si
  let altEntry = null;
  if (fvgList) { const f2 = fvgList.find(f => f.from >= manip.at && f.type === (long ? 'bull' : 'bear')); if (f2) altEntry = round(f2.mid); }
  // ---- SolCJ (Wyckoff+ICT) kontrolleri ----
  // 4) Volume Profile: giriş Value Area içinde / POC yakınında mı
  if (vp) {
    const inVA = entry >= vp.val && entry <= vp.vah;
    const nearPoc = Math.abs(entry - vp.poc) / entry <= 0.01;
    if (inVA || nearPoc) { conf++; reasons.push('Hacim Profili confluence: ' + (nearPoc ? 'POC yakını (' + vp.poc + ')' : 'Value Area içinde [' + vp.val + '–' + vp.vah + ']') + ' (SolCJ)'); }
  }
  // 5) iFVG POI: model yönlü iFVG bölgesi girişi kapsıyor/yakın mı
  if (ifvg && ifvg.length) {
    const hit = ifvg.find(f => f.type === (long ? 'bull' : 'bear') && entry <= f.top * 1.005 && entry >= f.bottom * 0.995);
    if (hit) { conf++; reasons.push('iFVG POI: geçersizleşen FVG ' + (long ? 'desteğe' : 'dirence') + ' döndü [' + hit.bottom + '–' + hit.top + '] (SolCJ)'); }
  }
  // ---- JB (2xHOB + OTE) kontrolleri ----
  // 6) OTE desteği: giriş (veya FVG-retest girişi) bacağın 0.618–0.786 düzeltme bölgesinde mi
  if (ote) {
    const inOte = p => p != null && p >= ote.bottom && p <= ote.top;
    if (inOte(entry) || inOte(altEntry)) { conf++; reasons.push('OTE 0.618–0.786 desteği [' + ote.bottom + '–' + ote.top + '] (JB: fib-backed giriş)'); }
  }
  // 7) HOB (gizli OB) bandı: giriş model yönlü son OB bölgesiyle kesişiyor mu
  if (hob && entry >= hob.bottom * 0.998 && entry <= hob.top * 1.002) { conf++; reasons.push('HOB (gizli OB) girişte [' + round(hob.bottom) + '–' + round(hob.top) + '] (JB 2xHOB)'); }
  reasons.push('Market Maker ' + (long ? 'Buy' : 'Sell') + ' Model · Wyckoff: ' + (long ? 'Spring → Test → SOS' : 'UTAD → Test → SOW') + ' · Hedef: karşı range / IPDA');
  // stop/TP olmuş mu (manipulation sonrası)
  const o = manip.at; const tF = tps[tps.length - 1];
  let entryIdx = -1;
  for (let i = o; i < candles.length; i++) { const k = candles[i]; if (long ? k.l <= entry : k.h >= entry) { entryIdx = i; break; } }
  if (entryIdx >= 0) for (let i = entryIdx; i < candles.length; i++) { const k = candles[i]; if (long ? (k.l <= stop || k.h >= tF) : (k.h >= stop || k.l <= tF)) return null; }
  const entryStatus = entryIdx >= 0 ? 'active' : 'pending';
  const rr = Math.min(Math.round(Math.abs(tF - entry) / risk * 10) / 10, 20);   // görsel sağduyu tavanı
  let grade = 'B'; if (conf >= 4) grade = 'A+'; else if (conf >= 3) grade = 'A';
  // yigit sert kuralı: HTF bias ters ise not tavanı B ("HTF dönmeden 3-5m long = stop")
  if (bias !== 'Neutral' && !biasOk) { grade = 'B'; reasons.push('⚠ HTF bias ters — yigit kuralı: HTF dönmeden işlem alma'); }
  const confidence = Math.max(20, Math.min(99, Math.round(conf / 4 * 80 + 15)));
  return { side: manip.side, model: 'MM ' + (long ? 'Buy' : 'Sell') + ' Model', grade, confidence, entry: round(entry), stop, altEntry, tps: tps.map(t => round(t)), rr, riskPct: round(risk / entry * 100, 2), htfBias: bias, htfAligned: biasOk, conf, originAt: manip.at, entryStatus, reasons };
}

// ----- GERÇEK MMxM filtresi: HTF bağlam + LTF teyit (kanonik model doğrulaması) -----
// 1) HTF IOF  2) HTF premium/discount  3) HTF PD array  4) HTF DOL  5) LTF CISD+MSS. valid = LTF onay + skor>=4.
function mmxmFilter(candles, ctx) {
  const { manip, bias, interval, ltf, tps } = ctx;
  if (!manip) return null;
  const long = manip.side === 'LONG';
  const checks = [];
  const htfMs = HTF_MAP[interval] || 4 * 3600000;
  const htfC = resample(candles, htfMs);
  // 1) HTF IOF (yapı yönü model yönünde)
  const okIOF = bias !== 'Neutral' && ((bias === 'Bullish') === long);
  checks.push({ name: 'HTF yön (IOF) uyumu', ok: okIOF });
  // 2) HTF premium/discount: sweep HTF dealing range EQ'nun doğru tarafında
  const seg = htfC.slice(-40);
  let okPD = false, htfHigh = null, htfLow = null;
  if (seg.length >= 10) {
    htfHigh = Math.max(...seg.map(k => k.h)); htfLow = Math.min(...seg.map(k => k.l));
    const eqH = (htfHigh + htfLow) / 2;
    okPD = long ? manip.wick <= eqH : manip.wick >= eqH;
  }
  checks.push({ name: long ? 'Sweep HTF discount bölgesinde' : 'Sweep HTF premium bölgesinde', ok: okPD });
  // 3) HTF PD array: wick bir HTF FVG içinde veya HTF IPDA (20/40/60) ucunu süpürdü
  let okArr = false; const tol = 0.003;
  const hf = fvgs(htfC, 0.0008);
  for (const f of hf) { if ((long ? f.type === 'bull' : f.type === 'bear') && manip.wick <= f.top * (1 + tol) && manip.wick >= f.bottom * (1 - tol)) { okArr = true; break; } }
  if (!okArr) [20, 40, 60].forEach(nn => { const s2 = htfC.slice(-nn); if (s2.length >= 10) { const lv = long ? Math.min(...s2.map(k => k.l)) : Math.max(...s2.map(k => k.h)); if (long ? manip.wick <= lv * (1 + tol) : manip.wick >= lv * (1 - tol)) okArr = true; } });
  checks.push({ name: 'SMR bir HTF PD array üstünde (FVG / eski uç)', ok: okArr });
  // 4) HTF DOL: hedef yönünde koşacak HTF likidite
  let okDOL = false;
  const tF = tps && tps.length ? tps[tps.length - 1] : (long ? manip.rangeHigh : manip.rangeLow);
  if (htfHigh != null && tF != null) okDOL = long ? htfHigh >= Math.min(tF, manip.rangeHigh) : htfLow <= Math.max(tF, manip.rangeLow);
  checks.push({ name: 'HTF DOL hedef yönünde (koşacak likidite)', ok: okDOL });
  // 5) LTF onay: alt TF'de sweep sonrası CISD (displacement) + MSS (yapı kırılımı)
  let okLTF = false, ltfState = 'veri yok';
  if (ltf && ltf.candles && ltf.candles.length > 40 && manip.sweepAt != null) {
    ltfState = 'onay yok';
    const t0 = candles[manip.sweepAt].t;
    const barMs = candles.length > 1 ? candles[1].t - candles[0].t : 0;
    const tEnd = candles[Math.min(candles.length - 1, manip.at + 8)].t + barMs;
    const L = ltf.candles, bodies = L.map(k => Math.abs(k.c - k.o));
    for (let i = 1; i < L.length; i++) {
      if (L[i].t < t0 || L[i].t > tEnd) continue;
      const from = Math.max(0, i - 20);
      const avg = bodies.slice(from, i).reduce((a, b) => a + b, 0) / Math.max(1, i - from);
      const disp = avg > 0 && bodies[i] >= avg * 1.3 && (long ? L[i].c > L[i].o : L[i].c < L[i].o);   // CISD displacement
      if (!disp) continue;
      const back = L.slice(Math.max(0, i - 12), i);
      const mss = back.length && (long ? L[i].c > Math.max(...back.map(k => k.h)) : L[i].c < Math.min(...back.map(k => k.l)));   // yapı kırılımı
      if (mss) { okLTF = true; ltfState = 'onaylı'; break; }
    }
  }
  checks.push({ name: 'LTF onay: CISD + MSS' + (ltf && ltf.interval ? ' (' + ltf.interval + ')' : ''), ok: okLTF, state: ltfState });
  const score = checks.filter(c => c.ok).length;
  // Backtest (224 setup, 15 sembol, 60m+15m): LTF onaylı +0.34R/işlem, LTF onaysız -0.46R -> edge kaynağı LTF onayı.
  // GERÇEK = LTF onay + skor>=3 (LTF onaylıların tamamı HTF>=2 idi; 4/5 şartı gereksiz sıkıydı).
  const ltfData = !!(ltf && ltf.candles && ltf.candles.length > 40);
  return { score, max: checks.length, checks, valid: okLTF && score >= 3, ltfData, ltfInterval: (ltf && ltf.interval) || null };
}

// DREYKO üslubunda yorum
function dreykoComment(candles, ctx) {
  const { manip, eq, bias, rsiNow, base, oi, ipda } = ctx;
  const price = candles[candles.length - 1].c;
  const f = v => v >= 1 ? (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)) : v.toFixed(v >= 0.01 ? 4 : 6);
  const L = [];
  L.push((base || 'Asset') + ' | ICT + Open Interest 📊');
  L.push('Fiyat ' + f(price) + '$. Bias: ' + (bias === 'Bullish' ? 'BOĞA' : bias === 'Bearish' ? 'AYI' : 'NÖTR') + '. Tek market, tek bias, tek plan.');
  if (eq) L.push('Dealing range: ' + f(eq.low) + '$ – ' + f(eq.high) + '$.');
  if (manip) L.push('🔹 Manipulation: range ' + (manip.side === 'LONG' ? 'altı (' + f(manip.wick) + '$) süpürüldü, geri alındı → ' + 'Smart Money Reversal (Buy Model). Hedef karşı taraf.' : 'üstü (' + f(manip.wick) + '$) süpürüldü, geri alındı → Smart Money Reversal (Sell Model).'));
  const oiS = oiState(oi);
  if (oiS) L.push('🔹 Open Interest: ' + (oiS.bigDrop ? 'BIG OI drop (%' + oiS.dropPct + ') → Sell/Buy program değişimi (MMBM konfirmesi).' : 'OI dengeli (%' + oiS.dropPct + ' düşüş).'));
  if (ipda && ipda.length) L.push('🔹 IPDA: 20/40/60 likidite seviyeleri hedef olarak izleniyor.');
  if (manip) L.push('🔹 Wyckoff (SolCJ): ' + (manip.side === 'LONG' ? 'Spring → Test → SOS beklenen sıra (Accumulation); LPS retesti giriş bölgesi.' : 'UTAD → Test → SOW beklenen sıra (Distribution); LPSY retesti giriş bölgesi.'));
  if (manip) L.push('🔹 Yönetim (CJ): 1R sonrası SL→BE; karşı yönde SMT oluşursa modeli tamamlanmış say, defansa geç.');
  if (manip) L.push('🔹 Yönetim (JB): TP1\'de derisk (%25-50 kâr al), kalan runner\'ı Trail SL ile taşı.');
  if (ctx.vp) L.push('🔹 Hacim Profili: POC ' + f(ctx.vp.poc) + '$ · Value Area ' + f(ctx.vp.val) + '$–' + f(ctx.vp.vah) + '$.');
  if (ctx.wyk && ctx.wyk.pnf) { const ph = ctx.wyk.phases ? ctx.wyk.phases.map(p => p.label).join('→') : '';
    L.push('🔹 Wyckoff TR: faz ' + ph + ' · PNF cause hedefleri (range dışı): ' + ctx.wyk.pnf.targets.map(f).join('$ / ') + '$.'); }
  if (ctx.setup && ctx.setup.altEntry) L.push('🔹 Yigit girişi: kazanılan FVG retesti ~' + f(ctx.setup.altEntry) + '$ · risk bakiyenin %1\'i = 1R.');
  else L.push('🔹 Risk planı (yigit): bakiyenin %1\'i = 1R; FVG EQ kazanılmadan acele etme, alınmış likiditeyi kovalama.');
  L.push('📌 ' + (manip ? (manip.side === 'LONG' ? 'Long: range altı avı + geri alım; stop sweep altı.' : 'Short: range üstü avı + geri alım; stop sweep üstü.') : 'Net manipulation yok — izleme.') + ' RSI ' + (rsiNow != null ? rsiNow : '-') + '. Doğru zaman, doğru risk.');
  return L.join('\n');
}

// ----------------------------- ana giriş (DREYKO / ICT + OI stili) -----------------------------
function analyze(candles, opts) {
  opts = opts || {};
  if (!candles || candles.length < 60) return { error: 'yetersiz veri', candles: candles || [] };
  const closes = candles.map(c => c.c);
  const rsiArr = rsi(closes, 14);
  const sw = swings(candles, opts.swingK || 2);
  const ms = marketStructure(candles, sw);
  const price = candles[candles.length - 1].c;
  const interval = opts.interval || '15m';

  // DREYKO katmanları: ICT (range/manipulation/IPDA/FVG/likidite) + Open Interest (Larry Williams)
  const eq = equilibrium(candles);                  // yedek dealing range
  const manip = manipulation(candles);              // Classic Range Manipulation (sweep + reclaim)
  const ipda = ipdaLevels(candles);                 // IPDA 20/40/60
  const fvgRaw = fvgs(candles, opts.minGapPct || 0.0008);
  const liq = liquidity(sw, opts.liqTol || 0.0015);
  const oi = opts.oi || null;                        // Binance futures OI (server'dan)
  const oiS = oiState(oi);

  // Bias: HTF yapı yönü (+ manipulation yönü destekler)
  const htfMs = HTF_MAP[interval] || 4 * 3600000;
  const htfTrend = marketStructure(resample(candles, htfMs), swings(resample(candles, htfMs), 2)).trend;
  let bias = htfTrend === 'up' ? 'Bullish' : htfTrend === 'down' ? 'Bearish' : 'Neutral';
  if (bias === 'Neutral' && manip) bias = manip.side === 'LONG' ? 'Bullish' : 'Bearish';
  const rsiNow = rsiArr[rsiArr.length - 1] != null ? Math.round(rsiArr[rsiArr.length - 1]) : null;
  const base = (opts.symbol || '').replace(/USDT$/, '');

  const vp = volumeProfile(candles);                 // SolCJ: Volume Profile (POC/VAH/VAL)
  const ifvg = invertedFvgs(candles, fvgRaw);        // SolCJ: geçersizleşen FVG'ler (ters POI)
  const ote = oteZone(candles, manip);               // JB: giriş bacağının 0.618–0.786 OTE bölgesi
  const obsAll = orderBlocks(candles, ms);
  const hob = manip ? obsAll.filter(o => o.type === (manip.side === 'LONG' ? 'bull' : 'bear')).slice(-1)[0] || null : null;   // JB: HOB (gizli OB) bandı
  const setup = buildDreykoSetup(candles, { manip, eq, ipda, bias, rsiArr, oi, fvgList: fvgRaw, liq, vp, ifvg, ote, hob });

  // GERÇEK MMxM filtresi (HTF bağlam + LTF teyit) — setup olmasa da izleme için hesaplanır
  const mmxm = mmxmFilter(candles, { manip, bias, interval, ltf: opts.ltf, tps: setup ? setup.tps : null });
  if (setup && mmxm) {
    if (mmxm.valid) {
      setup.conf++; if (setup.grade === 'A') setup.grade = 'A+';
      setup.reasons.push('GERÇEK MMxM ✓ ' + mmxm.score + '/' + mmxm.max + ' — LTF CISD/MSS onaylı (backtest: +0.34R/işlem)');
    } else if (mmxm.ltfData) {
      // LTF verisi VAR ama onay YOK: backtest bu grubu net negatif buldu (-0.46R) -> not düşür + uyar
      setup.grade = 'B';
      setup.reasons.push('⚠ LTF onayı yok (' + mmxm.score + '/' + mmxm.max + ') — backtest beklentisi NEGATİF (-0.46R), teyitsiz girme');
    } else {
      setup.reasons.push('MMxM ' + mmxm.score + '/' + mmxm.max + ' (LTF verisi yok — ön izleme)');
    }
    setup.mmxm = { score: mmxm.score, max: mmxm.max, valid: mmxm.valid };
  }

  // OI'yi grafik paneli için sadeleştir (zaman+değer)
  const oiSeries = oi ? oi.slice(-Math.min(oi.length, candles.length)).map(o => ({ t: o.t, oi: o.oi })) : null;
  const wyk = wyckoffEvents(candles, manip);         // Wyckoff olaylar + fazlar (A-E) + PNF hedefleri

  return {
    candles, rsi: rsiArr,
    structures: {
      trend: ms.trend,
      bias,
      range: manip ? { high: manip.rangeHigh, low: manip.rangeLow } : (eq ? { high: round(eq.high), low: round(eq.low) } : null),
      manipulation: manip,
      ipda,
      fvg: fvgRaw.slice(-5),
      liquidity: liq.slice(-6),
      oi: oiSeries,
      oiState: oiS,
      volprof: vp,
      ifvg,
      wyckoff: wyk,
      ote,
      hob: hob ? { top: round(hob.top), bottom: round(hob.bottom), from: hob.from } : null,
      mmModel: manip ? (manip.side === 'LONG' ? 'Buy' : 'Sell') : (bias === 'Bullish' ? 'Buy' : bias === 'Bearish' ? 'Sell' : null),
      mmxm,
      watermark: base
    },
    lastPrice: round(price),
    rsiNow,
    htfBias: bias,
    setup,
    comment: dreykoComment(candles, { manip, eq, ipda, bias, rsiNow, base, oi, setup, vp, wyk })
  };
}

// ----------------------------- Forever Model (yaklaşık) backtest -----------------------------
// Dokümante mantık: FVG (iç likidite) + trend yönü -> retest girişi -> dış likiditeye (R hedefleri).
// NOT: gerçek kapalı-kaynak indikatörün birebir aynısı DEĞİL; FVG+trend çekirdeğine dayalı yaklaşık model.
function backtest(candles, opts) {
  opts = opts || {};
  const rrList = opts.rr || [1, 1.5, 2, 3];
  const buf = opts.buf != null ? opts.buf : 0.0015;
  const closes = candles.map(c => c.c);
  const e = ema(closes, opts.ema || 50);
  const fvg = fvgs(candles, opts.minGap || 0.001);
  const byR = {}; rrList.forEach(r => byR[r] = { win: 0, loss: 0, open: 0 });
  let count = 0;
  for (const f of fvg) {
    const i0 = f.to; if (e[i0] == null) continue;
    const long = f.type === 'bull';
    if (long !== (closes[i0] > e[i0])) continue;       // sadece trend yönündeki FVG
    let ei = -1, entry = 0, sl = 0;
    for (let j = i0 + 1; j < candles.length - 1; j++) {
      const c = candles[j];
      if (long) { if (c.c < f.bottom) { ei = -2; break; } if (c.l <= f.top) { ei = j; entry = f.top; sl = f.bottom * (1 - buf); break; } }
      else { if (c.c > f.top) { ei = -2; break; } if (c.h >= f.bottom) { ei = j; entry = f.bottom; sl = f.top * (1 + buf); break; } }
    }
    if (ei < 0) continue;
    const risk = Math.abs(entry - sl); if (risk <= 0) continue;
    count++;
    for (const r of rrList) {
      const tp = long ? entry + r * risk : entry - r * risk;
      let res = 'open';
      for (let j = ei + 1; j < candles.length; j++) {
        const c = candles[j];
        if (long) { if (c.l <= sl) { res = 'loss'; break; } if (c.h >= tp) { res = 'win'; break; } }
        else { if (c.h >= sl) { res = 'loss'; break; } if (c.l <= tp) { res = 'win'; break; } }
      }
      byR[r][res]++;
    }
  }
  const perR = {};
  for (const r of rrList) { const b = byR[r], closed = b.win + b.loss; perR[r] = { trades: b.win + b.loss + b.open, win: b.win, loss: b.loss, open: b.open, winRate: closed ? Math.round(b.win / closed * 1000) / 10 : 0, expectancyR: closed ? Math.round((b.win / closed * r - b.loss / closed) * 100) / 100 : 0 }; }
  return { signals: count, perR };
}

module.exports = { analyze, rsi, ema, swings, marketStructure, fib2618, chartPatterns, harmonics, fvgs, orderBlocks, liquidity, resample, keyLevels, backtest, round, manipulation, mmxmFilter, ipdaLevels, HTF_MAP };
