'use strict';

const allowedEngines = ['legacy','v34'];
const allowedSymbolModes = ['top10','top30','manual'];

function validate(config){
  const errors=[];
  if(!allowedEngines.includes(config.engine)) errors.push('invalid engine');
  if(!config.startDate) errors.push('startDate required');
  if(!config.endDate) errors.push('endDate required');
  if(config.startDate && config.endDate && new Date(config.endDate)<=new Date(config.startDate)) errors.push('invalid date range');
  if(Number(config.riskPercent)<=0 || Number(config.riskPercent)>5) errors.push('risk out of range');
  if(!config.symbols || !allowedSymbolModes.includes(config.symbols.mode)) errors.push('invalid symbols mode');
  if(!Array.isArray(config.timeframes)) errors.push('invalid timeframes');
  return {valid: errors.length===0, errors};
}

module.exports={validate};
