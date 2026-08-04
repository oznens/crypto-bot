'use strict';

function detect(candles) {
  if (!candles || candles.length < 30) return 'UNKNOWN';

  const recent = candles.slice(-30);
  const first = recent[0].c;
  const last = recent[recent.length - 1].c;
  const change = (last - first) / first;

  const ranges = recent.map(c => c.h - c.l);
  const avgRange = ranges.reduce((a,b)=>a+b,0) / ranges.length;

  if (Math.abs(change) > 0.03) return change > 0 ? 'TREND_UP' : 'TREND_DOWN';
  if (avgRange / last > 0.02) return 'HIGH_VOLATILITY';
  return 'RANGE';
}

module.exports = { detect };
