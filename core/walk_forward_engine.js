/*
 * V4.5 Walk Forward Validation Engine
 *
 * Amaç:
 * Geçmiş veri üzerinde bulunan avantajların gelecekte de
 * dayanıklı olup olmadığını ölçmek.
 */

function splitData(data, trainRatio) {
  trainRatio = trainRatio || 0.7;
  const cut = Math.floor(data.length * trainRatio);
  return {
    train: data.slice(0, cut),
    test: data.slice(cut)
  };
}

function metrics(trades) {
  const wins = trades.filter(t => Number(t.resultR) > 0);
  const losses = trades.filter(t => Number(t.resultR) <= 0);
  const totalR = trades.reduce((a, t) => a + (Number(t.resultR) || 0), 0);

  return {
    trades: trades.length,
    winrate: trades.length ? +(wins.length / trades.length * 100).toFixed(2) : 0,
    totalR: +totalR.toFixed(2),
    avgR: trades.length ? +(totalR / trades.length).toFixed(3) : 0
  };
}

function validate(trades, ratio) {
  const parts = splitData(trades, ratio);
  return {
    train: metrics(parts.train),
    test: metrics(parts.test),
    robust: metrics(parts.test).avgR > 0
  };
}

module.exports = {
  splitData,
  metrics,
  validate
};
