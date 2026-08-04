'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const A = require('./analysis');
const Risk = require('./core/risk_engine');
const TradePolicy = require('./core/paper_trade_policy');
const { detect: detectRegime } = require('./core/regime_detector');

const STATE_F = process.env.PAPER_STATE ? path.resolve(process.env.PAPER_STATE) : path.join(__dirname, 'paper_state.json');
const DOCS_F = path.join(__dirname, 'docs', 'paper_state.json');
const MAX_SYMS = +(process.env.PAPER_MAX_SYMS || 50);
const MIN_CONF = +(process.env.PAPER_MIN_CONF || 75);
const START_EQ = 10000;
const RISK_PCT = +(process.env.PAPER_RISK_PCT || 0.01);
const LEV_CAP = 10;
const FEE_TAKER = 0.0002;
const FEE_MAKER = 0.0001;
const SLIP = 0.0005;
const TF_LIST = [['1d', '60m'], ['4h', '15m'], ['60m', '15m'], ['15m', '5m']];
const MIN_RISK = { '15m': 0.008, '60m': 0.012, '4h': 0.02, '1d': 0.03 };
const MAX_OPEN = 6;
const MAX_TOTAL = 14;
const MAX_NEW_PER_RUN = 2;
const TP1_R = 1.5;
const RISK_CONFIG = {
  maxTotalRiskPct: +(process.env.PAPER_MAX_TOTAL_RISK_PCT || 0.04),
  maxDirectionalRiskPct: +(process.env.PAPER_MAX_DIRECTIONAL_RISK_PCT || 0.03),
  maxCorrelatedTrades: +(process.env.PAPER_MAX_CORRELATED_TRADES || 2),
  weeklyStopR: +(process.env.PAPER_WEEKLY_STOP_R || 5)
};

const riskli = st => st.open.filter(t => !t.deriskDone).length;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rnd = (v, d) => {
  const m = Math.pow(10, d == null ? 6 : d);
  return Math.round(v * m) / m;
};

