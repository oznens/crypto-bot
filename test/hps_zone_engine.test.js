'use strict';
const assert=require('assert');
const H=require('../core/hps_zone_engine');
const rows=[
 {h:101,l:99.5,c:100.5},{h:104,l:100.2,c:103.5},{h:106,l:103,c:105},
 {h:107,l:104,c:106},{h:108,l:105,c:107},{h:108.5,l:106,c:108}
];
const r=H.evaluate({top:101,bottom:99,from:0},rows,'LONG',{minScore:50});
assert.equal(r.valid,true);
assert.ok(r.score>=50);
assert.equal(H.evaluate(null,rows,'LONG').reason,'ZONE_DATA_MISSING');
assert.equal(H.evaluate({top:99,bottom:101},rows,'LONG').reason,'ZONE_GEOMETRY_INVALID');
console.log('hps_zone_engine tests passed');
