'use strict';

function norm(value) {
  const x = String(value || '').toUpperCase();
  if (/BULL|UP|LONG/.test(x)) return 'LONG';
  if (/BEAR|DOWN|SHORT/.test(x)) return 'SHORT';
  return 'NEUTRAL';
}

function evaluate(input = {}) {
  const side = norm(input.side);
  const htf = norm(input.htfBias);
  const mtf = norm(input.mtfTrend || input.structureTrend);
  const ltf = norm(input.ltfBias);
  const votes = [htf, mtf, ltf].filter(x => x !== 'NEUTRAL');
  const aligned = votes.filter(x => x === side).length;
  const opposed = votes.filter(x => x !== side).length;
  const score = votes.length ? Math.round(100 * aligned / votes.length) : 50;
  const status = opposed > 0 ? 'CONFLICT' : aligned >= 2 ? 'ALIGNED' : 'PARTIAL';
  return {
    side, htf, mtf, ltf, votes: votes.length, aligned, opposed, score, status,
    valid: opposed === 0 && (aligned >= 2 || votes.length === 0),
    reason: opposed ? 'TIMEFRAME_CONFLICT' : aligned >= 2 ? 'TIMEFRAMES_ALIGNED' : 'TIMEFRAME_DATA_PARTIAL'
  };
}

module.exports = { norm, evaluate };
