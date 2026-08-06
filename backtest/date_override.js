'use strict';

const endDate = process.env.BACKTEST_END_DATE;
if (endDate) {
  const parsed = Date.parse(`${endDate}T23:59:59Z`);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid BACKTEST_END_DATE: ${endDate}`);
  Date.now = () => parsed;
}
