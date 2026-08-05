'use strict';

const StrategyPolicy = require('./strategy_trade_policy');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function createExecutionAdapter(options = {}) {
  if (typeof options.calculatePosition !== 'function') {
    throw new TypeError('calculatePosition fonksiyonu gerekli');
  }

  const allocation = options.allocation || null;
  const calculatePosition = options.calculatePosition;
  let currentModel = 'UNKNOWN';
  let currentContextMultiplier = 1;
  const telemetry = {
    evaluated: 0,
    allowed: 0,
    paused: 0,
    active: 0,
    watch: 0,
    unranked: 0,
    reducedRisk: 0,
    increasedRisk: 0,
    contextReducedRisk: 0,
    lastDecision: null
  };

  function setModel(model) {
    currentModel = String(model || 'UNKNOWN');
    return currentModel;
  }

  function setRiskMultiplier(multiplier) {
    currentContextMultiplier = clamp(multiplier == null ? 1 : multiplier, 0, 1.25);
    return currentContextMultiplier;
  }

  function calculate(args = {}) {
    const decision = StrategyPolicy.decide(allocation, currentModel, options.policyOptions);
    const contextMultiplier = currentContextMultiplier;
    currentContextMultiplier = 1;
    telemetry.evaluated++;
    const combinedMultiplier = +(decision.multiplier * contextMultiplier).toFixed(4);
    telemetry.lastDecision = {
      model: currentModel,
      status: decision.status,
      allocationMultiplier: decision.multiplier,
      contextMultiplier,
      multiplier: combinedMultiplier,
      allowed: decision.allowed && contextMultiplier > 0,
      reason: contextMultiplier <= 0 ? 'PORTFOLIO_CONTEXT_BLOCKED' : decision.reason
    };

    if (!decision.allowed || contextMultiplier <= 0) {
      telemetry.paused++;
      return {
        valid: false,
        reason: contextMultiplier <= 0 ? 'PORTFOLIO_CONTEXT_BLOCKED' : 'STRATEGY_PAUSED',
        qty: 0,
        plannedRiskUSD: 0,
        actualRiskUSD: 0,
        riskDist: Math.abs(Number(args.entry) - Number(args.stop)),
        strategyDecision: decision,
        contextRiskMultiplier: contextMultiplier
      };
    }

    telemetry.allowed++;
    if (decision.status === 'ACTIVE') telemetry.active++;
    else if (decision.status === 'WATCH') telemetry.watch++;
    else telemetry.unranked++;
    if (combinedMultiplier < 1) telemetry.reducedRisk++;
    if (combinedMultiplier > 1) telemetry.increasedRisk++;
    if (contextMultiplier < 1) telemetry.contextReducedRisk++;

    const allocationAdjustedRiskPct = StrategyPolicy.adjustedRiskPct(args.riskPct, decision);
    const adjustedRiskPct = +(allocationAdjustedRiskPct * contextMultiplier).toFixed(8);
    const result = calculatePosition({ ...args, riskPct: adjustedRiskPct });
    return {
      ...result,
      baseRiskPct: Number(args.riskPct) || 0,
      allocationAdjustedRiskPct,
      adjustedRiskPct,
      contextRiskMultiplier: contextMultiplier,
      strategyDecision: decision
    };
  }

  function snapshot(now = Date.now()) {
    return {
      version: '26.0',
      generatedAt: Number(now),
      allocationVersion: allocation?.version || null,
      ...telemetry
    };
  }

  return { setModel, setRiskMultiplier, calculate, snapshot };
}

module.exports = { clamp, createExecutionAdapter };
