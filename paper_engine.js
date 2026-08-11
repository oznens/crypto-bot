/*
 * paper_engine.js — 7/24 KAĞIT (paper) işlem motoru.
 * Ana strateji parametreleri strategy_config.js ile live-exact backtest tarafından ortak kullanılır.
 */
const https = require('https'), fs = require('fs'), path = require('path');
const A = require('./analysis');
const CFG = require('./strategy_config');
const Risk = require('./core/risk_engine');
const Circuit = require('./core/trading_circuit_breaker');
const SMT = require('./core/smt_divergence_engine');
const StateStore = require('./core/paper_state_store');
const DreykoAudit = require('./core/dreyko_audit_trace');
const DreykoPretrade = require('./core/dreyko_pretrade_pipeline');
const YigitalPretrade = require('./core/yigital_pretrade_pipeline');

const STATE_F = process.env.PAPER_STATE ? path.resolve(process.env.PAPER_STATE) : path.join(__dirname, 'paper_state.json');
const DOCS_F = path.join(__dirname, 'docs', 'paper_state.json');
const MAX_SYMS = +(process.env.PAPER_MAX_SYMS || CFG.MAX_SYMS);
const MIN_CONF = CFG.MIN_CONF;
const START_EQ = CFG.START_EQ;
const RISK_PCT = CFG.RISK_PCT;
const FEE_TAKER = CFG.FEE_TAKER, FEE_MAKER = CFG.FEE_MAKER, SLIP = CFG.SLIP;
const TF = CFG.TF, LTF = CFG.LTF;
const MIN_RISK = CFG.MIN_RISK;
const MAX_OPEN = CFG.MAX_OPEN;
const MAX_NEW_PER_RUN = CFG.MAX_NEW_PER_RUN;
const TP1_R = CFG.TP1_R;
const RISK_CONFIG = {
  maxTotalRiskPct: +(process.env.PAPER_MAX_TOTAL_RISK_PCT || CFG.MAX_TOTAL_RISK_PCT),
  maxDirectionalRiskPct: +(process.env.PAPER_MAX_DIRECTIONAL_RISK_PCT || CFG.MAX_DIRECTIONAL_RISK_PCT),
  maxCorrelatedTrades: +(process.env.PAPER_MAX_CORRELATED_TRADES || CFG.MAX_CORRELATED_TRADES),
  weeklyStopR: +(process.env.PAPER_WEEKLY_STOP_R || CFG.WEEKLY_STOP_R)
};
const CIRCUIT_CONFIG = {
  dailyLossLimitR: +(process.env.PAPER_DAILY_LOSS_LIMIT_R || CFG.DAILY_LOSS_LIMIT_R),
  maxLosingStreak: +(process.env.PAPER_MAX_LOSING_STREAK || CFG.MAX_LOSING_STREAK),
  cooldownMs: +(process.env.PAPER_COOLDOWN_MS || CFG.COOLDOWN_MS)
};
const REQUIRE_DREYKO_SEQUENCE = process.env.PAPER_REQUIRE_DREYKO_SEQUENCE !== '0';
const EXECUTION_CONFIG = {
  minNetRR: +(process.env.PAPER_MIN_NET_RR || CFG.MIN_NET_RR),
  spreadBps: +(process.env.PAPER_SPREAD_BPS || CFG.SPREAD_BPS)
};

function get(url, timeout) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: timeout || 20000 }, x => {
      let b = ''; x.on('data', d => b += d);
      x.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error('json ' + url.slice(0, 60))); } });
    });
    r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout')));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (v, d) => { const m = Math.pow(10, d == null ? 6 : d); return Math.round(v * m) / m; };