function get(target, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(target, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: timeout || 20000
    }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(new Error('json ' + target.slice(0, 60))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

let SRC = 'perp';

async function topSymbols() {
  try {
    const response = await get('https://contract.mexc.com/api/v1/contract/ticker');
    const list = (response.data || [])
      .filter(item => /_USDT$/.test(item.symbol) && +item.amount24 > 0)
      .sort((a, b) => +b.amount24 - +a.amount24)
      .slice(0, MAX_SYMS)
      .map(item => item.symbol);
    if (list.length >= 5) return list;
    throw new Error('az sembol');
  } catch (error) {
    SRC = 'spot';
    const raw = await get('https://api.mexc.com/api/v3/ticker/24hr');
    const skip = /^(USDC|USDE|EUR|TUSD|FDUSD|DAI|BUSD|USTC|GUSD|PAX)/i;
    return raw
      .filter(item => item.symbol && item.symbol.endsWith('USDT') && !skip.test(item.symbol) && !/\d{3,}/.test(item.symbol))
      .sort((a, b) => (+b.quoteVolume || 0) - (+a.quoteVolume || 0))
      .slice(0, MAX_SYMS)
      .map(item => item.symbol);
  }
}

const IV_PERP = { '1m': 'Min1', '5m': 'Min5', '15m': 'Min15', '60m': 'Min60', '4h': 'Hour4', '1d': 'Day1' };
const secPerBar = { '1m': 60, '5m': 300, '15m': 900, '60m': 3600, '4h': 14400, '1d': 86400 };

async function klines(symbol, interval, bars) {
  if (SRC === 'perp') {
    const end = Math.floor(Date.now() / 1000);
    const start = end - bars * secPerBar[interval];
    const response = await get(
      'https://contract.mexc.com/api/v1/contract/kline/' + symbol +
      '?interval=' + IV_PERP[interval] + '&start=' + start + '&end=' + end
    );
    const data = response.data || {};
    if (!data.time || !data.time.length) throw new Error('kline yok ' + symbol);
    return data.time.map((time, index) => ({
      t: time * 1000,
      o: +data.open[index],
      h: +data.high[index],
      l: +data.low[index],
      c: +data.close[index],
      v: +data.vol[index]
    }));
  }

  const spotSymbol = symbol.replace('_', '');
  const raw = await get(
    'https://api.mexc.com/api/v3/klines?symbol=' + spotSymbol +
    '&interval=' + interval + '&limit=' + Math.min(1000, bars)
  );
  return raw
    .map(row => ({ t: +row[0], o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5] }))
    .filter(candle => isFinite(candle.c) && candle.c > 0);
}

function normalizeState(state) {
  const st = state || {};
  st.equity = Number.isFinite(+st.equity) ? +st.equity : START_EQ;
  st.startEquity = Number.isFinite(+st.startEquity) ? +st.startEquity : START_EQ;
  st.open = Array.isArray(st.open) ? st.open : [];
  st.closed = Array.isArray(st.closed) ? st.closed : [];
  st.recentSigs = Array.isArray(st.recentSigs) ? st.recentSigs : [];
  st.equityHistory = Array.isArray(st.equityHistory) ? st.equityHistory : [];
  st.riskRejections = Array.isArray(st.riskRejections) ? st.riskRejections : [];
  st.runs = Number.isFinite(+st.runs) ? +st.runs : 0;
  return st;
}

function loadState() {
  try { return normalizeState(JSON.parse(fs.readFileSync(STATE_F, 'utf8'))); }
  catch (error) { return normalizeState({}); }
}

function saveState(state) {
  const serialized = JSON.stringify(state, null, 1);
  fs.writeFileSync(STATE_F, serialized);
  if (!process.env.PAPER_STATE) {
    try {
      fs.mkdirSync(path.dirname(DOCS_F), { recursive: true });
      fs.writeFileSync(DOCS_F, serialized);
    } catch (error) {}
  }
}

function makeSnap(analysis) {
  const candles = analysis.candles.slice(-132);
  const offset = analysis.candles.length - candles.length;
  const manipulation = analysis.structures.manipulation;
  return {
    candles: candles.map(c => [Math.round(c.t / 1000), rnd(c.o), rnd(c.h), rnd(c.l), rnd(c.c)]),
    manip: manipulation ? {
      rangeFrom: manipulation.rangeFrom - offset,
      rangeTo: manipulation.rangeTo - offset,
      sweepAt: manipulation.sweepAt - offset,
      at: manipulation.at - offset,
      rangeHigh: manipulation.rangeHigh,
      rangeLow: manipulation.rangeLow,
      wick: manipulation.wick,
      side: manipulation.side
    } : null
  };
}

function marketSession(timestamp) {
  const hour = +new Date(timestamp || Date.now()).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false
  });
  if (hour >= 2 && hour < 5) return 'LONDON';
  if (hour >= 7 && hour < 12) return 'NEW_YORK';
  if (hour >= 19 || hour < 2) return 'ASIA';
  return 'OFF_SESSION';
}

function closePart(state, trade, price, part, why, taker) {
  const qty = trade.qty * part;
  const gross = (trade.side === 'LONG' ? price - trade.entry : trade.entry - price) * qty;
  const fee = price * qty * (taker ? FEE_TAKER : FEE_MAKER);
  const pnl = gross - fee - (part === 1 || !trade.feeCharged ? trade.entryFee * (trade.feeCharged ? 0 : 1) : 0);
  if (!trade.feeCharged) trade.feeCharged = true;
  state.equity = rnd(state.equity + pnl, 2);
  trade.fills.push({ t: Date.now(), px: rnd(price), part: rnd(part, 3), why, pnl: rnd(pnl, 2) });
  trade.realized = rnd((trade.realized || 0) + pnl, 2);
  trade.qty = rnd(trade.qty - qty, 8);
  return pnl;
}

async function finishTrade(state, trade, why) {
  trade.status = 'closed';
  trade.closedAt = Date.now();
  trade.closeReason = why;
  trade.r = rnd(trade.realized / trade.riskUSD, 2);
  trade.resultR = trade.r;
  trade.mfeR = rnd(trade.mfeR || 0, 2);
  trade.maeR = rnd(trade.maeR || 0, 2);

  try {
    const candles = await klines(trade.symbol, trade.tf, 140);
    trade.snapClose = {
      candles: candles.slice(-132).map(c => [Math.round(c.t / 1000), rnd(c.o), rnd(c.h), rnd(c.l), rnd(c.c)])
    };
  } catch (error) {}

  delete trade.snapLive;
  state.closed.unshift(trade);
  if (state.closed.length > 400) state.closed.length = 400;
  state.closed.forEach((item, index) => {
    if (index >= 60) {
      delete item.snap;
      delete item.snapClose;
    }
  });
  state.open = state.open.filter(item => item !== trade);
}

