'use strict';

/*
 * Güncel V34 strateji karar zincirini, mevcut lookahead-korumalı tarihsel
 * portföy simülatörüne bağlar. Veri kalitesi -> V34 context -> ensemble
 * sırasını uygular; ardından backtest3ay.js içindeki 5m muhafazakâr yürütme,
 * komisyon, kayma ve portföy limitleri kullanılır.
 */

const Analysis = require('./analysis');
const Context = require('./core/strategy_context_pipeline');
const DataQuality = require('./core/market_data_quality_engine');
const Ensemble = require('./core/strategy_ensemble');
const { detect: detectRegime } = require('./core/regime_detector');

const originalAnalyze = Analysis.analyze;
const stats = {
  version: '34.0',
  evaluated: 0,
  qualityRejected: 0,
  contextRejected: 0,
  ensembleRejected: 0,
  accepted: 0,
  reasons: {}
};

function reject(reason) {
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
}

Analysis.analyze = function analyzeV34(candles, options = {}) {
  stats.evaluated++;
  const quality = DataQuality.evaluate(candles, {
    minBars: Number(process.env.BACKTEST_MIN_QUALITY_BARS || 50),
    maxGapMultiplier: Number(process.env.BACKTEST_MAX_GAP_MULTIPLIER || 2.5)
  });
  if (!quality.valid) {
    stats.qualityRejected++;
    reject(quality.reason || 'DATA_QUALITY_FAILED');
    return {
      candles,
      setup: null,
      dataQuality: quality,
      rejectedReason: quality.reason || 'DATA_QUALITY_FAILED'
    };
  }

  const raw = originalAnalyze.call(this, candles, options);
  const withCandles = raw && raw.candles ? raw : { ...raw, candles };
  const contextual = Context.enhance(withCandles, {
    peerCandles: options.peerCandles,
    minConfluence: Number(process.env.BACKTEST_MIN_CONFLUENCE || 55)
  });

  if (raw?.setup && !contextual?.setup) {
    const reason = contextual?.strategyContext?.reason || contextual?.rejectedReason || 'CONTEXT_REJECTED';
    stats.contextRejected++;
    reject(reason);
    return contextual;
  }
  if (!contextual?.setup) return contextual;

  const candidates = Ensemble.candidatesFromAnalysis(contextual);
  const decision = Ensemble.evaluate(candidates, {
    regime: detectRegime(candles),
    minConsensus: Number(process.env.BACKTEST_ENSEMBLE_MIN_CONSENSUS || 0.58),
    minScore: Number(process.env.BACKTEST_ENSEMBLE_MIN_SCORE || 55)
  });

  if (!decision.accepted || decision.decision !== contextual.setup.side) {
    stats.ensembleRejected++;
    reject(decision.reason || 'ENSEMBLE_REJECTED');
    return {
      ...contextual,
      setup: null,
      rejectedSetup: contextual.setup,
      ensemble: decision,
      rejectedReason: decision.reason || 'ENSEMBLE_REJECTED'
    };
  }

  stats.accepted++;
  const model = decision.winnerModel || contextual.setup.model || 'UNKNOWN';
  return {
    ...contextual,
    setup: {
      ...contextual.setup,
      model,
      confidence: Math.round((Number(contextual.setup.confidence || 0) + Number(decision.blendedConfidence || 0)) / 2),
      ensemble: decision
    },
    ensemble: decision,
    dataQuality: quality
  };
};

process.once('exit', () => {
  const fs = require('fs');
  const path = require('path');
  const target = path.join(__dirname, 'backtest_v34_filter_stats.json');
  try { fs.writeFileSync(target, JSON.stringify({ ...stats, generatedAt: Date.now() }, null, 2)); }
  catch (_) {}
});

require('./backtest3ay');
