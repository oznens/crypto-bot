/*
 * server.js — Saf Node.js (stdlib) sunucu. npm install GEREKMEZ.
 * - MEXC spot kline/ticker proxy (CORS + normalize)
 * - SMC analiz motoru (analysis.js)
 * - Otomatik tarama: top semboller arasında A+/A setup arar
 * - public/ altındaki web panelini servis eder
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { analyze } = require('./analysis');

const PORT = process.env.PORT || 5188;
const MEXC = 'https://api.mexc.com';
const PUBLIC = path.join(__dirname, 'public');

// MEXC geçerli intervaller
const INTERVALS = { '1m': 1, '5m': 1, '15m': 1, '30m': 1, '60m': 1, '4h': 1, '1d': 1 };

// ----------------------------- basit cache -----------------------------
const cache = new Map();
function cacheGet(key, ttl) {
  const v = cache.get(key);
  if (v && Date.now() - v.t < ttl) return v.d;
  return null;
}
function cacheSet(key, d) { cache.set(key, { t: Date.now(), d }); }

// ----------------------------- MEXC fetch -----------------------------
function fetchOnce(u) {
  return new Promise((resolve, reject) => {
    const req = https.get(u, { headers: { 'User-Agent': 'smc-bot/1.0', 'Accept': 'application/json' }, timeout: 15000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ' ' + data.slice(0, 120)));
          resolve(JSON.parse(data));
        } catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// geçici hatalara (429/timeout/ağ) karşı küçük backoff'lu yeniden deneme -> "hatasız"
async function fetchJSON(u, tries) {
  tries = tries || 3;
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fetchOnce(u); }
    catch (e) { err = e; await new Promise(r => setTimeout(r, 250 * (i + 1))); }
  }
  throw err;
}

async function getKlines(symbol, interval, limit, ttl) {
  limit = limit || 500;
  const key = 'k:' + symbol + ':' + interval + ':' + limit;
  const c = cacheGet(key, ttl != null ? ttl : 20000); // varsayılan 20sn; canlı WS için kısa
  if (c) return c;
  const u = `${MEXC}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const raw = await fetchJSON(u);
  if (!Array.isArray(raw)) throw new Error('beklenmeyen kline yanıtı');
  const candles = raw.map(r => ({
    t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5]
  })).filter(x => isFinite(x.c) && x.c > 0);
  cacheSet(key, candles);
  return candles;
}

// Binance futures Open Interest geçmişi (DREYKO imza paneli). MEXC spot'ta OI yok -> Binance fapi.
async function getOI(symbol, interval, limit, ttl) {
  const period = { '1m': '5m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '1h', '4h': '4h', '1d': '1d' }[interval] || '4h';
  const key = 'oi:' + symbol + ':' + period + ':' + (limit || 200);
  const c = cacheGet(key, ttl != null ? ttl : 60000);
  if (c) return c;
  try {
    const raw = await fetchJSON('https://fapi.binance.com/futures/data/openInterestHist?symbol=' + symbol + '&period=' + period + '&limit=' + (limit || 200));
    if (!Array.isArray(raw) || !raw.length) return null;
    const oi = raw.map(r => ({ t: +r.timestamp, oi: +r.sumOpenInterest })).filter(x => isFinite(x.oi));
    cacheSet(key, oi); return oi;
  } catch (e) { return null; }
}

// GERÇEK MMxM filtresi için alt zaman dilimi (LTF) mumları: CISD+MSS onayı analysis.mmxmFilter'da aranır
const LTF_MAP = { '5m': '1m', '15m': '5m', '30m': '5m', '60m': '15m', '4h': '15m', '1d': '60m' };
async function getLTF(symbol, interval) {
  const ltfIv = LTF_MAP[interval];
  if (!ltfIv) return null;
  try { return { interval: ltfIv, candles: await getKlines(symbol, ltfIv, 500, 30000) }; }
  catch (e) { return null; }
}

async function getSymbols(limit) {
  limit = limit || 40;
  const key = 'symbols:' + limit;
  const c = cacheGet(key, 120000); // 2dk
  if (c) return c;
  const raw = await fetchJSON(`${MEXC}/api/v3/ticker/24hr`);
  // sabit/stablecoin ve garip pariteleri ele
  const skip = /^(USDC|USDE|EUR|TUSD|FDUSD|DAI|BUSD|USTC|GUSD|PAX)/i;
  const list = (Array.isArray(raw) ? raw : [])
    .filter(x => x.symbol && x.symbol.endsWith('USDT') && !skip.test(x.symbol) && !/\d{3,}/.test(x.symbol))
    .map(x => ({
      symbol: x.symbol,
      base: x.symbol.replace(/USDT$/, ''),
      quoteVolume: parseFloat(x.quoteVolume) || 0,
      lastPrice: parseFloat(x.lastPrice) || 0,
      changePct: parseFloat(x.priceChangePercent) * (Math.abs(parseFloat(x.priceChangePercent)) < 1 ? 100 : 1) || 0
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);
  cacheSet(key, list);
  return list;
}

// ----------------------------- tarama -----------------------------
async function scan(interval, count) {
  count = count || 30;
  const key = 'scan:' + interval + ':' + count;
  const c = cacheGet(key, 45000); // 45sn
  if (c) return c;
  const syms = await getSymbols(count);
  const results = [];
  const batch = 5;
  for (let i = 0; i < syms.length; i += batch) {
    const chunk = syms.slice(i, i + batch);
    const out = await Promise.all(chunk.map(async s => {
      try {
        const candles = await getKlines(s.symbol, interval, 400);
        let a = analyze(candles, { interval, symbol: s.symbol });   // ilk geçiş OI/LTF'siz (hız)
        if (a.setup) {
          // setup varsa GERÇEK MMxM filtresi için LTF çek (30sn cache) ve yeniden değerlendir —
          // backtest: LTF onaysız setuplar negatif beklentili, listede damgasız görünmesinler
          const ltf = await getLTF(s.symbol, interval);
          if (ltf) a = analyze(candles, { interval, symbol: s.symbol, ltf });
        }
        if (a.setup) {
          return {
            symbol: s.symbol, base: s.base, interval,
            lastPrice: a.lastPrice, rsi: a.rsiNow, trend: a.structures.trend, htfBias: a.htfBias,
            ...a.setup
          };
        }
      } catch (e) { /* tek sembol hatası taramayı durdurmasın */ }
      return null;
    }));
    results.push(...out.filter(Boolean));
    await new Promise(r => setTimeout(r, 120)); // nazik rate-limit
  }
  const order = { 'A+': 3, 'A': 2, 'B': 1 };
  const real = x => (x.mmxm && x.mmxm.valid) ? 1 : 0;   // GERÇEK MMxM ✓ en üste
  results.sort((a, b) => (real(b) - real(a)) || (order[b.grade] - order[a.grade]) || (b.confidence - a.confidence));
  cacheSet(key, results);
  return results;
}

