'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { analyze } = require('./analysis');
const { adapt } = require('./core/analysis_adapter');
const { detect: detectRegime } = require('./core/regime_detector');

const PORT = process.env.PORT || 5188;
const MEXC = 'https://api.mexc.com';
const PUBLIC = path.join(__dirname, 'public');
const INTERVALS = { '1m': 1, '5m': 1, '15m': 1, '30m': 1, '60m': 1, '4h': 1, '1d': 1 };
const LTF_MAP = { '5m': '1m', '15m': '5m', '30m': '5m', '60m': '15m', '4h': '15m', '1d': '60m' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const cache = new Map();
function cacheGet(key, ttl) {
  const value = cache.get(key);
  return value && Date.now() - value.t < ttl ? value.d : null;
}
function cacheSet(key, data) { cache.set(key, { t: Date.now(), d: data }); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function fetchOnce(target) {
  return new Promise((resolve, reject) => {
    const req = https.get(target, {
      headers: { 'User-Agent': 'smc-bot/4.6', Accept: 'application/json' },
      timeout: 15000
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} ${data.slice(0, 120)}`));
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`JSON parse: ${error.message}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchJSON(target, tries = 3) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt++) {
    try { return await fetchOnce(target); }
    catch (error) { lastError = error; await sleep(250 * (attempt + 1)); }
  }
  throw lastError;
}

async function getKlines(symbol, interval, limit = 500, ttl = 20000) {
  const key = `k:${symbol}:${interval}:${limit}`;
  const cached = cacheGet(key, ttl);
  if (cached) return cached;
  const raw = await fetchJSON(`${MEXC}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  if (!Array.isArray(raw)) throw new Error('beklenmeyen kline yanıtı');
  const candles = raw.map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
    .filter(c => Number.isFinite(c.c) && c.c > 0);
  cacheSet(key, candles);
  return candles;
}

async function getOI(symbol, interval, limit = 200, ttl = 60000) {
  const period = { '1m': '5m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '1h', '4h': '4h', '1d': '1d' }[interval] || '4h';
  const key = `oi:${symbol}:${period}:${limit}`;
  const cached = cacheGet(key, ttl);
  if (cached) return cached;
  try {
    const raw = await fetchJSON(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`);
    if (!Array.isArray(raw) || !raw.length) return null;
    const oi = raw.map(r => ({ t: +r.timestamp, oi: +r.sumOpenInterest })).filter(x => Number.isFinite(x.oi));
    cacheSet(key, oi);
    return oi;
  } catch (_) { return null; }
}

async function getLTF(symbol, interval) {
  const ltfInterval = LTF_MAP[interval];
  if (!ltfInterval) return null;
  try { return { interval: ltfInterval, candles: await getKlines(symbol, ltfInterval, 500, 30000) }; }
  catch (_) { return null; }
}

async function getSymbols(limit = 40) {
  const key = `symbols:${limit}`;
  const cached = cacheGet(key, 120000);
  if (cached) return cached;
  const raw = await fetchJSON(`${MEXC}/api/v3/ticker/24hr`);
  const skip = /^(USDC|USDE|EUR|TUSD|FDUSD|DAI|BUSD|USTC|GUSD|PAX)/i;
  const list = (Array.isArray(raw) ? raw : [])
    .filter(x => x.symbol && x.symbol.endsWith('USDT') && !skip.test(x.symbol) && !/\d{3,}/.test(x.symbol))
    .map(x => ({
      symbol: x.symbol,
      base: x.symbol.replace(/USDT$/, ''),
      quoteVolume: parseFloat(x.quoteVolume) || 0,
      lastPrice: parseFloat(x.lastPrice) || 0,
      changePct: parseFloat(x.priceChangePercent) || 0
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);
  cacheSet(key, list);
  return list;
}

function sessionAt(timestamp = Date.now()) {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 0 && hour < 8) return 'ASIA';
  if (hour >= 8 && hour < 13) return 'LONDON';
  if (hour >= 13 && hour < 21) return 'NEW_YORK';
  return 'OFF_HOURS';
}

function riskLabel(result) {
  const confidence = Number(result?.setup?.confidence || 0);
  const grade = result?.setup?.grade;
  if (!result?.setup) return 'NONE';
  if (grade === 'A+' && confidence >= 80) return 'LOW';
  if ((grade === 'A+' || grade === 'A') && confidence >= 65) return 'MEDIUM';
  return 'HIGH';
}

function enhanceAnalysis(result, candles, meta = {}) {
  if (!result || typeof result !== 'object') return result;
  const regime = detectRegime(candles);
  const setup = result.setup ? adapt(result.setup, {
    regime,
    risk: riskLabel(result),
    session: sessionAt(candles[candles.length - 1]?.t),
    htfBias: result.htfBias || null
  }) : null;
  return {
    ...result,
    setup,
    intelligence: {
      regime,
      session: sessionAt(candles[candles.length - 1]?.t),
      risk: riskLabel(result),
      confidence: setup?.intelligence?.confidence || 0,
      quality: setup?.intelligence?.quality || null
    },
    symbol: meta.symbol || result.symbol,
    interval: meta.interval || result.interval
  };
}

async function runAnalysis(symbol, interval, candles, includeContext = true) {
  const oi = includeContext ? await getOI(symbol, interval, 200).catch(() => null) : null;
  const ltf = includeContext ? await getLTF(symbol, interval) : null;
  let result = analyze(candles, { interval, symbol, oi, ltf });
  if (!includeContext && result.setup) {
    const fastLtf = await getLTF(symbol, interval);
    if (fastLtf) result = analyze(candles, { interval, symbol, ltf: fastLtf });
  }
  return enhanceAnalysis(result, candles, { symbol, interval });
}

async function scan(interval, count = 30) {
  const key = `scan:${interval}:${count}`;
  const cached = cacheGet(key, 45000);
  if (cached) return cached;
  const symbols = await getSymbols(count);
  const results = [];
  for (let i = 0; i < symbols.length; i += 5) {
    const chunk = symbols.slice(i, i + 5);
    const batch = await Promise.all(chunk.map(async item => {
      try {
        const candles = await getKlines(item.symbol, interval, 400);
        const result = await runAnalysis(item.symbol, interval, candles, false);
        if (!result.setup) return null;
        return {
          symbol: item.symbol,
          base: item.base,
          interval,
          lastPrice: result.lastPrice,
          rsi: result.rsiNow,
          trend: result.structures?.trend,
          htfBias: result.htfBias,
          intelligence: result.intelligence,
          ...result.setup
        };
      } catch (_) { return null; }
    }));
    results.push(...batch.filter(Boolean));
    await sleep(120);
  }
  const order = { 'A+': 3, A: 2, B: 1, C: 0 };
  const real = x => x.mmxm?.valid ? 1 : 0;
  results.sort((a, b) => (real(b) - real(a)) || ((order[b.grade] || 0) - (order[a.grade] || 0)) || ((b.intelligence?.confidence || b.confidence || 0) - (a.intelligence?.confidence || a.confidence || 0)));
  cacheSet(key, results);
  return results;
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const q = parsed.query;
  try {
    if (parsed.pathname === '/api/symbols') return sendJSON(res, 200, { symbols: await getSymbols(Math.min(100, +q.limit || 40)) });
    if (parsed.pathname === '/api/analyze') {
      const symbol = String(q.symbol || 'BTCUSDT').toUpperCase();
      const interval = INTERVALS[q.interval] ? q.interval : '15m';
      const candles = await getKlines(symbol, interval, Math.min(1000, +q.limit || 500));
      return sendJSON(res, 200, await runAnalysis(symbol, interval, candles, true));
    }
    if (parsed.pathname === '/api/scan') {
      const interval = INTERVALS[q.interval] ? q.interval : '15m';
      const list = await scan(interval, Math.min(60, +q.count || 30));
      return sendJSON(res, 200, { interval, count: list.length, results: list, ts: Date.now() });
    }
    if (parsed.pathname === '/api/backtest') {
      const file = path.join(__dirname, 'backtest_sonuc.txt');
      if (!fs.existsSync(file)) return sendJSON(res, 200, { ok: false, text: 'Henüz backtest koşulmadı.' });
      const stat = fs.statSync(file);
      return sendJSON(res, 200, { ok: true, mtime: stat.mtimeMs, text: fs.readFileSync(file, 'utf8') });
    }
    if (parsed.pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'bilinmeyen uç nokta' });
    if (parsed.pathname === '/paper' || parsed.pathname === '/paper/') {
      const data = fs.readFileSync(path.join(__dirname, 'docs', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(data);
    }
    if (parsed.pathname === '/paper_state.json') {
      const data = fs.readFileSync(path.join(__dirname, 'docs', 'paper_state.json'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(data);
    }
    return serveStatic(res, parsed.pathname);
  } catch (error) { return sendJSON(res, 502, { error: error.message || String(error) }); }
});

const wsClients = new Set();
function wsAccept(key) { return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'); }
function wsSend(socket, value) {
  const payload = Buffer.from(value);
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  try { socket.write(Buffer.concat([header, payload])); } catch (_) {}
}

function parseFrames(client) {
  let buffer = client.buf;
  while (buffer.length >= 2) {
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) { if (buffer.length < 4) break; length = buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (buffer.length < 10) break; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
    let mask;
    if (masked) { if (buffer.length < offset + 4) break; mask = buffer.slice(offset, offset + 4); offset += 4; }
    if (buffer.length < offset + length) break;
    let payload = buffer.slice(offset, offset + length);
    if (masked) { const decoded = Buffer.alloc(length); for (let i = 0; i < length; i++) decoded[i] = payload[i] ^ mask[i & 3]; payload = decoded; }
    buffer = buffer.slice(offset + length);
    if (opcode === 0x8) { client.socket.destroy(); return; }
    if (opcode === 0x1) {
      try {
        const message = JSON.parse(payload.toString());
        if (message.type === 'subscribe' && message.symbol) {
          client.sub = { symbol: String(message.symbol).toUpperCase(), interval: INTERVALS[message.interval] ? message.interval : '15m' };
          pushOne(client);
        }
      } catch (_) {}
    }
  }
  client.buf = buffer;
}

async function pushOne(client) {
  if (!client.sub) return;
  const { symbol, interval } = client.sub;
  try {
    const candles = await getKlines(symbol, interval, 500, 500);
    const result = await runAnalysis(symbol, interval, candles, true);
    if (client.sub?.symbol === symbol && client.sub?.interval === interval) wsSend(client.socket, JSON.stringify({ type: 'analyze', data: result }));
  } catch (_) {}
}

server.on('upgrade', (req, socket) => {
  if (url.parse(req.url).pathname !== '/ws') return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`);
  const client = { socket, buf: Buffer.alloc(0), sub: null };
  wsClients.add(client);
  socket.on('data', data => { client.buf = Buffer.concat([client.buf, data]); parseFrames(client); });
  socket.on('close', () => wsClients.delete(client));
  socket.on('error', () => { wsClients.delete(client); try { socket.destroy(); } catch (_) {} });
});

setInterval(async () => {
  if (!wsClients.size) return;
  const groups = new Map();
  for (const client of wsClients) {
    if (!client.sub) continue;
    const key = `${client.sub.symbol}|${client.sub.interval}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(client);
  }
  for (const [key, clients] of groups) {
    const [symbol, interval] = key.split('|');
    try {
      const candles = await getKlines(symbol, interval, 500, 500);
      const result = await runAnalysis(symbol, interval, candles, true);
      const message = JSON.stringify({ type: 'analyze', data: result });
      for (const client of clients) wsSend(client.socket, message);
    } catch (_) {}
  }
}, 1200);

server.listen(PORT, () => {
  console.log(`\n  SMC Kripto Botu çalışıyor: http://localhost:${PORT}`);
  console.log('  V4.6 intelligence: regime + quality + confidence + risk\n');
});