let SRC = 'perp';
async function topSymbols() {
  try {
    const j = await get('https://contract.mexc.com/api/v1/contract/ticker');
    const list = (j.data || []).filter(x => /_USDT$/.test(x.symbol) && +x.amount24 > 0)
      .sort((a, b) => +b.amount24 - +a.amount24).slice(0, MAX_SYMS).map(x => x.symbol);
    if (list.length >= 5) return list;
    throw new Error('az sembol');
  } catch (e) {
    SRC = 'spot';
    const raw = await get('https://api.mexc.com/api/v3/ticker/24hr');
    const skip = /^(USDC|USDE|EUR|TUSD|FDUSD|DAI|BUSD|USTC|GUSD|PAX)/i;
    return raw.filter(x => x.symbol && x.symbol.endsWith('USDT') && !skip.test(x.symbol) && !/\d{3,}/.test(x.symbol))
      .sort((a, b) => (+b.quoteVolume || 0) - (+a.quoteVolume || 0)).slice(0, MAX_SYMS).map(x => x.symbol);
  }
}
const IV_PERP = { '5m': 'Min5', '15m': 'Min15', '60m': 'Min60' };
const secPerBar = { '5m': 300, '15m': 900, '60m': 3600 };
async function klines(sym, iv, bars) {
  if (SRC === 'perp') {
    const end = Math.floor(Date.now() / 1000), start = end - bars * secPerBar[iv];
    const j = await get('https://contract.mexc.com/api/v1/contract/kline/' + sym + '?interval=' + IV_PERP[iv] + '&start=' + start + '&end=' + end);
    const d = j.data || {};
    if (!d.time || !d.time.length) throw new Error('kline yok ' + sym);
    return d.time.map((t, i) => ({ t: t * 1000, o: +d.open[i], h: +d.high[i], l: +d.low[i], c: +d.close[i], v: +d.vol[i] }));
  }
  const spotSym = sym.replace('_', '');
  const raw = await get('https://api.mexc.com/api/v3/klines?symbol=' + spotSym + '&interval=' + iv + '&limit=' + Math.min(1000, bars));
  return raw.map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })).filter(x => isFinite(x.c) && x.c > 0);
}

async function openInterest(sym, iv, limit = 200) {
  const symbol = sym.replace('_', '');
  const period = { '5m': '5m', '15m': '15m', '60m': '1h' }[iv] || '1h';
  try {
    const raw = await get('https://fapi.binance.com/futures/data/openInterestHist?symbol=' + encodeURIComponent(symbol) + '&period=' + period + '&limit=' + Math.min(500, limit));
    if (!Array.isArray(raw) || !raw.length) return null;
    const rows = raw.map(x => ({ t: +x.timestamp, oi: +x.sumOpenInterest })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.oi));
    return rows.length >= 10 ? rows : null;
  } catch (_) { return null; }
}

function peerSymbol(sym) {
  const normalized = sym.replace('_', '');
  if (normalized === 'BTCUSDT') return SRC === 'perp' ? 'ETH_USDT' : 'ETHUSDT';
  return SRC === 'perp' ? 'BTC_USDT' : 'BTCUSDT';
}

function loadState() {
  return StateStore.loadState(STATE_F, START_EQ);
}
function saveState(st) {
  StateStore.saveAtomic(STATE_F, st);
  if (!process.env.PAPER_STATE) {
    StateStore.saveAtomic(DOCS_F, st);
  }
}

function makeSnap(a) {
  const c = a.candles.slice(-132);
  const off = a.candles.length - c.length;
  const mp = a.structures.manipulation;
  const seq = a.structures.dreykoSequence;
  const shiftZone = zone => zone ? { ...zone, from: zone.from == null ? null : zone.from - off, to: zone.to == null ? null : zone.to - off } : null;
  return {
    candles: c.map(k => [Math.round(k.t / 1000), rnd(k.o), rnd(k.h), rnd(k.l), rnd(k.c)]),
    manip: mp ? { rangeFrom: mp.rangeFrom - off, rangeTo: mp.rangeTo - off, sweepAt: mp.sweepAt - off, at: mp.at - off, rangeHigh: mp.rangeHigh, rangeLow: mp.rangeLow, wick: mp.wick, side: mp.side } : null,
    sequence: seq ? {
      state: seq.state,
      entryModel: seq.entryModel,
      displacementAt: seq.displacement ? seq.displacement.index - off : null,
      retestAt: seq.retestIndex == null ? null : seq.retestIndex - off,
      firstFvg: shiftZone(seq.firstFvg),
      iofed: seq.iofed ? { ...seq.iofed, zone: shiftZone(seq.iofed.zone), flipIndex: seq.iofed.flipIndex - off, retestIndex: seq.iofed.retestIndex - off } : null,
      breakaway: seq.breakaway ? { ...seq.breakaway, zone: shiftZone(seq.breakaway.zone) } : null
    } : null,
    anchors: a.structures.timePolicy?.anchors || null
  };
}

