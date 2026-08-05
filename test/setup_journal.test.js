'use strict';
const assert = require('assert');
const J = require('../core/setup_journal');
const rows = [];
const item = J.upsert(rows, {
  symbol:'BTC_USDT',tf:'15m',model:'Turtle Soup',anchor:123,
  status:'WATCHING',decision:'SETUP_FOUND',reason:'LTF_CONFIRMATION_PENDING',
  setup:{side:'LONG',model:'Turtle Soup',confidence:82,entry:100,stop:98,tps:[103,106],rr:3,reasons:['sweep']},
  context:{version:'34.0',accepted:true,confluence:{score:84,grade:'A',valid:true,breakdown:[]}}
}, { now:1000, limit:100 });
assert.equal(rows.length,1);
assert.equal(item.id,'BTC_USDT|15m|Turtle-Soup|123');
assert.equal(item.setup.targets.length,2);
J.upsert(rows,{id:item.id,status:'REJECTED',decision:'NO_TRADE',reason:'TIMEFRAME_CONFLICT'},{now:2000});
assert.equal(rows[0].firstSeenAt,1000);
assert.equal(rows[0].lastSeenAt,2000);
assert.equal(rows[0].reason,'TIMEFRAME_CONFLICT');
J.linkTrade(rows,item.id,{id:'t1',symbol:'BTC_USDT',tf:'15m',side:'LONG',model:'Turtle Soup',grade:'A',conf:82,entry:100,initialSL:98,tp1:103,tpF:106,rrPlan:3,reasons:['sweep'],status:'open',snap:{candles:[]}});
assert.equal(rows[0].status,'OPENED');
assert.equal(rows[0].tradeId,'t1');
J.linkTrade(rows,item.id,{id:'t1',symbol:'BTC_USDT',tf:'15m',side:'LONG',model:'Turtle Soup',grade:'A',conf:82,entry:100,initialSL:98,tp1:103,tpF:106,rrPlan:3,reasons:['sweep'],status:'closed',closedAt:3000,resultR:2,closeReason:'TP'});
assert.equal(rows[0].status,'CLOSED');
assert.equal(J.summary(rows).closed,1);
console.log('setup_journal tests passed');
