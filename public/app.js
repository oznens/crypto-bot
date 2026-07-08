/* app.js — panel mantığı: tarama döngüsü, alarm, grafik + setup render */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const chart = new SMCChart($('#chart'));
  let lastSignature = new Set();   // yeni setup tespiti için
  let timer = null;
  let active = null;               // seçili sembol
  let loadToken = 0;               // yarış koruması: sadece en son istek render edilir
  let lastData = null;             // katman toggle'ında refetch olmadan yeniden çiz

  function getLayers() {
    const o = {};
    document.querySelectorAll('#layers input[data-layer]').forEach(i => o[i.dataset.layer] = i.checked);
    return o;
  }
  function redraw() { if (lastData) chart.render(lastData, getLayers()); }

  // ---- WebAudio bip (harici dosya yok) ----
  let actx;
  function beep() {
    if (!$('#sound').checked) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.connect(g); g.connect(actx.destination);
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.4);
      o.start(); o.stop(actx.currentTime + 0.42);
    } catch (e) {}
  }

  function fmt(v) {
    const a = Math.abs(v);
    let d = a >= 1000 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  async function api(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error('API ' + r.status);
    return r.json();
  }

  // ---- semboller (arama) ----
  async function loadSymbols() {
    try {
      const d = await api('/api/symbols?limit=80');
      const dl = $('#symList');
      dl.innerHTML = d.symbols.map(s => '<option value="' + s.symbol + '">').join('');
    } catch (e) {}
  }

  // ---- tarama ----
  function gradeClass(g) { return g === 'A+' ? 'grade' : g === 'A' ? 'gradeA' : 'gradeB'; }
  function wyckoffName(m, side) { const long = side === 'LONG'; if (m === 'Turtle Soup' || m === 'PO3 / Range') return long ? 'SW-A' : 'SW-D'; if (m === 'FVG/OB Retest') return long ? 'RA' : 'MMC'; return m; }
  function biasTr(b) { return (b === 'up' || b === 'Bullish') ? 'BOĞA' : (b === 'down' || b === 'Bearish') ? 'AYI' : 'NÖTR'; }

  async function doScan(manual) {
    const interval = $('#interval').value;
    const count = $('#count').value;
    $('#scanStatus').textContent = 'taranıyor…';
    try {
      const d = await api('/api/scan?interval=' + interval + '&count=' + count);
      renderResults(d.results, interval);
      const aplus = d.results.filter(r => r.grade === 'A+' || r.grade === 'A');
      $('#scanStatus').textContent = d.results.length + ' setup · ' + new Date().toLocaleTimeString('tr-TR');

      // yeni A+/A var mı?
      const sig = new Set(aplus.map(r => r.symbol + r.side + r.grade));
      let isNew = false;
      sig.forEach(x => { if (!lastSignature.has(x)) isNew = true; });
      if (isNew && lastSignature.size > 0) beep();
      lastSignature = sig;
    } catch (e) {
      $('#scanStatus').textContent = 'hata: ' + e.message;
    }
  }

  function renderResults(list, interval) {
    const el = $('#results');
    if (!list.length) { el.innerHTML = '<div class="empty" style="color:#9a9c84;padding:10px">Şu an A+/A/B setup yok — piyasa izleme modunda. (likidite süpürmesi bekleniyor)</div>'; return; }
    el.innerHTML = list.map(r => {
      const cls = r.side === 'LONG' ? 'long' : 'short';
      const isActive = active && active.symbol === r.symbol ? ' active' : '';
      const isHarm = /Harmonik/.test(r.model || '');
      const modelTag = '<span class="tag ' + (isHarm ? 'ts' : 'model') + '">' + (r.model || '') + '</span>';
      const htfTag = r.htfBias && r.htfBias !== 'range' && r.htfBias !== 'Neutral' ? '<span class="tag htf">Bias ' + biasTr(r.htfBias) + '</span>' : '';
      const mxTag = r.mmxm ? (r.mmxm.valid
        ? '<span class="tag gradeA">MMxM ' + r.mmxm.score + '/' + r.mmxm.max + ' ✓</span>'
        : '<span class="tag htf" title="LTF onayı yok — backtest beklentisi negatif">MMxM ' + r.mmxm.score + '/' + r.mmxm.max + '</span>') : '';
      return '<div class="card ' + cls + isActive + '" data-sym="' + r.symbol + '">' +
        '<div class="row1"><span class="sym">' + r.base + '<small style="color:#9a9c84">/USDT</small></span>' +
        '<span class="badges"><span class="tag ' + cls + '">' + r.side + '</span>' +
        '<span class="tag ' + gradeClass(r.grade) + '">' + r.grade + '</span></span></div>' +
        '<div class="row1" style="margin-top:5px">' + modelTag + htfTag + mxTag + '</div>' +
        '<div class="row2"><span>Giriş ' + fmt(r.entry) + '</span><span>R/R ' + r.rr + '</span><span>RSI ' + (r.rsi != null ? r.rsi : '-') + '</span></div>' +
        '<div class="conf"><i style="width:' + r.confidence + '%"></i></div>' +
        '</div>';
    }).join('');
    el.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => loadSymbol(c.dataset.sym)));
  }

  // ---- tek sembol analizi + grafik ----
  async function loadSymbol(symbol) {
    const interval = $('#interval').value;
    const isNew = !active || active.symbol !== symbol || active.interval !== interval;
    const token = ++loadToken;
    active = { symbol, interval };
    wsSubscribe();                       // canlı akışı bu sembole çevir
    if (isNew) chart.resetView();        // yeni sembol/zaman dilimi -> zoom/kaydırma sıfırla
    $('#panel').innerHTML = '<div class="empty">' + symbol + ' analiz ediliyor…</div>';
    try {
      const d = await api('/api/analyze?symbol=' + symbol + '&interval=' + interval);
      if (token !== loadToken) return;   // daha yeni bir istek başladı -> bu sonucu yok say
      document.querySelectorAll('.card').forEach(c =>
        c.classList.toggle('active', c.dataset.sym === symbol));
      lastData = d;
      chart.render(d, getLayers());
      renderPanel(d);
    } catch (e) {
      if (token !== loadToken) return;
      $('#panel').innerHTML = '<div class="empty">Hata: ' + e.message + '</div>';
    }
  }

  // ---- canlı: WebSocket (gerçek zamanlı push) + fallback polling ----
  let ws = null, wsReady = false;
  function applyLive(d) {
    if (!active || !d || d.symbol !== active.symbol || d.interval !== active.interval) return;
    lastData = d;
    chart.render(d, getLayers());        // chart view state'i korur (canlı + pan/zoom)
    renderPanel(d);
  }
  function wsSubscribe() {
    if (ws && wsReady && active) { try { ws.send(JSON.stringify({ type: 'subscribe', symbol: active.symbol, interval: active.interval })); } catch (e) {} }
  }
  function connectWS() {
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      ws.onopen = () => { wsReady = true; wsSubscribe(); };
      ws.onmessage = ev => { try { const m = JSON.parse(ev.data); if (m.type === 'analyze') applyLive(m.data); } catch (e) {} };
      ws.onclose = () => { wsReady = false; setTimeout(connectWS, 2000); };  // otomatik yeniden bağlan
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    } catch (e) { setTimeout(connectWS, 3000); }
  }
  // WS düşükse 5sn'de bir REST ile canlı tut (fallback)
  let liveBusy = false;
  async function refreshActive() {
    if (!active || liveBusy || wsReady) return;
    const { symbol, interval } = active;
    liveBusy = true;
    try {
      const d = await api('/api/analyze?symbol=' + symbol + '&interval=' + interval);
      applyLive(d);
    } catch (e) {} finally { liveBusy = false; }
  }

  function mirazBlock(d) {
    if (!d.comment) return '';
    const ls = d.comment.split('\n');
    return '<div class="miraz"><b class="mz-cap">⚡ Sistem Yorumu (DREYKO ICT+OI × yigit SMC)</b>' +
      '<div class="mz-title">' + ls[0] + '</div>' +
      ls.slice(1).map(l => '<div class="mz-line">' + l + '</div>').join('') + '</div>';
  }
  function renderPanel(d) {
    const p = $('#panel');
    const s = d.setup;
    if (!s) {
      const mx0 = d.structures && d.structures.mmxm;
      const watch = mx0 ? '<b style="font-size:12px;color:#9a9c84">MMxM ön-izleme (' + mx0.score + '/' + mx0.max + '):</b>' +
        '<ul class="reasons">' + mx0.checks.map(c => '<li style="color:' + (c.ok ? '#5fd99a' : '#f08a8a') + '">' + (c.ok ? '✓' : '✗') + ' ' + c.name + '</li>').join('') + '</ul>' : '';
      p.innerHTML = '<div class="sp-head"><span class="sym">' + d.symbol + '</span>' +
        '<span style="color:#9a9c84">' + d.interval + ' · Yapı: ' + (d.structures.trend || '-') + ' · Bias: ' + biasTr(d.htfBias) + ' · RSI ' + (d.rsiNow != null ? d.rsiNow : '-') + '</span></div>' +
        '<div class="empty">Setup yok — <b>izleme modu</b>.</div>' +
        watch + mirazBlock(d);
      return;
    }
    const tps = s.tps.map((t, i) => '<div class="box"><div class="k">Hedef ' + (i + 1) + (i === 0 ? ' (range)' : ' (IPDA)') + '</div><div class="v green">' + fmt(t) + '</div></div>').join('');
    const isHarm = /Harmonik/.test(s.model || '');
    const htfChip = '<span class="tag htf">Üst vade: ' + biasTr(s.htfBias) +
      (s.htfAligned === true ? ' ✓' : s.htfAligned === false ? ' ✗' : '') + '</span>';
    // GERÇEK MMxM rozeti + HTF→LTF onay listesi
    const mx = d.structures && d.structures.mmxm;
    const mmxmChip = mx ? '<span class="tag ' + (mx.valid ? 'gradeA' : 'htf') + '">MMxM ' + mx.score + '/' + mx.max + (mx.valid ? ' ✓ GERÇEK' : '') + '</span>' : '';
    const mmxmList = mx ? '<b style="font-size:12px;color:#9a9c84">GERÇEK MMxM filtresi (HTF→LTF onay):</b>' +
      '<ul class="reasons">' + mx.checks.map(c => '<li style="color:' + (c.ok ? '#5fd99a' : '#f08a8a') + '">' + (c.ok ? '✓' : '✗') + ' ' + c.name + (c.state && !c.ok ? ' — ' + c.state : '') + '</li>').join('') + '</ul>' : '';
    p.innerHTML =
      '<div class="sp-head"><span class="sym">' + d.symbol + '</span>' +
      '<span class="tag ' + (s.side === 'LONG' ? 'long' : 'short') + '">' + s.side + '</span>' +
      '<span class="tag ' + gradeClass(s.grade) + '">' + s.grade + '</span>' +
      '<span class="tag ' + (isHarm ? 'ts' : 'model') + '">' + (s.model || '') + '</span>' +
      htfChip + mmxmChip +
      '<span style="color:#9a9c84">' + d.interval + ' · güven %' + s.confidence + '</span></div>' +
      '<div class="sp-grid">' +
      '<div class="box"><div class="k">Giriş</div><div class="v blue">' + fmt(s.entry) + '</div></div>' +
      (s.altEntry ? '<div class="box"><div class="k">Yigit girişi (FVG retest)</div><div class="v blue">' + fmt(s.altEntry) + '</div></div>' : '') +
      '<div class="box"><div class="k">Stop (SL)</div><div class="v red">' + fmt(s.stop) + '</div></div>' +
      tps +
      '<div class="box"><div class="k">R/R</div><div class="v">' + s.rr + '</div></div>' +
      '<div class="box"><div class="k">Risk</div><div class="v">%' + s.riskPct + '</div></div>' +
      '</div>' +
      '<b style="font-size:12px;color:#9a9c84">Gerekçe (confluence):</b>' +
      '<ul class="reasons">' + s.reasons.map(r => '<li>' + r + '</li>').join('') + '</ul>' +
      mmxmList +
      mirazBlock(d);
  }

  // ---- olaylar ----
  $('#scanNow').addEventListener('click', () => doScan(true));
  // 📊 Backtest sonuçları (mmxm_backtest.js çıktısı)
  $('#btBtn').addEventListener('click', async () => {
    $('#btOverlay').hidden = false; $('#btText').textContent = 'Yükleniyor…';
    try {
      const r = await (await fetch('/api/backtest')).json();
      $('#btText').textContent = r.text + (r.ok && r.mtime ? '\n\nSon koşum: ' + new Date(r.mtime).toLocaleString('tr-TR') : '');
    } catch (e) { $('#btText').textContent = 'Sonuç alınamadı: ' + e.message; }
  });
  $('#btClose').addEventListener('click', () => { $('#btOverlay').hidden = true; });
  $('#btOverlay').addEventListener('click', e => { if (e.target === $('#btOverlay')) $('#btOverlay').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#btOverlay').hidden = true; });
  $('#loadSym').addEventListener('click', () => {
    const v = $('#symInput').value.trim().toUpperCase();
    if (v) loadSymbol(v);
  });
  $('#symInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loadSym').click(); });
  $('#interval').addEventListener('change', () => { lastSignature = new Set(); doScan(); if (active) loadSymbol(active.symbol); });
  $('#count').addEventListener('change', () => doScan());
  $('#autoscan').addEventListener('change', setupTimer);
  document.querySelectorAll('#layers input[data-layer]').forEach(i => i.addEventListener('change', redraw));
  window.addEventListener('resize', redraw);

  // ---- tam ekran ----
  const chartwrap = document.querySelector('.chartwrap');
  function toggleFs() {
    const fn = (document.fullscreenElement || document.webkitFullscreenElement)
      ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
      : (chartwrap.requestFullscreen || chartwrap.webkitRequestFullscreen).call(chartwrap);
    if (fn && fn.catch) fn.catch(() => {});
  }
  $('#fsBtn').addEventListener('click', toggleFs);
  function onFsChange() { const fs = document.fullscreenElement || document.webkitFullscreenElement; $('#fsBtn').textContent = fs ? '✕' : '⛶'; setTimeout(redraw, 80); }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') toggleFs(); });

  function setupTimer() {
    if (timer) clearInterval(timer);
    if ($('#autoscan').checked) timer = setInterval(doScan, 60000);
  }

  // ---- başlat ----
  loadSymbols();
  doScan();
  setupTimer();
  connectWS();                        // gerçek zamanlı WebSocket akışı
  setInterval(refreshActive, 5000);   // WS düşerse fallback
  window.__chart = chart;             // hata ayıklama/test erişimi
  window.__stopLive = function () { try { if (ws) { ws.onclose = null; ws.close(); wsReady = false; } } catch (e) {} };
})();