function updateExcursion(trade, candle, options) {
  return TradePolicy.applyExcursion(trade, candle, options);
}

async function manageOpen(state) {
  for (const trade of [...state.open]) {
    let candles;
    try {
      candles = await klines(
        trade.symbol,
        '5m',
        Math.min(900, Math.max(30, Math.ceil((Date.now() - trade.lastCheck) / 300000) + 10))
      );
    } catch (error) {
      continue;
    }

    const news = candles.filter(c => c.t > trade.lastCheck);
    for (const candle of news) {
      const long = trade.side === 'LONG';
      const hitSL = long ? candle.l <= trade.sl : candle.h >= trade.sl;
      updateExcursion(trade, candle, { stopFirst: hitSL });

      const hitT1 = !trade.deriskDone && (long ? candle.h >= trade.tp1 : candle.l <= trade.tp1);
      const hitTF = long ? candle.h >= trade.tpF : candle.l <= trade.tpF;

      if (hitSL) {
        const price = trade.sl * (long ? 1 - SLIP : 1 + SLIP);
        closePart(state, trade, price, 1, trade.deriskDone ? 'BE/SL' : 'SL', true);
        await finishTrade(state, trade, trade.deriskDone ? 'BE' : 'SL');
        break;
      }

      if (hitT1 && trade.tp1 !== trade.tpF) {
        closePart(state, trade, trade.tp1, 0.5, 'TP1-derisk', false);
        trade.deriskDone = true;
        trade.sl = trade.entry;
      }

      if (hitTF) {
        closePart(state, trade, trade.tpF, 1, 'TP-final', false);
        await finishTrade(state, trade, 'TP');
        break;
      }
    }

    if (trade.status !== 'closed' && news.length) {
      trade.lastCheck = news[news.length - 1].t - 1;
    }

    if (trade.status !== 'closed') {
      try {
        const current = await klines(trade.symbol, trade.tf, 140);
        trade.snapLive = {
          candles: current.slice(-132).map(c => [Math.round(c.t / 1000), rnd(c.o), rnd(c.h), rnd(c.l), rnd(c.c)]),
          at: Date.now()
        };
      } catch (error) {}
    }
  }
}

function recordRiskRejection(state, symbol, side, timeframe, decision) {
  state.riskRejections.unshift({
    t: Date.now(),
    symbol,
    side,
    tf: timeframe,
    reason: decision.reason,
    weekR: decision.weekR == null ? null : rnd(decision.weekR, 2),
    totalRiskUSD: decision.totalRiskUSD == null ? null : rnd(decision.totalRiskUSD, 2),
    directionalRiskUSD: decision.directionalRiskUSD == null ? null : rnd(decision.directionalRiskUSD, 2),
    correlated: decision.correlated == null ? null : decision.correlated
  });
  if (state.riskRejections.length > 100) state.riskRejections.length = 100;
}