function closePart(st, tr, px, part, why, taker) {
  const qty = tr.qty * part;
  const gross = (tr.side === 'LONG' ? px - tr.entry : tr.entry - px) * qty;
  const fee = px * qty * (taker ? FEE_TAKER : FEE_MAKER);
  const pnl = gross - fee - (part === 1 || !tr.feeCharged ? tr.entryFee * (tr.feeCharged ? 0 : 1) : 0);
  if (!tr.feeCharged) tr.feeCharged = true;
  st.equity = rnd(st.equity + pnl, 2);
  tr.fills.push({ t: Date.now(), px: rnd(px), part: rnd(part, 3), why, pnl: rnd(pnl, 2) });
  tr.realized = rnd((tr.realized || 0) + pnl, 2);
  tr.qty = rnd(tr.qty - qty, 8);
}
function finishTrade(st, tr, why) {
  tr.status = 'closed'; tr.closedAt = Date.now(); tr.closeReason = why;
  tr.r = rnd(tr.realized / tr.riskUSD, 2);
  st.closed.unshift(tr); if (st.closed.length > 400) st.closed.length = 400;
  st.closed.forEach((t, i) => { if (i >= 60 && t.snap) delete t.snap; });
  st.open = st.open.filter(x => x !== tr);
}
async function manageOpen(st) {
  for (const tr of [...st.open]) {
    let c5;
    try { c5 = await klines(tr.symbol, '5m', Math.min(900, Math.max(30, Math.ceil((Date.now() - tr.lastCheck) / 300000) + 10))); }
    catch (e) { continue; }
    if (c5.length) tr.mkt = rnd(c5[c5.length - 1].c);
    const news = c5.filter(k => k.t > tr.lastCheck);
    for (const k of news) {
      const long = tr.side === 'LONG';
      const hitSL = long ? k.l <= tr.sl : k.h >= tr.sl;
      const hitT1 = !tr.deriskDone && (long ? k.h >= tr.tp1 : k.l <= tr.tp1);
      const hitTF = long ? k.h >= tr.tpF : k.l <= tr.tpF;
      if (hitSL) {
        const px = tr.sl * (long ? 1 - SLIP : 1 + SLIP);
        closePart(st, tr, px, 1, tr.deriskDone ? 'BE/SL' : 'SL', true);
        finishTrade(st, tr, tr.deriskDone ? 'BE' : 'SL');
        break;
      }
      if (hitT1 && tr.tp1 !== tr.tpF) {
        closePart(st, tr, tr.tp1, 0.5, 'TP1-derisk', false);
        tr.deriskDone = true; tr.sl = tr.entry;
      }
      if (hitTF) {
        closePart(st, tr, tr.tpF, 1, 'TP-final', false);
        finishTrade(st, tr, 'TP');
        break;
      }
      tr.lastCheck = k.t;
    }
    if (tr.status !== 'closed' && news.length) tr.lastCheck = news[news.length - 1].t;
  }
}

function tryOpen(st, sym, a, mktPx, context, pretrade, strategyId, candidate) {
  const s = candidate || a.setup;
  strategyId = strategyId || 'DREYKO';
  if (!s || s.confidence < MIN_CONF) return null;
  if (st.open.length >= MAX_OPEN) return null;
  if (s.grade === 'B') return null;
  if (strategyId === 'DREYKO' && (!s.mmxm || !s.mmxm.valid)) return null;
  if (a.htfBias && a.htfBias !== 'Neutral' && ((a.htfBias === 'Bullish') !== (s.side === 'LONG'))) return null;
  if (st.open.find(t => t.symbol === sym)) return null;
  const mp = a.structures.manipulation;
  const origin = s.sweepAt != null ? s.sweepAt : (mp && mp.sweepAt);
  if (origin == null) return null;
  const sig = strategyId + '|' + sym + '|' + TF + '|' + s.side + '|' + (a.candles[origin] ? a.candles[origin].t : origin);
  if (st.recentSigs.includes(sig)) return null;

  if (!pretrade?.valid) return null;
  const long = s.side === 'LONG';
  const entry = pretrade.entry;
  const sl = pretrade.stop;
  const tpF = pretrade.target;
  const riskDist = pretrade.riskDist;
  const rrAct = pretrade.grossRR;
  const targetDecision = pretrade.targetDecision;
  const execution = pretrade.execution;

  let tp1 = long ? entry + TP1_R * riskDist : entry - TP1_R * riskDist;
  if (long ? tp1 > tpF : tp1 < tpF) tp1 = tpF;
  const riskUSD = rnd(st.equity * RISK_PCT, 2);
  const qty = riskUSD / riskDist;
  if (!(qty > 0)) return null;
  const riskDecision = Risk.evaluateTrade(st, { symbol: sym, side: s.side, riskUSD }, { ...RISK_CONFIG, now: Date.now() });
  if (!riskDecision.allowed) {
    st.riskRejections = st.riskRejections || [];
    st.riskRejections.unshift({ t: Date.now(), symbol: sym, side: s.side, reason: riskDecision.reason });
    if (st.riskRejections.length > 200) st.riskRejections.length = 200;
    return null;
  }
  const entryFee = rnd(entry * qty * FEE_TAKER, 4);

  const tr = {
    id: strategyId + '-' + sym + '-' + Date.now(), strategyId, symbol: sym, side: s.side, src: SRC, tf: TF,
    entry: rnd(entry), mkt: rnd(mktPx), slip: SLIP, entryFee, qty: rnd(qty, 8), notional: rnd(entry * qty, 2),
    sl: rnd(sl), tp1: rnd(tp1), tpF: rnd(tpF), riskUSD, rrPlan: rnd(rrAct, 2),
    conf: s.confidence, grade: s.grade, model: s.model,
    mmxm: s.mmxm || null, reasons: (s.reasons || []).slice(0, 6),
    context: context ? { ...context, targetDecision, execution } : { targetDecision, execution },
    audit: strategyId === 'DREYKO' ? DreykoAudit.build({ ...(context || {}), targetDecision, execution }) : null,
    riskDecision,
    snap: makeSnap(a),
    openedAt: Date.now(), lastCheck: Date.now(), status: 'open', deriskDone: false, realized: 0, feeCharged: false, fills: []
  };
  st.open.push(tr);
  st.recentSigs.push(sig); if (st.recentSigs.length > 300) st.recentSigs.splice(0, st.recentSigs.length - 300);
  return tr;
}

