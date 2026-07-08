/*
 * chart.js — canvas mum grafiği (v10 — @jaxiwnl21 DREYKO stili, KOYU tema, ICT + Open Interest).
 * Dealing range + Manipulation (likidite avı kırmızı kutu) + Smart Money Reversal + IPDA 20/40/60 +
 *   Market Maker Buy/Sell Model + Buy/Sell curve + Projeksiyon/TP + OI ALT PANELİ (BIG OI drop) + Entry/SL/TP + filigran.
 * TV gibi: sürükle=pan(yatay+dikey, sağa/geleceğe), tekerlek=zoom, fiyat ekseni=dikey ölçek, crosshair, çift tık=sıfırla, canlı.
 */
(function (global) {
  'use strict';
  const T = {
    bg: '#0b0e13', grid: 'rgba(255,255,255,0.04)', axis: '#c9d1d9', axisDim: '#8b949e',
    upFill: '#26a269', upBorder: '#26a269', downFill: '#e0444b', downBorder: '#e0444b', wick: '#7d8694',
    range: 'rgba(200,210,225,0.6)', rangeFill: 'rgba(120,130,150,0.06)',
    manip: 'rgba(224,68,75,0.30)', manipL: '#e0444b',
    ipda: 'rgba(150,170,200,0.4)', ipdaL: '#8fb0d8',
    mm: '#e8c34a', proj: '#e8d34a', oiLine: '#4fa8e0', oiDrop: '#e0444b',
    fvg: 'rgba(120,130,150,0.16)', liq: '#3b82f6',
    entry: '#3b82f6', sl: '#e0444b', tp: '#26a269', rewardZone: 'rgba(38,162,105,0.07)', riskZone: 'rgba(224,68,75,0.07)',
    cross: 'rgba(220,225,235,0.4)', crossTag: '#30363d', wm: 'rgba(230,200,90,0.13)'
  };
  const DEFAULT_LAYERS = { range: true, manipulation: true, ipda: true, mmModel: true, projection: true, oi: true, trade: true, volprof: true, ifvg: true, wyckoffTR: true, fvg: false, liquidity: false };

  function fmt(v) { const a = Math.abs(v); let d = a >= 1000 ? 1 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8; return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtK(v) { const a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0); }
  function tlabel(ms, iv) { const dt = new Date(ms), p = n => String(n).padStart(2, '0'); return (iv === '1d' || iv === '4h') ? p(dt.getDate()) + '/' + p(dt.getMonth() + 1) : p(dt.getHours()) + ':' + p(dt.getMinutes()); }
  function tlabelFull(ms) { const dt = new Date(ms), p = n => String(n).padStart(2, '0'); return p(dt.getDate()) + '/' + p(dt.getMonth() + 1) + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes()); }

  function Chart(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.pad = { l: 6, r: 92, t: 30, b: 24 };
    this.data = null; this.layers = null;
    this.view = { bars: null, right: null };
    this.follow = true; this.priceZoom = 1; this.priceShift = 0;
    this.mouse = null; this.drag = null; this.vdrag = null; this._geo = null;
    this._bind();
  }

  Chart.prototype._bind = function () {
    const cv = this.canvas, self = this;
    const clampZ = z => Math.max(0.15, Math.min(12, z));
    const overAxis = x => self._geo && x > self._geo.pR;
    cv.addEventListener('mousedown', e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (overAxis(x)) { self.vdrag = { y, z0: self.priceZoom }; cv.style.cursor = 'ns-resize'; return; }
      self.drag = { x, y, right0: self._curRight(), bars0: self._curBars(), shift0: self.priceShift };
      cv.style.cursor = 'grabbing';
    });
    global.addEventListener('mouseup', () => { if (self.drag || self.vdrag) { self.drag = null; self.vdrag = null; self.canvas.style.cursor = 'crosshair'; } });
    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (self.vdrag) { const dy = y - self.vdrag.y; self.priceZoom = clampZ(self.vdrag.z0 * (1 - dy / 250)); self.mouse = null; self._draw(); return; }
      self.mouse = { x, y };
      if (self.drag && self._geo) {
        const dBars = Math.round((x - self.drag.x) / self._geo.cw);
        let right = self.drag.right0 - dBars;
        const total = self.data ? self.data.candles.length : 0;
        const bars0 = self.drag.bars0, pad = Math.max(2, Math.floor(bars0 * 0.06)), maxRight = total - 1 + Math.floor(bars0 * 0.6);
        right = Math.max(bars0 - 1, Math.min(right, maxRight));
        self.view.right = right; self.view.bars = bars0;
        self.follow = right >= total - 1 && right <= total - 1 + pad;
        const plotH = self._geo.pPB - self._geo.pT;
        if (plotH > 0) self.priceShift = self.drag.shift0 + (y - self.drag.y) / plotH;
      } else cv.style.cursor = overAxis(x) ? 'ns-resize' : 'crosshair';
      self._draw();
    });
    cv.addEventListener('mouseleave', () => { self.mouse = null; self._draw(); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      if (!self._geo || !self.data) return;
      const g = self._geo, total = self.data.candles.length;
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left;
      if (overAxis(mx)) { self.priceZoom = clampZ(self.priceZoom * (e.deltaY < 0 ? 1.1 : 0.9)); self._draw(); return; }
      const bars0 = self._curBars();
      const factor = e.deltaY < 0 ? 0.85 : 1.18;
      let bars = Math.max(20, Math.min(Math.round(bars0 * factor), total));
      const gUnder = g.start + (mx - g.pL) / g.cw;
      const newCw = (g.pR - g.pL) / bars;
      let right = Math.round(gUnder - (mx - g.pL) / newCw + bars - 1);
      const pad = Math.max(2, Math.floor(bars * 0.06)), maxRight = total - 1 + Math.floor(bars * 0.6);
      right = Math.max(bars - 1, Math.min(right, maxRight));
      self.view.bars = bars; self.view.right = right;
      self.follow = right >= total - 1 && right <= total - 1 + pad;
      self._draw();
    }, { passive: false });
    cv.addEventListener('dblclick', () => { self.resetView(); self._draw(); });
    cv.style.cursor = 'crosshair';
  };

  Chart.prototype._curBars = function () {
    if (this.view.bars) return this.view.bars;
    const W = this.canvas.clientWidth || 900, plotW = W - this.pad.l - this.pad.r;
    const total = this.data ? this.data.candles.length : 120;
    return Math.max(20, Math.min(total, Math.max(60, Math.floor(plotW / 7))));
  };
  Chart.prototype._curRight = function () {
    const total = this.data ? this.data.candles.length : 0;
    const bars = this._curBars(), pad = Math.max(2, Math.floor(bars * 0.06)), maxRight = total - 1 + Math.floor(bars * 0.6);
    if (this.follow || this.view.right == null) return total - 1 + pad;
    return Math.max(bars - 1, Math.min(this.view.right, maxRight));
  };
  Chart.prototype.resetView = function () { this.view = { bars: null, right: null }; this.follow = true; this.priceZoom = 1; this.priceShift = 0; };
  Chart.prototype.render = function (data, layers) {
    this.data = data;
    this.layers = Object.assign({}, DEFAULT_LAYERS, layers || this.layers || {});
    this._draw();
  };

  Chart.prototype._draw = function () {
    const data = this.data; if (!data) return;
    const layers = this.layers, cv = this.canvas, ctx = this.ctx, dpr = global.devicePixelRatio || 1;
    const W = cv.clientWidth || 900, H = cv.clientHeight || 520, P = this.pad;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    const all = data.candles || [];
    if (!all.length) { ctx.fillStyle = T.axis; ctx.fillText('veri yok', 20, 80); return; }

    const total = all.length;
    const bars = Math.max(20, Math.min(this._curBars(), total));
    const right = this._curRight();
    const start = Math.max(0, right - bars + 1), end = right + 1;
    const candles = all.slice(start, end);
    const startIdx = start;
    const s = data.structures || {}, setup = data.setup;

    const pL = P.l, pR = W - P.r, pT = P.t, pB = H - P.b;
    const oiOn = layers.oi && s.oi && s.oi.length;
    const subH = oiOn ? Math.round((pB - pT) * 0.16) : 0, gap = 8;
    const pPB = pB - (oiOn ? subH + gap : 0);            // fiyat paneli alt
    const oiR = oiOn ? { t: pPB + gap, b: pB } : null;

    let min = Infinity, max = -Infinity;
    for (const c of candles) { if (c.l < min) min = c.l; if (c.h > max) max = c.h; }
    const cMin = min, cMax = max, band = (cMax - cMin || cMax * 0.01) * 1.8;
    const extra = [];
    if (layers.range && s.range) { extra.push(s.range.high, s.range.low); }
    if (layers.trade && setup) { extra.push(setup.entry); if (setup.entryStatus !== 'pending') { extra.push(setup.stop); setup.tps.forEach(t => extra.push(t)); } }
    if (layers.wyckoffTR && s.wyckoff && s.wyckoff.pnf) extra.push(s.wyckoff.pnf.targets[0]);   // PNF T1 görünür kalsın
    for (const v of extra) { if (v >= cMin - band && v <= cMax + band) { if (v < min) min = v; if (v > max) max = v; } }
    const span = (max - min) || max * 0.01; min -= span * 0.07; max += span * 0.07;
    { let cc = (min + max) / 2, hh = (max - min) / 2 / this.priceZoom; cc += this.priceShift * (hh * 2); min = cc - hh; max = cc + hh; }

    const cw = (pR - pL) / bars, bodyW = Math.max(1, Math.min(cw * 0.62, 14));
    const X = i => pL + cw * (i + 0.5);
    const Y = p => pPB - (p - min) / (max - min) * (pPB - pT);
    const Yinv = y => min + (pPB - y) / (pPB - pT) * (max - min);
    const gi = i => i - startIdx;
    this._geo = { pL, pR, pT, pB, pPB, cw, start, bars, min, max };
    const rightTag = (p, color, label) => { const y = Y(p); ctx.fillStyle = color; ctx.fillRect(pR, y - 8, P.r, 16); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, pR + 4, y); };
    ctx.save(); ctx.beginPath(); ctx.rect(pL, pT - 2, pR - pL, pB - pT + 2); ctx.clip();

    ctx.fillStyle = T.wm; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText((data.symbol || '').replace('USDT', '/USDT'), pL + 14, pT + 8);
    for (let k = 0; k <= 6; k++) { const y = pT + (pPB - pT) * k / 6; ctx.strokeStyle = T.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pR, y); ctx.stroke(); }

    // DEALING RANGE (DREYKO: ince çizgiler + SAĞDA '· Range HIGH/EQ/LOW' etiketleri + EQ kesikli — NQ Range şablonu)
    if (layers.range && s.range) {
      const y1 = Y(s.range.high), y2 = Y(s.range.low), yE = Y((s.range.high + s.range.low) / 2);
      ctx.fillStyle = T.rangeFill; ctx.fillRect(pL, Math.min(y1, y2), pR - pL, Math.abs(y2 - y1));
      ctx.strokeStyle = T.range; ctx.lineWidth = 1; ctx.setLineDash([]);
      [y1, y2].forEach(y => { ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pR, y); ctx.stroke(); });
      ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pL, yE); ctx.lineTo(pR, yE); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = T.range; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom'; ctx.fillText('· Range HIGH', pR - 4, y1 - 2);
      ctx.fillText('· Range EQ', pR - 4, yE - 2);
      ctx.textBaseline = 'top'; ctx.fillText('· Range LOW', pR - 4, y2 + 2);
    }

    // IPDA seviyeleri
    if (layers.ipda) (s.ipda || []).forEach(ip => {
      [['IPDA' + ip.n + ' H', ip.high], ['IPDA' + ip.n + ' L', ip.low]].forEach(([lab, p]) => {
        const y = Y(p); if (y < pT || y > pPB) return; ctx.strokeStyle = T.ipda; ctx.lineWidth = 0.7; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pR, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = T.ipdaL; ctx.font = '8px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(lab, pR - 2, y);
      });
    });

    // FVG / likidite (opsiyonel)
    // ---- VOLUME PROFILE (SolCJ): sağ iç kenarda mavi histogram + POC/VAH/VAL ----
    if (layers.volprof && s.volprof && s.volprof.bins) {
      const vpp = s.volprof, maxV = Math.max(...vpp.bins.map(b => b.v)) || 1, maxW = (pR - pL) * 0.13;
      ctx.fillStyle = 'rgba(79,168,224,0.16)';
      for (const b of vpp.bins) { const y = Y(b.p); if (y < pT || y > pPB) continue; const bh = Math.max(2, (pPB - pT) / vpp.bins.length - 1); ctx.fillRect(pR - (b.v / maxV) * maxW, y - bh / 2, (b.v / maxV) * maxW, bh); }
      const vln = (p, lab, dash, col) => { const y = Y(p); if (y < pT || y > pPB) return; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pR, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.font = 'bold 8px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(lab, pR - 2, y - 1); };
      vln(vpp.poc, 'POC', [], '#4fa8e0');
      vln(vpp.vah, 'VAH', [4, 3], 'rgba(79,168,224,0.75)');
      vln(vpp.val, 'VAL', [4, 3], 'rgba(79,168,224,0.75)');
    }
    // ---- iFVG (SolCJ): geçersizleşen FVG ters POI — mor kesikli kutu ----
    if (layers.ifvg) (s.ifvg || []).forEach(f => {
      const vi = gi(f.from); if (vi >= candles.length) return;
      const x0 = Math.max(pL, vi >= 0 ? X(vi) : pL), yT = Y(f.top), yB = Y(f.bottom);
      if (Math.max(yT, yB) < pT || Math.min(yT, yB) > pPB) return;
      ctx.fillStyle = 'rgba(176,120,220,0.10)'; ctx.fillRect(x0, Math.min(yT, yB), pR - x0, Math.abs(yB - yT));
      ctx.strokeStyle = 'rgba(176,120,220,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(x0, Math.min(yT, yB), pR - x0, Math.abs(yB - yT)); ctx.setLineDash([]);
      ctx.fillStyle = '#b078dc'; ctx.font = 'italic bold 8px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('iFVG', x0 + 2, Math.min(yT, yB) - 1);
    });
    // FVG: kutu + CE kesikli orta çizgi (DREYKO tüm FVG'lerde CE kullanır), sağa uzatılır
    if (layers.fvg) (s.fvg || []).forEach(f => { const x = X(Math.max(0, gi(f.from))); if (gi(f.from) > bars) return; const x0 = Math.max(pL, x), yT = Y(f.top), yB = Y(f.bottom); ctx.fillStyle = T.fvg; ctx.fillRect(x0, Math.min(yT, yB), pR - x0, Math.abs(yT - yB)); const yC = (yT + yB) / 2; ctx.strokeStyle = 'rgba(160,170,190,0.5)'; ctx.lineWidth = 0.7; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x0, yC); ctx.lineTo(pR, yC); ctx.stroke(); ctx.setLineDash([]); });
    // Likidite: düz çizgi + aynı renkte BOLD '· Buyside/Sellside Liquidity' etiketi (DREYKO şablonu; buyside mavi, sellside bordo)
    if (layers.liquidity) { const lastC = candles[candles.length - 1].c; (s.liquidity || []).forEach(l => { const y = Y(l.price); if (y < pT || y > pPB) return; const up = l.price >= lastC; const col = up ? '#3b82f6' : '#c25a63'; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pR, y); ctx.stroke(); ctx.fillStyle = col; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(up ? '· Buyside Liquidity $$$' : '· Sellside Liquidity $$$', pL + 3, y - 1); }); }

    // mumlar
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i], x = X(i), up = c.c >= c.o;
      ctx.strokeStyle = T.wick; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const yo = Y(c.o), yc = Y(c.c), top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yc - yo));
      ctx.fillStyle = up ? T.upFill : T.downFill; ctx.fillRect(x - bodyW / 2, top, bodyW, hgt);
      ctx.strokeStyle = up ? T.upBorder : T.downBorder; ctx.lineWidth = 1; ctx.strokeRect(x - bodyW / 2, top, bodyW, hgt);
    }

    // MANIPULATION (kırmızı kutu) + Smart Money Reversal + MM curve
    const mp = s.manipulation;
    if (layers.manipulation && mp) {
      // DREYKO şablonu (BTCUSDT 1G): DOLU pembe blok, sweep'in range dışında kaldığı TÜM aralık (sweepAt → reclaim)
      const v1 = gi(mp.sweepAt != null ? mp.sweepAt : mp.at), v2 = gi(mp.at != null ? mp.at : mp.sweepAt);
      const xa = (v1 >= 0 && v1 < candles.length) ? X(v1) : pL + 20, xb = (v2 >= 0 && v2 < candles.length) ? X(v2) : xa;
      const bx = Math.min(xa, xb) - cw * 0.8, bw = Math.max(Math.abs(xb - xa) + cw * 1.6, 16);
      const x = bx + bw / 2, y1 = Y(mp.box.top), y2 = Y(mp.box.bottom);
      ctx.fillStyle = T.manip; ctx.fillRect(bx, Math.min(y1, y2), bw, Math.abs(y2 - y1));
      ctx.fillStyle = T.manipL; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = mp.side === 'LONG' ? 'top' : 'bottom'; ctx.fillText('② Manipulation · ' + (mp.side === 'LONG' ? 'Spring' : 'UTAD'), Math.min(Math.max(x, pL + 64), pR - 64), mp.side === 'LONG' ? Math.max(y1, y2) + 3 : Math.min(y1, y2) - 3);
      // Smart Money Reversal okku
      const wy = Y(mp.wick), dir = mp.side === 'LONG' ? -1 : 1; ctx.strokeStyle = T.manipL; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, wy); ctx.lineTo(x, wy + dir * 22); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 4, wy + dir * 14); ctx.lineTo(x, wy + dir * 22); ctx.lineTo(x + 4, wy + dir * 14); ctx.stroke();
      // Turtle Soup — süpürülen seviye (DREYKO ETH şablonu: '+Turtle Soup ·' bordo italik + bordo çizgi; ICT: SMR'deki av = TS)
      const ly = Y(mp.level);
      ctx.strokeStyle = '#8b2635'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(Math.max(pL, bx - cw * 2), ly); ctx.lineTo(Math.min(bx + bw + cw * 6, pR), ly); ctx.stroke();
      ctx.fillStyle = '#c96570'; ctx.font = 'italic bold 9px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = mp.side === 'LONG' ? 'top' : 'bottom';
      ctx.fillText('+Turtle Soup ·', Math.min(bx + bw + cw * 1.5, pR - 74), mp.side === 'LONG' ? ly + 2 : ly - 2);
    }
    // ---- WYCKOFF TR (TradingView 'Wyckoff Trading Range' esinli): Faz A-E ayırıcıları + PNF hedefleri ----
    if (layers.wyckoffTR && s.wyckoff) {
      const wyt = s.wyckoff;
      // Faz ayırıcıları: dikey kesikli çizgiler + altta faz harfleri
      if (wyt.phases) {
        ctx.strokeStyle = 'rgba(170,180,200,0.30)'; ctx.lineWidth = 1;
        for (const ph of wyt.phases) {
          const v1 = gi(ph.from), v2 = gi(ph.to);
          if (v2 < 0 || v1 >= candles.length) continue;
          const xa = X(Math.max(0, v1)), xb = X(Math.min(candles.length - 1, v2));
          ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(xa, pT + 20); ctx.lineTo(xa, pPB); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(190,200,215,0.75)'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText('Faz ' + ph.label, (Math.max(pL, xa) + Math.min(pR, xb)) / 2, pPB - 2);
        }
      }
      // PNF hedefleri: base'den sağa turuncu kesikli çizgiler (hedefler DAIMA range dışında)
      if (wyt.pnf) {
        wyt.pnf.targets.forEach((t, i) => {
          const y = Y(t); if (y < pT || y > pPB) return;
          ctx.strokeStyle = 'rgba(224,160,48,0.75)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.moveTo(pL + (pR - pL) * 0.45, y); ctx.lineTo(pR, y); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#e0a030'; ctx.font = 'bold 8px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          ctx.fillText('PNF T' + (i + 1), pR - 2, y - 1);
        });
      }
    }
    // ---- WYCKOFF OLAY ETİKETLERİ (SolCJ): pivot mumlarda BC/AR/UT-B/UTAD veya SC/AR/ST/Spring + Test ----
    if (layers.mmModel && s.wyckoff && s.wyckoff.events) {
      const wy = s.wyckoff, wLong = wy.side === 'LONG';
      const fanCol = wLong ? 'rgba(79,168,224,0.6)' : 'rgba(224,68,75,0.55)';
      const P2 = ev => { const vi = gi(ev.i); if (vi < 0 || vi >= candles.length) return null; return { x: X(vi), y: ev.pos === 'top' ? Y(candles[vi].h) : Y(candles[vi].l) }; };
      // yelpaze: BC/SC pivotundan sweep pivotuna ince çizgi (CJ'nin kırmızı/mavi fan'ı)
      const f1 = wy.events.find(e => e.i === wy.fanFrom), f2 = wy.events.find(e => e.i === wy.fanTo);
      const p1 = f1 && P2(f1), p2 = f2 && P2(f2);
      if (p1 && p2) { ctx.strokeStyle = fanCol; ctx.lineWidth = 1.1; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
      // noktalı kavis: AR pivotundan sweep'e (CJ'nin accumulation/markdown eğrisi)
      const fa = wy.events.find(e => e.i === wy.arcFrom), pa = fa && P2(fa);
      if (pa && p2) { ctx.strokeStyle = 'rgba(200,208,220,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(p2.x - (p2.x - pa.x) * 0.15, pa.y, p2.x, p2.y); ctx.stroke(); ctx.setLineDash([]); }   // CJ parabolü: AR seviyesinde yatay gider, sweep'e dik yaklaşır
      // pivot etiketleri (CJ: küçük italik, tepede üstte / dipte altta; Spring/UTAD vurgulu)
      for (const evx of wy.events) {
        const p = P2(evx); if (!p) continue;
        ctx.fillStyle = evx.key ? T.manipL : '#d8dee6'; ctx.font = (evx.key ? 'bold ' : '') + 'italic 9px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = evx.pos === 'top' ? 'bottom' : 'top';
        ctx.fillText(evx.label, Math.min(Math.max(p.x, pL + 14), pR - 14), evx.pos === 'top' ? p.y - 3 : p.y + 3);
      }
      // model adı kutusu üst-orta (CJ: 'SW1-D 💫')
      const mn = wLong ? 'SW1-A · Accumulation' : 'SW1-D · Distribution';
      ctx.font = 'bold 10px Arial'; const mw = ctx.measureText(mn).width + 14, mx0 = (pL + pR) / 2 - mw / 2;
      ctx.fillStyle = 'rgba(11,14,19,0.75)'; ctx.fillRect(mx0, pT + 2, mw, 16);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(mx0, pT + 2, mw, 16);
      ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(mn, (pL + pR) / 2, pT + 10);
    }
    // ---- MARKET MAKER MODEL AŞAMALARI (DREYKO MMxM: Consolidation→Manipulation→SMR→Accum/Dist→Program→Completion) ----
    if (layers.mmModel && mp) {
      const long = mp.side === 'LONG';
      const col = long ? T.upBorder : T.downBorder;         // buy=yeşil, sell=kırmızı
      const boxFill = long ? 'rgba(38,162,105,0.10)' : 'rgba(224,68,75,0.10)';
      ctx.setLineDash([]);
      // ① Original Consolidation — sweep öncesi konsolidasyon kutusu (DREYKO: her iki yönde de YEŞİL çerçeve — GBP/ETH şablonu)
      if (mp.rangeFrom != null && mp.rangeTo != null && gi(mp.rangeTo) >= 0 && gi(mp.rangeFrom) < candles.length) {
        const xa = X(Math.max(0, gi(mp.rangeFrom))), xb = X(Math.min(candles.length - 1, gi(mp.rangeTo)));
        const yA = Y(mp.rangeHigh), yB = Y(mp.rangeLow), bx = Math.min(xa, xb), bw = Math.max(8, Math.abs(xb - xa));
        ctx.fillStyle = 'rgba(38,162,105,0.08)'; ctx.fillRect(bx, Math.min(yA, yB), bw, Math.abs(yB - yA));
        ctx.strokeStyle = '#26a269'; ctx.lineWidth = 1.2; ctx.setLineDash([]); ctx.strokeRect(bx, Math.min(yA, yB), bw, Math.abs(yB - yA));
        ctx.fillStyle = '#26a269'; ctx.font = 'italic bold 9px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('① Original Consolidation', bx + 2, Math.min(yA, yB) - 2);
      }
      // reclaim (Smart Money Reversal) x-konumu — sağ kenara sıkışmayı önle
      const rvi = gi(mp.at), rxRaw = (rvi >= 0 && rvi < candles.length) ? X(rvi) : pL + (pR - pL) * 0.4;
      const rx = Math.min(rxRaw, pR - 4), wy = Y(mp.wick);
      // ③ Smart Money Reversal — sweep'in soluna yaslı, Manipulation etiketinin ters tarafında
      ctx.fillStyle = col; ctx.font = 'italic bold 9px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = long ? 'bottom' : 'top';
      ctx.fillText('③ Smart Money Reversal', rx - 6, long ? wy - 8 : wy + 8);
      // Curve SOL tarafı — sadece setup yokken (setup varken tam kavis ⑤'te çizilir)
      if (!setup && mp.rangeTo != null) {
        const clx = X(Math.max(0, Math.min(candles.length - 1, gi(mp.rangeTo)))), cly = Y(long ? mp.rangeLow : mp.rangeHigh);
        ctx.strokeStyle = T.mm; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(clx, cly); ctx.quadraticCurveTo((clx + rx) / 2, wy, rx, wy); ctx.stroke(); ctx.setLineDash([]);
      }
      if (setup) {
        // ④ Accumulation / Distribution — reclaim bölgesi (sweep'in soluna doğru kutu, kenardan taşmaz)
        const accEdge = long ? mp.rangeLow : mp.rangeHigh, ay = Y(accEdge), aw = Math.max(cw * 4, 34), ah = Math.max(9, Math.abs(Y(mp.wick) - ay) * 0.5);
        const ax0 = Math.max(pL, rx - aw), ay0 = long ? ay : ay - ah;
        ctx.fillStyle = boxFill; ctx.fillRect(ax0, ay0, rx - ax0, ah);
        ctx.strokeStyle = col; ctx.lineWidth = 0.8; ctx.setLineDash([2, 2]); ctx.strokeRect(ax0, ay0, rx - ax0, ah); ctx.setLineDash([]);
        ctx.fillStyle = col; ctx.font = 'italic 9px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText('④ ' + (long ? 'Accumulation' : 'Distribution'), rx - 3, ay0 + ah / 2);
        // ⑤ Buy/Sell Program — MMxM CURVE (kanonik smile/frown): konsolidasyon kenarı → sweep apeksi → hedef, akıcı kavis
        const y1 = wy, x2 = pR, y2 = Y(setup.tps[setup.tps.length - 1]);
        const clx = mp.rangeTo != null ? X(Math.max(0, Math.min(candles.length - 1, gi(mp.rangeTo)))) : rx - cw * 6;
        const cly = Y(long ? mp.rangeLow : mp.rangeHigh);
        ctx.strokeStyle = T.mm; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(clx, cly);
        ctx.quadraticCurveTo((clx + rx) / 2, wy, rx, wy);            // apekse yuvarlak giriş (sol omuz)
        ctx.quadraticCurveTo(rx + (x2 - rx) * 0.45, wy, x2, y2);     // yuvarlak omuz → hedefe kavisli iniş/çıkış (sağ taraf)
        ctx.stroke();
        ctx.fillStyle = T.mm; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const plx = Math.min(Math.max(rx + (x2 - rx) * 0.4, pL + 40), pR - 40);
        ctx.fillText('⑤ ' + (long ? 'Buy Program · Buy-Curve' : 'Sell Program · Sell-Curve'), plx, (y1 + y2) / 2 + (long ? 24 : -24));
        // ⑥ Terminus/Completion → hedef (kanonik MMxM: programın son bacağı)
        ctx.fillStyle = T.mm; ctx.font = 'italic bold 9px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = long ? 'bottom' : 'top'; ctx.fillText('⑥ Terminus / Completion → Hedef', x2 - 3, y2 + (long ? -4 : 4));
      }
    }

    // ENTRY/SL/TP
    if (layers.trade && setup) {
      const pending = setup.entryStatus === 'pending';
      let xStart = pR - (pR - pL) * 0.30;
      if (setup.originAt != null) { const vi = gi(setup.originAt); if (vi >= 0 && vi < candles.length) xStart = X(vi); }
      xStart = Math.min(xStart, pR - (pR - pL) * 0.12); xStart = Math.max(xStart, pL + (pR - pL) * 0.40);
      if (pending) {
        const y = Y(setup.entry); ctx.strokeStyle = T.entry; ctx.lineWidth = 1.4; ctx.setLineDash([7, 4]); ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pR, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = T.entry; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('GİRİŞ (plan)', pL + (pR - pL) * 0.45, y - 2); rightTag(setup.entry, T.entry, fmt(setup.entry));
      } else {
        const yE = Y(setup.entry), yS = Y(setup.stop), yT = Y(setup.tps[setup.tps.length - 1]), boxW = pR - xStart;
        ctx.fillStyle = T.rewardZone; ctx.fillRect(xStart, Math.min(yE, yT), boxW, Math.abs(yT - yE));
        ctx.fillStyle = T.riskZone; ctx.fillRect(xStart, Math.min(yE, yS), boxW, Math.abs(yS - yE));
        const line = (p, color, label, dash) => { const y = Y(p); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(xStart, y); ctx.lineTo(pR, y); ctx.stroke(); ctx.setLineDash([]); rightTag(p, color, label); };
        line(setup.entry, T.entry, 'GİRİŞ'); line(setup.stop, T.sl, 'SL');
        setup.tps.forEach((t, i) => line(t, T.tp, 'TP' + (i + 1) + ' $$$', [5, 3]));
      }
      // JB: OTE 0.618–0.786 bölgesi (gri-mavi gölge) + HOB (gizli OB) pembe bandı
      if (s.ote) {
        const yA = Y(s.ote.top), yB = Y(s.ote.bottom);
        if (Math.min(yA, yB) < pPB && Math.max(yA, yB) > pT) {
          ctx.fillStyle = 'rgba(120,150,200,0.10)'; ctx.fillRect(xStart, Math.max(pT, Math.min(yA, yB)), pR - xStart, Math.min(pPB, Math.max(yA, yB)) - Math.max(pT, Math.min(yA, yB)));
          ctx.fillStyle = 'rgba(150,175,215,0.85)'; ctx.font = 'italic 8px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('OTE 0.618–0.786 (JB)', pR - 2, Math.max(pT, Math.min(yA, yB)) + 1);
        }
      }
      if (s.hob) {
        const yA = Y(s.hob.top), yB = Y(s.hob.bottom);
        if (Math.min(yA, yB) < pPB && Math.max(yA, yB) > pT) {
          ctx.fillStyle = 'rgba(224,100,140,0.13)'; ctx.fillRect(xStart, Math.max(pT, Math.min(yA, yB)), pR - xStart, Math.min(pPB, Math.max(yA, yB)) - Math.max(pT, Math.min(yA, yB)));
          ctx.fillStyle = 'rgba(230,130,160,0.9)'; ctx.font = 'italic bold 8px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('HOB', xStart + 3, Math.min(pPB, Math.max(yA, yB)) - 1);
        }
      }
      // yigit girişi: kazanılan FVG'nin retesti (CE) — kesikli mavi
      if (setup.altEntry) {
        const y = Y(setup.altEntry);
        if (y > pT && y < pPB) {
          ctx.strokeStyle = '#4fa8e0'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xStart, y); ctx.lineTo(pR, y); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#4fa8e0'; ctx.font = '9px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('FVG retest (yigit girişi)', xStart + 4, y - 2);
        }
      }
    }

    // son fiyat
    const lastVis = candles[candles.length - 1], yL = Y(lastVis.c);
    ctx.strokeStyle = '#aeb6c2'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(pL, yL); ctx.lineTo(pR, yL); ctx.stroke(); ctx.setLineDash([]);

    // ---- OPEN INTEREST PANELİ ----
    if (oiR) {
      const oiArr = s.oi; let j = 0, cur = null; const vals = [];
      for (let i = 0; i < candles.length; i++) { while (j < oiArr.length && oiArr[j].t <= candles[i].t) { cur = oiArr[j].oi; j++; } vals.push(cur); }
      const valid = vals.filter(v => v != null); if (valid.length) {
        const omin = Math.min(...valid), omax = Math.max(...valid), rng = (omax - omin) || omax * 0.01;
        const OY = v => oiR.b - (v - omin) / rng * (oiR.b - oiR.t - 4) - 2;
        ctx.strokeStyle = T.oiLine; ctx.lineWidth = 1.3; ctx.beginPath(); let st = false;
        for (let i = 0; i < candles.length; i++) { const v = vals[i]; if (v == null) { st = false; continue; } const x = X(i), y = OY(v); if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y); } ctx.stroke();
        ctx.fillStyle = T.axisDim; ctx.font = '9px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const oiS = s.oiState; ctx.fillText('Open Interest' + (oiS ? '  ' + fmtK(oiS.last) : ''), pL + 2, oiR.t + 1);
        if (oiS && oiS.bigDrop) {
          ctx.fillStyle = T.oiDrop; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'right'; ctx.fillText('BIG OI DROP %' + oiS.dropPct + ' → program değişimi', pR - 2, oiR.t + 1);
          // Drop bölgesini çerçevele (DREYKO Euro FX şablonu: OI panelinde dikdörtgen kutu)
          let mi = -1, mv = -Infinity; const from = Math.max(0, candles.length - 20);
          for (let i = from; i < candles.length; i++) { const v = vals[i]; if (v != null && v > mv) { mv = v; mi = i; } }
          if (mi >= 0) { const x0 = X(mi) - cw / 2, x1 = X(candles.length - 1) + cw / 2; ctx.strokeStyle = '#c9d1d9'; ctx.lineWidth = 1; ctx.strokeRect(x0, oiR.t + 12, Math.max(10, x1 - x0), oiR.b - oiR.t - 14); }
        }
      }
    }

    // CROSSHAIR
    let hov = null;
    if (this.mouse && this.mouse.x > pL && this.mouse.x < pR && this.mouse.y > pT && this.mouse.y < pB) {
      const mx = this.mouse.x, my = this.mouse.y;
      const vi = Math.max(0, Math.min(candles.length - 1, Math.round((mx - pL) / cw - 0.5)));
      hov = candles[vi]; const cx = X(vi);
      ctx.strokeStyle = T.cross; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(cx, pT); ctx.lineTo(cx, pB); ctx.stroke();
      if (my < pPB) { ctx.beginPath(); ctx.moveTo(pL, my); ctx.lineTo(pR, my); ctx.stroke(); ctx.fillStyle = T.crossTag; ctx.fillRect(pR, my - 8, P.r, 16); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(fmt(Yinv(my)), pR + 4, my); }
      ctx.setLineDash([]);
      ctx.fillStyle = T.crossTag; const tw = 78; ctx.fillRect(Math.min(Math.max(cx - tw / 2, pL), pR - tw), pB + 2, tw, 15); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(tlabelFull(hov.t), Math.min(Math.max(cx, pL + tw / 2), pR - tw / 2), pB + 4);
    }

    // ---- MMxM AŞAMA LEJANTI (DREYKO: modelin sırası her zaman okunur) ----
    if (layers.mmModel && s.manipulation && setup) {
      const lgLong = s.manipulation.side === 'LONG', lc = lgLong ? T.upBorder : T.downBorder;
      const rows = ['① Original Consolidation', '② Manipulation (Judas · Turtle Soup)', '③ Smart Money Reversal (CISD)', '④ ' + (lgLong ? 'Accumulation' : 'Distribution') + ' (1. bacak)', '⑤ ' + (lgLong ? 'Buy Program (Re-Accum)' : 'Sell Program (Re-Dist)'), '⑥ Terminus/Completion → hedef', 'Wyckoff: ' + (lgLong ? 'Spring → Test → SOS' : 'UTAD → Test → SOW')];
      const lw = 188, lh = 18 + rows.length * 12, lx = pL + 8, ly = pT + 6;
      ctx.fillStyle = 'rgba(11,14,19,0.74)'; ctx.fillRect(lx, ly, lw, lh);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.strokeRect(lx, ly, lw, lh);
      ctx.fillStyle = lc; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('MARKET MAKER ' + (lgLong ? 'BUY' : 'SELL') + ' MODEL', lx + 6, ly + 4);
      ctx.font = '9px Arial'; ctx.fillStyle = '#c9d1d9'; rows.forEach((r, i) => ctx.fillText(r, lx + 6, ly + 18 + i * 12));
      // Beklenen yapı mini şeması (DREYKO SOL 1s şablonu: çerçeveli kutu + el-çizimi zigzag + italik etiket)
      const bw2 = 128, bh2 = 44, bx2 = pR - bw2 - 8, by2 = pT + 22, zcol = lgLong ? '#3b82f6' : '#c25a63';
      ctx.strokeStyle = zcol; ctx.lineWidth = 1; ctx.strokeRect(bx2, by2, bw2, bh2);
      ctx.beginPath(); const zx0 = bx2 + 8, zw2 = bw2 - 46;
      for (let k = 0; k <= 8; k++) { const zx = zx0 + zw2 * k / 8; const base = lgLong ? by2 + bh2 - 9 - (bh2 - 18) * k / 8 : by2 + 9 + (bh2 - 18) * k / 8; const zy = base + (k % 2 ? -4 : 4); if (k === 0) ctx.moveTo(zx, zy); else ctx.lineTo(zx, zy); }
      ctx.stroke();
      ctx.fillStyle = zcol; ctx.font = 'italic 8px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(lgLong ? 'Re-Accumulation' : 'Re-Distribution', bx2 + bw2 - 3, by2 + bh2 / 2);
    }
    ctx.restore();

    // sağ fiyat ekseni + alt zaman
    ctx.font = '11px Arial'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let k = 0; k <= 6; k++) { const p = min + (max - min) * (1 - k / 6); ctx.fillStyle = T.axisDim; ctx.fillText(fmt(p), pR + 6, pT + (pPB - pT) * k / 6); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.floor(candles.length / 9));
    for (let i = 0; i < candles.length; i += step) { ctx.fillStyle = T.axisDim; ctx.fillText(tlabel(candles[i].t, data.interval), X(i), pB + 5); }
    rightTag(lastVis.c, '#3a4150', fmt(lastVis.c));

    // başlık + bias kutusu
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = T.axis; ctx.font = 'bold 12px Arial';
    ctx.fillText((data.symbol || '') + ' · ' + (data.interval || '') + ' · MEXC', 8, 14);
    const trMap = { Bullish: 'BOĞA', Bearish: 'AYI', Neutral: 'NÖTR' };
    ctx.font = '11px Arial'; ctx.fillStyle = '#9aa4b2';
    const oh = hov ? ('O ' + fmt(hov.o) + ' H ' + fmt(hov.h) + ' L ' + fmt(hov.l) + ' C ' + fmt(hov.c) + '   ') : '';
    const mm = s.mmModel ? ('MM ' + s.mmModel + ' Model' + (s.mmxm ? ' · MMxM ' + s.mmxm.score + '/' + s.mmxm.max + (s.mmxm.valid ? ' ✓' : '') : '') + ' · ') : '';
    ctx.fillText(oh + mm + 'Bias: ' + (trMap[s.bias] || '-') + ' · RSI ' + (data.rsiNow != null ? data.rsiNow : '-'), 8, 26);

    ctx.textAlign = 'right'; ctx.font = '10px Arial';
    ctx.fillStyle = this.follow ? '#2ec27e' : '#d9a441';
    ctx.fillText(this.follow ? '● CANLI' : '⏸ kaydırıldı (çift tık: sıfırla)', pR, 14);
  };

  global.SMCChart = Chart;
})(window);
