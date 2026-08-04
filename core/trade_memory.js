const memory = [];

function add(signal) {
  memory.push({
    ...signal,
    createdAt: new Date().toISOString()
  });
}

function getAll() {
  return memory;
}

function analyze(filter = {}) {
  const rows = memory.filter(item => {
    return Object.keys(filter).every(key => item[key] === filter[key]);
  });

  if (!rows.length) {
    return {
      trades: 0,
      winRate: 0,
      avgR: 0
    };
  }

  const wins = rows.filter(x => Number(x.resultR) > 0).length;
  const totalR = rows.reduce((sum, x) => sum + Number(x.resultR || 0), 0);

  return {
    trades: rows.length,
    winRate: Number(((wins / rows.length) * 100).toFixed(2)),
    avgR: Number((totalR / rows.length).toFixed(2)),
    totalR: Number(totalR.toFixed(2))
  };
}

module.exports = {
  add,
  getAll,
  analyze
};
