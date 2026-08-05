'use strict';
const assert = require('assert');
const P = require('../core/strategy_context_pipeline');
const t=Date.UTC(2026,0,5,15,30);
const candles=[
 {t:t-120000,o:100,h:101,l:99,c:100},
 {t:t-60000,o:101,h:103,l:100,c:102},
 {t,o:104,h:106,l:102,c:105},
 {t:t+60000,o:105,h:107,l:103,c:106},
 {t:t+120000,o:106,h:108,l:104,c:107}
];
const result=P.enhance({
 candles,lastPrice:107,htfBias:'Bullish',ltfBias:'LONG',
 structures:{trend:'UP',displacement:true},
 intelligence:{regime:'TREND_UP'},
 setup:{side:'LONG',model:'MM Buy Model',confidence:80,entry:107,tps:[109,110],fvg:true,orderBlock:true}
});
assert.ok(result.setup);
assert.ok(result.setup.context);
assert.ok(result.setup.context.mtf.valid);
assert.ok(result.setup.context.confluence.valid);
const conflict=P.enhance({
 candles,lastPrice:107,htfBias:'Bearish',structures:{trend:'UP'},
 setup:{side:'LONG',model:'MM Buy Model',confidence:90,entry:107,tps:[109],fvg:true,orderBlock:true}
});
assert.equal(conflict.setup,null);
const blocked=P.enhance({
 candles: candles.map((c,i)=>({...c,t:Date.UTC(2026,0,5,4,i)})),
 htfBias:'Bullish',structures:{trend:'UP',displacement:true},
 setup:{side:'LONG',model:'Silver Bullet FVG',confidence:90,entry:107,tps:[109],fvg:true,orderBlock:true}
});
assert.equal(blocked.setup,null);
console.log('strategy_context_pipeline tests passed');