function recordStrategyRejection(st, sym, side, decision) {
  st.strategyRejections = st.strategyRejections || [];
  st.strategyRejections.unshift({ t: Date.now(), symbol: sym, side, reason: decision.reason, state: decision.state });
  if (st.strategyRejections.length > 200) st.strategyRejections.length = 200;
}

function updateStats(portfolio, strategyId) {
  const wins = portfolio.closed.filter(t => t.realized > 0).length;
  let peak = portfolio.startEquity, maxDrawdownPct = 0;
  for (const point of portfolio.equityHistory.concat([{ eq: portfolio.equity }])) {
    const equity = +point.eq;
    if (!Number.isFinite(equity)) continue;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak * 100);
  }
  portfolio.stats = {
    closed: portfolio.closed.length, wins,
    losses: portfolio.closed.filter(t => t.realized <= 0).length,
    winRate: portfolio.closed.length ? rnd(100 * wins / portfolio.closed.length, 1) : null,
    netPnl: rnd(portfolio.equity - portfolio.startEquity, 2),
    totalR: rnd(portfolio.closed.reduce((sum, trade) => sum + (trade.r || 0), 0), 2),
    maxDrawdownPct: rnd(maxDrawdownPct, 2),
    strategyId, source: SRC, minConf: MIN_CONF, tf: TF, ltf: LTF,
    maxSymbols: MAX_SYMS, riskPct: RISK_PCT, tp1R: TP1_R,
    maxOpen: MAX_OPEN, maxNewPerRun: MAX_NEW_PER_RUN, minRiskPct: MIN_RISK,
    maxTotalRiskPct: RISK_CONFIG.maxTotalRiskPct,
    maxDirectionalRiskPct: RISK_CONFIG.maxDirectionalRiskPct,
    maxCorrelatedTrades: RISK_CONFIG.maxCorrelatedTrades,
    weeklyStopR: RISK_CONFIG.weeklyStopR,
    circuitBreaker: portfolio.circuitBreaker,
    minNetRR: EXECUTION_CONFIG.minNetRR,
    configSource: strategyId === 'DREYKO' ? 'strategy_config.js + dreyko pipeline' : 'yigital archive model'
  };
}

