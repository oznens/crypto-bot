'use strict';
const assert=require('assert');
const E=require('../core/execution_cost_engine');
const ok=E.evaluate({side:'LONG',entry:100,stop:99,target:103,feeBps:5,slippageBps:3,spreadBps:2});
assert.equal(ok.valid,true);
const bad=E.evaluate({side:'LONG',entry:100,stop:99,target:101.2,feeBps:10,slippageBps:10,spreadBps:5});
assert.equal(bad.valid,false);
assert.equal(E.evaluate({entry:100,stop:100,target:101}).reason,'INVALID_TRADE_GEOMETRY');
console.log('execution_cost_engine tests passed');
