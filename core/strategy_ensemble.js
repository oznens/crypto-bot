'use strict';

function n(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, n(value)));
}

const REGIME_BONUS = {
  TREND_UP: { LONG: 1.15, SHORT: 0.75 },
  TREND_DOWN: { LONG: 0.75, SHORT: 1.15 },
  RANGE: { LONG: 1.0, SHORT: 1.0 },
  HIGH_VOLATILITY: { LONG: 0.85, SHORT: 0.85 },
  UNKNOWN: { LONG: 0.9, SHORT: 0.9 }
};

function normalizeCandidate(candidate, index = 0) {
  const side = String(candidate?.side || '').toUpperCase();
  if (!['LONG', 'SHORT'].includes(side)) return null;
  return {
    model: String(candidate?.model || `MODEL_${index + 1}`),
    side,
    confidence: clamp(candidate?.confidence, 0, 100),
    weight: clamp(candidate?.weight == null ? 1 : candidate.weight, 0, 5),
    source: candidate?.source || 'strategy'
  };
}

function regimeFactor(regime, side) {
  return REGIME_BONUS[regime]?.[side] || REGIME_BONUS.UNKNOWN[side];
}

function evaluate(candidates, options = {}) {
  const regime = options.regime || 'UNKNOWN';
  const minConsensus = clamp(options.minConsensus == null ? 0.58 : options.minConsensus, 0.5, 1);
  const minScore = Math.max(0, n(options.minScore, 55));
  const rows = (Array.isArray(candidates) ? candidates : [])
    .map(normalizeCandidate)
    .filter(Boolean)
    .map(row => {
      const adjustedWeight = row.weight * regimeFactor(regime, row.side);
      const score = row.confidence * adjustedWeight;
      return { ...row, adjustedWeight, score };
    });

  const longScore = rows.filter(r => r.side === 'LONG').reduce((s, r) => s + r.score, 0);
  const shortScore = rows.filter(r => r.side === 'SHORT').reduce((s, r) => s + r.score, 0);
  const total = longScore + shortScore;
  const side = longScore === shortScore ? 'NO_TRADE' : (longScore > shortScore ? 'LONG' : 'SHORT');
  const winningScore = Math.max(longScore, shortScore);
  const losingScore = Math.min(longScore, shortScore);
  const consensus = total > 0 ? winningScore / total : 0;
  const conflictPenalty = total > 0 ? losingScore / total : 0;
  const accepted = rows.length > 0 && side !== 'NO_TRADE' && consensus >= minConsensus && winningScore >= minScore;
  const supporters = rows.filter(r => r.side === side).sort((a, b) => b.score - a.score);
  const winner = supporters[0] || null;
  const blendedConfidence = supporters.length
    ? supporters.reduce((s, r) => s + r.confidence * r.adjustedWeight, 0) /
      supporters.reduce((s, r) => s + r.adjustedWeight, 0)
    : 0;

  return {
    version: '9.0',
    regime,
    accepted,
    decision: accepted ? side : 'NO_TRADE',
    winnerModel: winner?.model || null,
    consensus: +consensus.toFixed(4),
    conflictPenalty: +conflictPenalty.toFixed(4),
    longScore: +longScore.toFixed(2),
    shortScore: +shortScore.toFixed(2),
    blendedConfidence: +blendedConfidence.toFixed(2),
    candidateCount: rows.length,
    candidates: rows,
    reason: accepted
      ? 'strateji uzlaşması ve rejim uyumu yeterli'
      : rows.length === 0
        ? 'geçerli strateji adayı yok'
        : side === 'NO_TRADE'
          ? 'stratejiler eşit derecede çelişkili'
          : consensus < minConsensus
            ? 'strateji uzlaşması yetersiz'
            : 'toplam strateji skoru yetersiz'
  };
}

function candidatesFromAnalysis(result) {
  if (Array.isArray(result?.strategySignals) && result.strategySignals.length) {
    return result.strategySignals;
  }
  const setup = result?.setup;
  if (!setup) return [];
  const rows = [{
    model: setup.model || 'PRIMARY',
    side: setup.side,
    confidence: setup.confidence,
    weight: 1.2,
    source: 'primary'
  }];
  if (setup.mmxm?.valid) rows.push({
    model: 'MMXM_CONFIRMATION', side: setup.side,
    confidence: Math.min(100, n(setup.confidence) + 5), weight: 0.8, source: 'mmxm'
  });
  if (result.htfBias && result.htfBias !== 'Neutral') rows.push({
    model: 'HTF_BIAS',
    side: result.htfBias === 'Bullish' ? 'LONG' : 'SHORT',
    confidence: 70,
    weight: 0.7,
    source: 'htf'
  });
  return rows;
}

module.exports = { normalizeCandidate, regimeFactor, evaluate, candidatesFromAnalysis };
