'use strict';

const fs=require('fs');
const defaults=require('./defaults');
const {validate}=require('./config_validator');

function load(file='backtest/config.json'){
  let custom={};
  if(fs.existsSync(file)) custom=JSON.parse(fs.readFileSync(file,'utf8'));
  const config={
    ...defaults,
    ...custom,
    symbols:{...defaults.symbols,...(custom.symbols||{})},
    execution:{...defaults.execution,...(custom.execution||{})}
  };
  const result=validate(config);
  if(!result.valid) throw new Error(result.errors.join(', '));
  return config;
}

module.exports={load};