(async () => {
  const st = loadState();
  const dreyko = st.portfolios.DREYKO;
  const yigital = st.portfolios.YIGITAL;
  st.runs = (st.runs || 0) + 1;
  console.log('== PAPER RUN #' + st.runs + ' ==');
  const syms = await topSymbols();
  console.log('kaynak:', SRC, '| sembol:', syms.length, '| DREYKO:', dreyko.equity, '| Yigital:', yigital.equity);

  await manageOpen(dreyko);
  await manageOpen(yigital);

  const circuits = {};
  for (const [id, portfolio] of Object.entries(st.portfolios)) {
    circuits[id] = Circuit.evaluate(portfolio, { ...CIRCUIT_CONFIG, now: Date.now() });
    Circuit.apply(portfolio, circuits[id]);
  }

  let scanned = 0, errors = 0;
  const opened = { DREYKO: 0, YIGITAL: 0 };
  for (const sym of syms) {
    try {
      const c60 = await klines(sym, TF, 500);
      if (c60.length < 80) { await sleep(80); continue; }
      const [oi, peer] = await Promise.all([
        openInterest(sym, TF),
        klines(peerSymbol(sym), TF, 500).catch(() => null)
      ]);
      let a = A.analyze(c60, { interval: TF, symbol: sym.replace('_', ''), oi });
      scanned++;
      if ((a.setup && a.setup.confidence >= MIN_CONF && a.setup.grade !== 'B') || (a.yigitalSetup && a.yigitalSetup.confidence >= MIN_CONF && a.yigitalSetup.grade !== 'B')) {
        try {
          const c15 = await klines(sym, LTF, 500);
          a = A.analyze(c60, { interval: TF, symbol: sym.replace('_', ''), oi, ltf: { interval: LTF, candles: c15 } });
        } catch (e) {}
        if (a.setup && a.setup.confidence >= MIN_CONF && !circuits.DREYKO.blocked && opened.DREYKO < MAX_NEW_PER_RUN && dreyko.open.length < MAX_OPEN) {
          const smt = peer ? SMT.evaluate(c60, peer, a.setup.side) : { available: false, confirmed: false, reason: 'PEER_DATA_MISSING', score: 0 };
          a.structures.smt = smt;
          if (smt.confirmed) a.setup.reasons.push('SMT korelasyon teyidi ✓');
          const pretrade = DreykoPretrade.evaluate({ symbol: sym, candles: c60, analysis: a, marketPrice: c60[c60.length - 1].c }, {
            slippagePct: SLIP,
            feeBps: FEE_TAKER * 10000,
            spreadBps: EXECUTION_CONFIG.spreadBps,
            minNetRR: EXECUTION_CONFIG.minNetRR,
            minRiskPct: MIN_RISK
          });
          const { timePolicy, anchorContext, sequence } = pretrade;
          a.structures.dreykoSequence = sequence;
          a.structures.timePolicy = timePolicy;
          if (!pretrade.valid) {
            recordStrategyRejection(dreyko, sym, a.setup.side, { reason: pretrade.reason, state: pretrade.stage });
          } else {
            a.setup.reasons.push(anchorContext.mode === 'OPEN_SWEEP_RECLAIM' ? 'Açılış seviyesi sweep/reclaim ✓' : 'Açılış seviyeleri flow hizası ✓');
            a.setup.reasons.push(sequence.valid ? 'DREYKO sıra teyidi ✓ ' + sequence.entryModel : 'DREYKO sıra teyidi kapalı');
            const context = { oiAvailable: !!oi, oiState: a.structures.oiState || null, smt, timePolicy, anchorContext, sequence };
            const tr = tryOpen(dreyko, sym, a, c60[c60.length - 1].c, context, pretrade, 'DREYKO', a.setup);
            if (tr) opened.DREYKO++;
          }
        }
        if (a.yigitalSetup && a.yigitalSetup.confidence >= MIN_CONF && a.yigitalSetup.grade !== 'B' && !circuits.YIGITAL.blocked && opened.YIGITAL < MAX_NEW_PER_RUN && yigital.open.length < MAX_OPEN) {
          const pretrade = YigitalPretrade.evaluate({ symbol: sym, candles: c60, analysis: a, marketPrice: c60[c60.length - 1].c }, { minNetRR: EXECUTION_CONFIG.minNetRR });
          a.structures.yigitalSequence = pretrade.sequence || null;
          if (!pretrade.valid) recordStrategyRejection(yigital, sym, a.yigitalSetup.side, { reason: pretrade.reason, state: pretrade.stage });
          else {
            const context = { sequence: pretrade.sequence, targetDecision: pretrade.targetDecision, execution: pretrade.execution };
            const tr = tryOpen(yigital, sym, a, c60[c60.length - 1].c, context, pretrade, 'YIGITAL', a.yigitalSetup);
            if (tr) opened.YIGITAL++;
          }
        }
      }
    } catch (e) { errors++; }
    await sleep(120);
  }

  st.lastRun = Date.now();
  for (const [id, portfolio] of Object.entries(st.portfolios)) {
    portfolio.equityHistory.push({ t: st.lastRun, eq: portfolio.equity, open: portfolio.open.length });
    if (portfolio.equityHistory.length > 2000) portfolio.equityHistory.splice(0, portfolio.equityHistory.length - 2000);
    updateStats(portfolio, id);
  }
  saveState(st);
  console.log('tarandı:', scanned, '| açıldı D/Y:', opened.DREYKO + '/' + opened.YIGITAL, '| hata:', errors);
  console.log('DREYKO:', dreyko.stats.totalR + 'R', '| Yigital:', yigital.stats.totalR + 'R');
})().catch(e => { console.error('HATA', e.stack); process.exit(1); });
