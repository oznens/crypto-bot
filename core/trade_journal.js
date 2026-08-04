'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'trade_history.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return []; }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function record(trade) {
  const list = load();
  const item = {
    id: Date.now(),
    time: new Date().toISOString(),
    symbol: trade.symbol || '',
    side: trade.side || '',
    model: trade.model || '',
    grade: trade.grade || '',
    confidence: trade.confidence || 0,
    entry: trade.entry || null,
    sl: trade.sl || null,
    tp: trade.tp || null,
    rr: trade.rr || null,
    timeframe: trade.timeframe || '',
    session: trade.session || '',
    resultR: null,
    MFE: null,
    MAE: null,
    status: 'OPEN'
  };
  list.push(item);
  save(list);
  return item;
}

function all() { return load(); }

module.exports = { record, all };
