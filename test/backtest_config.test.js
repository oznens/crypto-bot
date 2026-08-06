'use strict';
const assert=require('assert');
const {validate}=require('../backtest/config_validator');

assert.equal(validate({
 engine:'legacy',
 startDate:'2026-06-01',
 endDate:'2026-07-01',
 riskPercent:1,
 symbols:{mode:'top30'},
 timeframes:['15m']
}).valid,true);

assert.equal(validate({engine:'bad',riskPercent:10,symbols:{mode:'x'}}).valid,false);

console.log('backtest config tests passed');