// ----------------------------- HTTP -----------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const q = u.query;
  try {
    if (u.pathname === '/api/symbols') {
      const list = await getSymbols(Math.min(100, +q.limit || 40));
      return sendJSON(res, 200, { symbols: list });
    }
    if (u.pathname === '/api/analyze') {
      const symbol = (q.symbol || 'BTCUSDT').toUpperCase();
      const interval = INTERVALS[q.interval] ? q.interval : '15m';
      const candles = await getKlines(symbol, interval, Math.min(1000, +q.limit || 500));
      const oi = await getOI(symbol, interval, 200).catch(() => null);
      const ltf = await getLTF(symbol, interval);
      const a = analyze(candles, { interval, symbol, oi, ltf });
      a.symbol = symbol; a.interval = interval;
      return sendJSON(res, 200, a);
    }
    if (u.pathname === '/api/scan') {
      const interval = INTERVALS[q.interval] ? q.interval : '15m';
      const list = await scan(interval, Math.min(60, +q.count || 30));
      return sendJSON(res, 200, { interval, count: list.length, results: list, ts: Date.now() });
    }
    if (u.pathname === '/api/backtest') {
      // mmxm_backtest.js çıktısı (node mmxm_backtest.js ile üretilir)
      const fp = path.join(__dirname, 'backtest_sonuc.txt');
      if (!fs.existsSync(fp)) return sendJSON(res, 200, { ok: false, text: 'Henüz backtest koşulmadı.\n\nÇalıştırmak için terminalde:\n  cd C:\\Users\\NS\\crypto-bot\n  node mmxm_backtest.js\n\n(~2 dk sürer; bitince sonuç burada görünür.)' });
      const st = fs.statSync(fp);
      return sendJSON(res, 200, { ok: true, mtime: st.mtimeMs, text: fs.readFileSync(fp, 'utf8') });
    }
    if (u.pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'bilinmeyen uç nokta' });
    // Paper trading panosu (docs/) — lokalden de izlenebilsin
    if (u.pathname === '/paper' || u.pathname === '/paper/') {
      try { const b = fs.readFileSync(path.join(__dirname, 'docs', 'index.html')); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(b); }
      catch (e) { return sendJSON(res, 404, { error: 'pano yok' }); }
    }
    if (u.pathname === '/paper_state.json') {
      try { const b = fs.readFileSync(path.join(__dirname, 'docs', 'paper_state.json')); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(b); }
      catch (e) { return sendJSON(res, 404, { error: 'state yok' }); }
    }
    return serveStatic(res, u.pathname);
  } catch (e) {
    return sendJSON(res, 502, { error: e.message || String(e) });
  }
});

