'use strict';

const fs = require('fs');
const path = require('path');

function initialState(startEquity) {
  return {
    equity: startEquity,
    startEquity,
    open: [],
    closed: [],
    recentSigs: [],
    equityHistory: [],
    lastRun: null,
    runs: 0
  };
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('paper state nesne değil');
  if (!Number.isFinite(+state.equity) || +state.equity <= 0) throw new Error('paper state equity geçersiz');
  for (const key of ['open', 'closed', 'recentSigs', 'equityHistory']) {
    if (!Array.isArray(state[key])) throw new Error(`paper state ${key} dizi değil`);
  }
  return state;
}

function parseState(text, source) {
  try {
    return validateState(JSON.parse(text));
  } catch (error) {
    throw new Error(`${source} okunamadı: ${error.message}`);
  }
}

function loadState(filename, startEquity) {
  try {
    return parseState(fs.readFileSync(filename, 'utf8'), filename);
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

module.exports = { initialState, validateState, parseState, loadState, saveAtomic };
