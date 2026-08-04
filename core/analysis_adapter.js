'use strict';

/**
 * Analysis Adapter Layer
 * Keeps the existing analysis engine isolated and adds intelligence metadata.
 */

function calculateConfidence(signal) {
  let score = 50;
  if (!signal) return 0;
  if (signal.score) score += Math.min(signal.score * 5, 25);
  if (signal.model) score += 10;
  if (signal.side && signal.side !== 'NONE') score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function adapt(signal, context = {}) {
  if (!signal) return null;

  const confidence = calculateConfidence(signal);

  return {
    ...signal,
    intelligence: {
      confidence,
      quality: confidence >= 85 ? 'A+' : confidence >= 70 ? 'A' : confidence >= 55 ? 'B' : 'C',
      regime: context.regime || 'UNKNOWN',
      risk: context.risk || 'UNKNOWN'
    },
    context: {
      session: context.session || null,
      htfBias: context.htfBias || null
    }
  };
}

module.exports = { adapt };