function tryOpen(state, symbol, analysis, marketPrice, timeframe) {
  const setup = analysis.setup;
  if (!setup || setup.confidence < MIN_CONF) return null;
  if (riskli(state) >= MAX_OPEN || state.open.length >= MAX_TOTAL) return null;
  if (setup.grade === 'B') return null;
  if (!setup.mmxm || !setup.mmxm.valid) return null;
  if (
    analysis.htfBias &&
    analysis.htfBias !== 'Neutral' &&
    ((analysis.htfBias === 'Bullish') !== (setup.side === 'LONG'))
  ) return null;
  if (state.open.find(trade => trade.symbol === symbol)) return null;

  const manipulation = analysis.structures.manipulation;
  if (!manipulation) return null;

  const signature = symbol + '|' + timeframe + '|' + setup.side + '|' +
    (analysis.candles[manipulation.sweepAt] ? analysis.candles[manipulation.sweepAt].t : manipulation.sweepAt);
  if (state.recentSigs.includes(signature)) return null;

  const long = setup.side === 'LONG';
  const entry = marketPrice * (long ? 1 + SLIP : 1 - SLIP);
  const stop = setup.stop;
  const targets = setup.tps;
  if (long ? stop >= entry : stop <= entry) return null;

  const finalTarget = targets[targets.length - 1];
  if (long ? entry >= finalTarget : entry <= finalTarget) return null;

  const riskDist = Math.abs(entry - stop);
  if (riskDist / entry < (MIN_RISK[timeframe] || 0.01)) return null;

  const actualRR = Math.abs(finalTarget - entry) / riskDist;
  if (actualRR < 1) return null;

  let tp1 = long ? entry + TP1_R * riskDist : entry - TP1_R * riskDist;
  if (long ? tp1 > finalTarget : tp1 < finalTarget) tp1 = finalTarget;

  const position = TradePolicy.calculatePosition({
    equity: state.equity,
    riskPct: RISK_PCT,
    leverageCap: LEV_CAP,
    entry,
    stop
  });
  if (!position.valid) return null;

  const qty = position.qty;
  const riskUSD = rnd(position.actualRiskUSD, 2);
  const riskDecision = Risk.evaluateTrade(state, {
    symbol,
    side: setup.side,
    riskUSD
  }, RISK_CONFIG);
  if (!riskDecision.allowed) {
    recordRiskRejection(state, symbol, setup.side, timeframe, riskDecision);
    return null;
  }

  const entryFee = rnd(entry * qty * FEE_TAKER, 4);
  const candles = analysis.candles;
  let atr14 = null;
  let atrSum = 0;
  let atrCount = 0;
  for (let i = Math.max(1, candles.length - 14); i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const previousClose = candles[i - 1].c;
    atrSum += Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    atrCount++;
  }
  if (atrCount) atr14 = atrSum / atrCount;

  const lastCandle = candles[candles.length - 1];
  const diag = {
    stopDist: rnd(riskDist),
    atr: atr14 ? rnd(atr14) : null,
    stopATR: atr14 ? rnd(riskDist / atr14, 2) : null,
    bodyATR: atr14 ? rnd(Math.abs(lastCandle.c - lastCandle.o) / atr14, 2) : null,
    tpfATR: atr14 ? rnd(Math.abs(finalTarget - entry) / atr14, 2) : null,
    nyHour: +new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hour12: false
    })
  };

  const regime = detectRegime(candles);
  const trade = {
    id: symbol + '-' + Date.now(),
    symbol,
    side: setup.side,
    src: SRC,
    tf: timeframe,
    entry: rnd(entry),
    mkt: rnd(marketPrice),
    slip: SLIP,
    entryFee,
    qty: rnd(qty, 8),
    qty0: rnd(qty, 8),
    notional: rnd(entry * qty, 2),
    sl: rnd(stop),
    initialSL: rnd(stop),
    initialRiskDist: rnd(riskDist),
    tp1: rnd(tp1),
    tpF: rnd(finalTarget),
    riskUSD,
    plannedRiskUSD: rnd(position.plannedRiskUSD, 2),
    leverageCapped: position.leverageCapped,
    rrPlan: setup.rr,
    conf: setup.confidence,
    grade: setup.grade,
    model: setup.model,
    mmxm: setup.mmxm || null,
    reasons: (setup.reasons || []).slice(0, 6),
    regime,
    session: marketSession(Date.now()),
    riskDecision,
    diag,
    mfeR: 0,
    maeR: 0,
    snap: makeSnap(analysis),
    openedAt: Date.now(),
    lastCheck: Date.now(),
    status: 'open',
    deriskDone: false,
    realized: 0,
    feeCharged: false,
    fills: []
  };

  state.open.push(trade);
  state.recentSigs.push(signature);
  if (state.recentSigs.length > 300) {
    state.recentSigs.splice(0, state.recentSigs.length - 300);
  }
  return trade;
}

