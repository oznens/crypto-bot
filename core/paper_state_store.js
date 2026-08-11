'use strict';

const fs = require('fs');
const path = require('path');

const PORTFOLIO_IDS = ['DREYKO', 'YIGITAL'];

function initialPortfolio(id, startEquity) {
  return {
    id,
    label: id === 'YIGITAL' ? 'Yigital' : 'DREYKO',
    equity: startEquity,
    startEquity,
    open: [],
    closed: [],
    recentSigs: [],
    equityHistory: [],
    stats: {}
  };
}

function initialState(startEquity) {
  return syncLegacyView({
    version: 2,
    portfolios: Object.fromEntries(PORTFOLIO_IDS.map(id => [id, initialPortfolio(id, startEquity)])),
    lastRun: null,
    runs: 0
  });
}

// Eski rapor/CLI tüketicileri kök alanları DREYKO görünümü olarak okumaya devam eder.
// Yigital hiçbir zaman bu alanlara birleştirilmez.
function syncLegacyView(state) {
  const dreyko = state.portfolios.DREYKO;
  for (const key of ['equity', 'startEquity', 'open', 'closed', 'recentSigs', 'equityHistory', 'stats', 'riskRejections', 'strategyRejections', 'circuitBreaker']) {
    if (dreyko[key] != null) state[key] = dreyko[key];
    else delete state[key];
  }
  return state;
}

function resetPortfolio(state, id, startEquity) {
  if (!PORTFOLIO_IDS.includes(id)) throw new Error(`bilinmeyen portföy: ${id}`);
  state.portfolios[id] = initialPortfolio(id, startEquity);
  state.portfolios[id].resetAt = Date.now();
  return syncLegacyView(state);
}

function migrateState(state, startEquity) {
  if (state && state.portfolios) {
    for (const id of PORTFOLIO_IDS) state.portfolios[id] = state.portfolios[id] || initialPortfolio(id, startEquity);
    state.version = 2;
    return syncLegacyView(state);
  }
  const next = initialState(startEquity);
  if (state && typeof state === 'object') {
    const legacy = next.portfolios.DREYKO;
    for (const key of ['equity', 'startEquity', 'open', 'closed', 'recentSigs', 'equityHistory', 'stats', 'riskRejections', 'strategyRejections', 'circuitBreaker']) {
      if (state[key] != null) legacy[key] = state[key];
    }
    next.lastRun = state.lastRun || null;
    next.runs = state.runs || 0;
    next.migration = { from: 'legacy-single-portfolio', migratedAt: Date.now() };
  }
  return syncLegacyView(next);
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('paper state nesne değil');
  if (!state.portfolios || typeof state.portfolios !== 'object') throw new Error('paper state portfolios eksik');
  for (const id of PORTFOLIO_IDS) {
    const portfolio = state.portfolios[id];
    if (!portfolio || !Number.isFinite(+portfolio.equity) || +portfolio.equity <= 0) throw new Error(`${id} equity geçersiz`);
    for (const key of ['open', 'closed', 'recentSigs', 'equityHistory']) {
      if (!Array.isArray(portfolio[key])) throw new Error(`${id} ${key} dizi değil`);
    }
  }
  return state;
}

function parseState(text, source) {
  try {
    return validateState(migrateState(JSON.parse(text), 10000));
  } catch (error) {
    throw new Error(`${source} okunamadı: ${error.message}`);
  }
}

function loadState(filename, startEquity) {
  try {
    return validateState(migrateState(JSON.parse(fs.readFileSync(filename, 'utf8')), startEquity));
  } catch (error) {
    if (error.code === 'ENOENT') return initialState(startEquity);
    const backup = `${filename}.bak`;
    try {
      const recovered = parseState(fs.readFileSync(backup, 'utf8'), backup);
      recovered.recovery = { source: backup, recoveredAt: Date.now(), error: error.message };
      return recovered;
    } catch (backupError) {
      if (backupError.code === 'ENOENT') throw error;
      throw new Error(`${error.message}; yedek de geçersiz: ${backupError.message}`);
    }
  }
}

function saveAtomic(filename, state) {
  syncLegacyView(state);
  validateState(state);
  const serialized = JSON.stringify(state, null, 1);
  parseState(serialized, 'yazılacak paper state');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${filename}.bak`;
  try {
    fs.writeFileSync(temp, serialized, { encoding: 'utf8', flag: 'wx' });
    const descriptor = fs.openSync(temp, 'r');
    try {
      try { fs.fsyncSync(descriptor); }
      catch (error) {
        if (!['EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
      }
    } finally { fs.closeSync(descriptor); }
    if (fs.existsSync(filename)) {
      try {
        parseState(fs.readFileSync(filename, 'utf8'), filename);
        fs.copyFileSync(filename, backup);
      } catch (_) {
        // Bozuk ana dosya, son geçerli yedeğin üzerine kopyalanmamalı.
      }
    }
    fs.renameSync(temp, filename);
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
}

module.exports = { PORTFOLIO_IDS, initialPortfolio, initialState, migrateState, syncLegacyView, resetPortfolio, validateState, parseState, loadState, saveAtomic };
