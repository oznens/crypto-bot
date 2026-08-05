'use strict';

const StrategyPolicy = require('./strategy_trade_policy');

function createExecutionAdapter(options = {}) {
  if (typeof options.calculatePosition !== 'function') {
    throw new TypeError('calculatePosition fonksiyonu gerekli');
  }

  const allocation = options.allocation || null;
  const calculatePosition = options.calculatePosition;
  let currentModel = 'UNKNOWN';
  const telemetry = {
    evaluated: 0,
    allowed: 0,
    paused: 0,
    active: 0,
    watch: 0,
    unranked: 0,
    reducedRisk: 0,
    increasedRisk: 0,
    lastDecision: null
  };

  function setModel(model) {
    currentModel = String(model || 'UNKNOWN');
    return currentModel;
  }

  function calculate(args = {}) {
    const decision = StrategyPolicy.decide(allocation, currentModel, options.policyOptions);
    telemetry.evaluated++;
    telemetry.lastDecision = {
      model: currentModel,
      status: decision.status,
      multiplier: decision.multiplier,
      allowed: decision.allowed,
      reason: decision.reason
    };

    if (!decision.allowed) {
      telemetry.paused++;
      return {
        valid: false,
        reason: 'STRATEGY_PAUSED',
        qty: 0,
        plannedRiskUSD: 0,
        actualRiskUSD: 0,
        riskDist: Math.abs(Number(args.entry) - Number(args.stop)),
        strategyDecision: decision
      };
    }

    telemetry.allowed++;
    if (decision.status === 'ACTIVE') telemetry.active++;
    else if (decision.status === 'WATCH') telemetry.watch++;
    else telemetry.unranked++;
    if (decision.multiplier < 1) telemetry.reducedRisk++;
    if (decision.multiplier > 1) telemetry.increasedRisk++;

    const adjustedRiskPct = StrategyPolicy.adjustedRiskPct(args.riskPct, decision);
    const result = calculatePosition({ ...args, riskPct: adjustedRiskPct });
    return {
      ...result,
      baseRiskPct: Number(args.riskPct) || 0,
      adjustedRiskPct,
      strategyDecision: decision
    };
  }

  function snapshot(now = Date.now()) {
    return {
      version: '8.0',
      generatedAt: Number(now),
      allocationVersion: allocation?.version || null,
      ...telemetry
    };
  }

  return { setModel, calculate, snapshot };
}

module.exports = { createExecutionAdapter };
