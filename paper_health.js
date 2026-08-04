'use strict';

const fs = require('fs');
const path = require('path');

const STATE_F = process.env.PAPER_STATE
  ? path.resolve(process.env.PAPER_STATE)
  : path.join(__dirname, 'paper_state.json');

function finite(v) {
  return Number.isFinite(Number(v));
}

function assessState(state, now = Date.now()) {
  const issues = [];
  const lastRun = Number(state.lastRun) || 0;
  const analyticsAt = Number(state.analyticsMeta && state.analyticsMeta.generatedAt) || 0;
  const stateAgeMinutes = lastRun ? (now - lastRun) / 60000 : null;
  const analyticsAgeMinutes = analyticsAt ? (now - analyticsAt) / 60000 : null;

  if (!Array.isArray(state.open)) issues.push('OPEN_NOT_ARRAY');
  if (!Array.isArray(state.closed)) issues.push('CLOSED_NOT_ARRAY');
  if (!finite(state.equity) || Number(state.equity) <= 0) issues.push('INVALID_EQUITY');
  if (!lastRun) issues.push('MISSING_LAST_RUN');
  if (!analyticsAt) issues.push('MISSING_ANALYTICS');
  if (stateAgeMinutes != null && stateAgeMinutes > 30) issues.push('STALE_STATE');
  if (analyticsAgeMinutes != null && analyticsAgeMinutes > 30) issues.push('STALE_ANALYTICS');
  if (lastRun && analyticsAt && analyticsAt + 60000 < lastRun) issues.push('ANALYTICS_BEHIND_STATE');

  return {
    ok: issues.length === 0,
    status: issues.length === 0
      ? 'HEALTHY'
      : issues.some(issue => issue.startsWith('STALE_')) ? 'STALE' : 'DEGRADED',
    checkedAt: now,
    stateAgeMinutes: stateAgeMinutes == null ? null : +stateAgeMinutes.toFixed(2),
    analyticsAgeMinutes: analyticsAgeMinutes == null ? null : +analyticsAgeMinutes.toFixed(2),
    openTrades: Array.isArray(state.open) ? state.open.length : null,
    closedTrades: Array.isArray(state.closed) ? state.closed.length : null,
    issues
  };
}

function main() {
  const raw = fs.readFileSync(STATE_F, 'utf8').trim();
  if (!raw) throw new Error('paper_state.json boş');
  const state = JSON.parse(raw);
  state.health = assessState(state);
  fs.writeFileSync(STATE_F, JSON.stringify(state, null, 1));
  console.log('health:', state.health.status, state.health.issues.join(',') || 'sorun yok');
}

if (require.main === module) main();
module.exports = { assessState };
