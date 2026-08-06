'use strict';

module.exports = {
  engine: 'legacy',
  startDate: null,
  endDate: null,
  capital: 10000,
  riskPercent: 1,
  symbols: { mode: 'top30', list: [] },
  timeframes: ['15m','1h','4h','1d'],
  execution: {
    fees: true,
    slippage: true,
    commissionRate: 0.00055,
    slippagePercent: 0.0005
  }
};