(async () => {
  const state = loadState();
  state.runs += 1;
  console.log('== PAPER RUN #' + state.runs + ' ==');

  const symbols = await topSymbols();
  console.log('kaynak:', SRC, '| sembol:', symbols.length, '| özkaynak:', state.equity);

  await manageOpen(state);

  const weekly = Risk.weeklyR(state.closed);
  const weeklyBlocked = RISK_CONFIG.weeklyStopR > 0 && weekly <= -Math.abs(RISK_CONFIG.weeklyStopR);
  let scanned = 0;
  let opened = 0;
  let errors = 0;

  if (!weeklyBlocked) {
    for (const symbol of symbols) {
      if (opened >= MAX_NEW_PER_RUN || riskli(state) >= MAX_OPEN || state.open.length >= MAX_TOTAL) break;
      if (state.open.find(trade => trade.symbol === symbol)) continue;

      for (const [timeframe, lowerTimeframe] of TF_LIST) {
        try {
          const candles = await klines(symbol, timeframe, 500);
          if (candles.length < 80) {
            await sleep(80);
            continue;
          }

          let analysis = A.analyze(candles, {
            interval: timeframe,
            symbol: symbol.replace('_', '')
          });
          scanned++;

          if (analysis.setup && analysis.setup.confidence >= MIN_CONF) {
            try {
              const lowerCandles = await klines(symbol, lowerTimeframe, 500);
              analysis = A.analyze(candles, {
                interval: timeframe,
                symbol: symbol.replace('_', ''),
                ltf: { interval: lowerTimeframe, candles: lowerCandles }
              });
            } catch (error) {}

            if (analysis.setup && analysis.setup.confidence >= MIN_CONF) {
              const trade = tryOpen(state, symbol, analysis, candles[candles.length - 1].c, timeframe);
              if (trade) {
                opened++;
                console.log(
                  'AÇILDI:', symbol, timeframe, trade.side,
                  'giriş', trade.entry,
                  'SL', trade.sl,
                  'TP', trade.tp1 + '/' + trade.tpF,
                  'güven %' + trade.conf,
                  trade.grade,
                  'rejim', trade.regime
                );
                break;
              }
            }
          }
        } catch (error) {
          errors++;
        }
        await sleep(80);
      }
      await sleep(60);
    }
  } else {
    recordRiskRejection(state, 'PORTFOLIO', 'NONE', 'ALL', {
      reason: 'WEEKLY_LOSS_LIMIT',
      weekR: weekly
    });
    console.log('YENİ İŞLEM BLOKE: haftalık sonuç', rnd(weekly, 2) + 'R');
  }

  state.lastRun = Date.now();
  state.equityHistory.push({ t: state.lastRun, eq: state.equity, open: state.open.length });
  if (state.equityHistory.length > 2000) {
    state.equityHistory.splice(0, state.equityHistory.length - 2000);
  }

  const wins = state.closed.filter(trade => trade.realized > 0).length;
  const openRiskUSD = Risk.openRiskUSD(state.open);
  state.stats = {
    closed: state.closed.length,
    wins,
    losses: state.closed.filter(trade => trade.realized <= 0).length,
    winRate: state.closed.length ? rnd(100 * wins / state.closed.length, 1) : null,
    netPnl: rnd(state.equity - state.startEquity, 2),
    totalR: rnd(state.closed.reduce((sum, trade) => sum + (trade.r || 0), 0), 2),
    weeklyR: rnd(Risk.weeklyR(state.closed), 2),
    openRiskUSD: rnd(openRiskUSD, 2),
    openRiskPct: state.equity ? rnd(100 * openRiskUSD / state.equity, 2) : 0,
    source: SRC,
    minConf: MIN_CONF,
    tf: TF_LIST.map(item => item[0]).join('/')
  };

  saveState(state);
  console.log(
    'tarandı:', scanned,
    '| açıldı:', opened,
    '| açık:', state.open.length,
    '(riskli ' + riskli(state) + '/' + MAX_OPEN + ', BE ' + (state.open.length - riskli(state)) + ')',
    '| kapalı:', state.closed.length,
    '| hata:', errors
  );
  console.log(
    'özkaynak:', state.equity,
    '| net PnL:', state.stats.netPnl,
    '| WR:', state.stats.winRate,
    '| hafta:', state.stats.weeklyR + 'R',
    '| açık risk:', state.stats.openRiskPct + '%'
  );
})().catch(error => {
  console.error('HATA', error.stack);
  process.exit(1);
});