// ----------------------------- WebSocket (saf Node, npm yok) -----------------------------
// Tarayıcı /ws'e bağlanır, {type:'subscribe',symbol,interval} gönderir.
// Sunucu o sembol+interval için ~1.2sn'de bir MEXC'ten taze veri çekip analiz sonucunu push eder.
const wsClients = new Set();

function wsAccept(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}
function wsSend(socket, str) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  try { socket.write(Buffer.concat([header, payload])); } catch (e) {}
}
function wsClose(socket) { try { socket.write(Buffer.from([0x88, 0])); socket.end(); } catch (e) {} }

function parseFrames(client) {
  let buf = client.buf;
  while (buf.length >= 2) {
    const opcode = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    let mask;
    if (masked) { if (buf.length < off + 4) break; mask = buf.slice(off, off + 4); off += 4; }
    if (buf.length < off + len) break;
    let payload = buf.slice(off, off + len);
    if (masked) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
    buf = buf.slice(off + len);
    if (opcode === 0x8) { client.socket.destroy(); return; }            // close
    else if (opcode === 0x9) { try { client.socket.write(Buffer.from([0x8a, 0])); } catch (e) {} } // ping->pong
    else if (opcode === 0x1) {                                          // text
      try {
        const m = JSON.parse(payload.toString());
        if (m.type === 'subscribe' && m.symbol) {
          const interval = INTERVALS[m.interval] ? m.interval : '15m';
          client.sub = { symbol: String(m.symbol).toUpperCase(), interval };
          pushOne(client);                                             // hemen bir kez gönder
        }
      } catch (e) {}
    }
  }
  client.buf = buf;
}

async function pushOne(client) {
  if (!client.sub) return;
  const { symbol, interval } = client.sub;
  try {
    const candles = await getKlines(symbol, interval, 500, 500); // 0.5sn cache = canlı
    const oi = await getOI(symbol, interval, 200, 30000).catch(() => null);
    const ltf = await getLTF(symbol, interval);
    const a = analyze(candles, { interval, symbol, oi, ltf }); a.symbol = symbol; a.interval = interval;
    if (client.sub && client.sub.symbol === symbol && client.sub.interval === interval)
      wsSend(client.socket, JSON.stringify({ type: 'analyze', data: a }));
  } catch (e) {}
}

server.on('upgrade', (req, socket) => {
  if (url.parse(req.url).pathname !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n');
  const client = { socket, buf: Buffer.alloc(0), sub: null };
  wsClients.add(client);
  socket.on('data', d => { client.buf = Buffer.concat([client.buf, d]); parseFrames(client); });
  socket.on('close', () => wsClients.delete(client));
  socket.on('error', () => { wsClients.delete(client); try { socket.destroy(); } catch (e) {} });
});

// tek bir paylaşımlı poller — her abone sembol+interval için tek fetch (1.2sn)
setInterval(async () => {
  if (!wsClients.size) return;
  const groups = new Map(); // "symbol|interval" -> [clients]
  for (const c of wsClients) { if (!c.sub) continue; const k = c.sub.symbol + '|' + c.sub.interval; (groups.get(k) || groups.set(k, []).get(k)).push(c); }
  for (const [k, cs] of groups) {
    const [symbol, interval] = k.split('|');
    try {
      const candles = await getKlines(symbol, interval, 500, 500);
      const oi = await getOI(symbol, interval, 200, 30000).catch(() => null);
      const ltf = await getLTF(symbol, interval);
      const a = analyze(candles, { interval, symbol, oi, ltf }); a.symbol = symbol; a.interval = interval;
      const msg = JSON.stringify({ type: 'analyze', data: a });
      for (const c of cs) wsSend(c.socket, msg);
    } catch (e) {}
  }
}, 600);

server.listen(PORT, () => {
  console.log('\n  SMC Kripto Botu çalışıyor:  http://localhost:' + PORT + '\n');
  console.log('  Veri kaynağı: MEXC spot   |   Stil: yigitalagozoglu (SMC/ICT)\n');
});
