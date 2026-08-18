/*
 * MEXC Futures top-50 ICT staged scanner
 * TS+ -> MSS -> OB -> IFVG -> retracement -> 15M CISD -> automatic setup
 * Public market data only; this scanner publishes setups, it does not place orders.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = process.env.ICT_SCANNER_OUT || path.join(__dirname, 'docs', 'ict-scanner', 'data.json');
const MAX_SYMBOLS = +(process.env.ICT_MAX_SYMBOLS || 50);
const MIN_VOLUME = +(process.env.ICT_MIN_VOLUME || 0);
const BASE = 'https://contract.mexc.com';
const IV = { '15m': 'Min15', '4h': 'Hour4' };
const SEC = { '15m': 900, '4h': 14400 };

function getJSON(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'crypto-bot-mexc-ict/2.0' }, timeout }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const round = (x, n = 6) => Number.isFinite(+x) ? +(+x).toFixed(n) : null;

async function topSymbols() {
  const j = await getJSON(`${BASE}/api/v1/contract/ticker`);
  return (j.data || [])
    .filter(x => /_USDT$/.test(x.symbol || '') && +x.lastPrice > 0 && (+x.amount24 || +x.volume24 || 0) >= MIN_VOLUME)
    .sort((a, b) => (+b.amount24 || +b.volume24 || 0) - (+a.amount24 || +a.volume24 || 0))
    .slice(0, MAX_SYMBOLS)
    .map(x => ({ symbol: x.symbol, lastPrice: +x.lastPrice, turnover24h: +x.amount24 || +x.volume24 || 0 }));
}

async function klines(symbol, tf, bars = 320) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - bars * SEC[tf];
  const j = await getJSON(`${BASE}/api/v1/contract/kline/${encodeURIComponent(symbol)}?interval=${IV[tf]}&start=${start}&end=${end}`);
  const d = j.data || {};
  if (!Array.isArray(d.time)) throw new Error('kline yok');
  return d.time.map((t, i) => ({ t: +t * 1000, o: +d.open[i], h: +d.high[i], l: +d.low[i], c: +d.close[i], v: +(d.vol?.[i] || 0) }))
    .filter(k => [k.t, k.o, k.h, k.l, k.c].every(Number.isFinite) && k.c > 0);
}

function atr(c, p = 14) {
  if (c.length < p + 2) return 0;
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c)));
  return tr.slice(-p).reduce((a,b)=>a+b,0)/p;
}
function pivots(c, w = 3) {
  const highs=[], lows=[];
  for (let i=w;i<c.length-w;i++) {
    let hi=true,lo=true;
    for (let j=i-w;j<=i+w;j++) if(j!==i){ if(c[j].h>=c[i].h)hi=false; if(c[j].l<=c[i].l)lo=false; }
    if(hi)highs.push({i,t:c[i].t,p:c[i].h}); if(lo)lows.push({i,t:c[i].t,p:c[i].l});
  }
  return {highs,lows};
}
function lastBefore(a,i){for(let n=a.length-1;n>=0;n--)if(a[n].i<i)return a[n];return null}
function latestSweep(c,pv){
  let best=null; const start=Math.max(10,c.length-60);
  for(let i=start;i<c.length;i++){
    const ph=lastBefore(pv.highs,i),pl=lastBefore(pv.lows,i);
    if(ph&&c[i].h>ph.p&&c[i].c<ph.p)best={side:'SHORT',i,t:c[i].t,level:ph.p,extreme:c[i].h};
    if(pl&&c[i].l<pl.p&&c[i].c>pl.p)best={side:'LONG',i,t:c[i].t,level:pl.p,extreme:c[i].l};
  }
  return best;
}
function findMSS(c,pv,sw){
  if(!sw)return null; const a=atr(c)||1e-12;
  const ref=sw.side==='SHORT'?lastBefore(pv.lows,sw.i+1):lastBefore(pv.highs,sw.i+1); if(!ref)return null;
  for(let i=sw.i+1;i<c.length;i++){
    const body=Math.abs(c[i].c-c[i].o), broken=sw.side==='SHORT'?c[i].c<ref.p:c[i].c>ref.p;
    const dir=sw.side==='SHORT'?c[i].c<c[i].o:c[i].c>c[i].o;
    if(broken&&dir&&body>=a*.55)return {i,t:c[i].t,level:ref.p,displacement:body/a};
  } return null;
}
function findOB(c,side,mss){if(!mss)return null;for(let i=mss.i-1;i>=Math.max(0,mss.i-12);i--){const opp=side==='SHORT'?c[i].c>c[i].o:c[i].c<c[i].o;if(opp)return{i,t:c[i].t,low:c[i].l,high:c[i].h}}return null}
function allFVG(c){const a=[];for(let i=2;i<c.length;i++){if(c[i-2].h<c[i].l)a.push({type:'bull',i,t:c[i].t,low:c[i-2].h,high:c[i].l});if(c[i-2].l>c[i].h)a.push({type:'bear',i,t:c[i].t,low:c[i].h,high:c[i-2].l})}return a}
function findIFVG(c,side,sw,mss){
  if(!mss)return null; const wanted=side==='SHORT'?'bull':'bear'; let best=null;
  for(const f of allFVG(c).filter(x=>x.type===wanted&&x.i>=Math.max(2,sw.i-10)&&x.i<=mss.i+8)){
    let inversion=-1,retest=-1;
    for(let i=f.i+1;i<c.length;i++){if((side==='SHORT'&&c[i].c<f.low)||(side==='LONG'&&c[i].c>f.high)){inversion=i;break}}
    if(inversion<0)continue;
    for(let i=inversion+1;i<c.length;i++){if(c[i].h>=f.low&&c[i].l<=f.high){retest=i;break}}
    best={...f,inversion,inversionTime:c[inversion].t,retest,retestTime:retest>=0?c[retest].t:null};
  } return best;
}
function overlap(a,b){if(!a||!b)return null;const low=Math.max(a.low,b.low),high=Math.min(a.high,b.high);return high>low?{low,high}:null}
function targetLiquidity(c,pv,side,from){
  const px=c[c.length-1].c; const pool=side==='SHORT'?pv.lows.filter(x=>x.i<from&&x.p<px):pv.highs.filter(x=>x.i<from&&x.p>px);
  if(pool.length)return pool[pool.length-1]; const s=c.slice(Math.max(0,from-120),from+1); if(!s.length)return null;
  const k=side==='SHORT'?s.reduce((a,b)=>a.l<b.l?a:b):s.reduce((a,b)=>a.h>b.h?a:b); return {t:k.t,p:side==='SHORT'?k.l:k.h};
}
function ltfCISD(c,side){
  if(!c||c.length<25)return null; const a=atr(c)||1e-12;
  for(let i=c.length-2;i>=Math.max(3,c.length-55);i--){const opp=side==='SHORT'?c[i].c>c[i].o:c[i].c<c[i].o;if(!opp)continue;const level=c[i].o;
    for(let j=i+1;j<c.length;j++){const body=Math.abs(c[j].c-c[j].o),ok=side==='SHORT'?c[j].c<level:c[j].c>level,dir=side==='SHORT'?c[j].c<c[j].o:c[j].c>c[j].o;if(ok&&dir&&body>=a*.35)return{i:j,t:c[j].t,level}}
  } return null;
}
function stageFor(x){if(!x.sweep)return{n:0,key:'WAITING',label:'Likidite süpürmesi bekleniyor'};if(!x.mss)return{n:1,key:'LIQUIDITY_SWEPT',label:'TS+ tamam · MSS bekleniyor'};if(!x.ob)return{n:2,key:'MSS',label:'MSS tamam · OB aranıyor'};if(!x.ifvg)return{n:3,key:'OB_FOUND',label:'OB tamam · IFVG bekleniyor'};if(x.ifvg.retest<0)return{n:4,key:'IFVG',label:'IFVG hazır · retracement bekleniyor'};if(!x.cisd)return{n:5,key:'RETRACEMENT',label:'Retracement tamam · 15M CISD bekleniyor'};return{n:8,key:'ENTRY_READY',label:'MEXC Futures setup hazır'}}

async function analyzeSymbol(meta){
  const c4=await klines(meta.symbol,'4h',340); if(c4.length<100)throw new Error('4H veri yetersiz');
  const closed4=c4.slice(0,-1),pv=pivots(closed4,3),sweep=latestSweep(closed4,pv),side=sweep?.side||null;
  const mss=sweep?findMSS(closed4,pv,sweep):null,ob=mss?findOB(closed4,side,mss):null,ifvg=mss?findIFVG(closed4,side,sweep,mss):null,ov=overlap(ob,ifvg);
  let cisd=null; if(ifvg&&ifvg.retest>=0){const c15=await klines(meta.symbol,'15m',300);cisd=ltfCISD(c15.slice(0,-1),side)}
  const target=sweep?targetLiquidity(closed4,pv,side,sweep.i):null,current=c4[c4.length-1].c,invalidation=sweep?sweep.extreme:null;
  const zone=ov||(ifvg?{low:ifvg.low,high:ifvg.high}:ob?{low:ob.low,high:ob.high}:null),entry=zone?(zone.low+zone.high)/2:null;
  const risk=entry&&invalidation?Math.abs(entry-invalidation):null,reward=entry&&target?Math.abs(target.p-entry):null,rr=risk>0?reward/risk:null;
  const invalid=side==='SHORT'?current>invalidation:side==='LONG'?current<invalidation:false;
  const checks=[!!sweep,!!mss,!!ob,!!ifvg,!!(ifvg&&ifvg.retest>=0),!!cisd,!!target,!!(rr&&rr>=1.5)];
  const score=checks.filter(Boolean).length; let stage=stageFor({sweep,mss,ob,ifvg,cisd});
  if(invalid)stage={n:stage.n,key:'INVALIDATED',label:'Setup geçersiz oldu'};
  const ready=!invalid&&stage.key==='ENTRY_READY'&&rr>=1.5&&entry&&invalidation&&target;
  const grade=ready?'A+':score>=6&&rr>=1.25?'A':score>=4?'B':'WATCH';
  const setup=ready?{exchange:'MEXC Futures',symbol:meta.symbol,side,entry:round(entry),sl:round(invalidation),tp:round(target.p),rr:round(rr,2),timeframe:'4H→15M',trigger:'TS+ → MSS → OB → IFVG → retracement → CISD'}:null;
  return {symbol:meta.symbol,side,price:round(current),turnover24h:round(meta.turnover24h,0),updatedAt:Date.now(),score,maxScore:8,grade,ready,setup,stage,
    levels:{sweep:sweep?round(sweep.level):null,sweepExtreme:sweep?round(sweep.extreme):null,mss:mss?round(mss.level):null,ob:ob?{low:round(ob.low),high:round(ob.high),time:ob.t}:null,ifvg:ifvg?{low:round(ifvg.low),high:round(ifvg.high),time:ifvg.t,inversionTime:ifvg.inversionTime,retestTime:ifvg.retestTime}:null,overlap:ov?{low:round(ov.low),high:round(ov.high)}:null,cisd:cisd?round(cisd.level):null,target:target?round(target.p):null,invalidation:invalidation?round(invalidation):null,entry:entry?round(entry):null,rr:rr?round(rr,2):null},
    events:{sweep:sweep?{time:sweep.t,label:side==='SHORT'?'TS+ buyside sweep':'TS+ sellside sweep'}:null,mss:mss?{time:mss.t,label:'MSS',displacementATR:round(mss.displacement,2)}:null,cisd:cisd?{time:cisd.t,label:'15M CISD'}:null},
    checks:[{label:'TS+ liquidity sweep',ok:!!sweep},{label:'MSS + displacement',ok:!!mss},{label:'Order Block',ok:!!ob},{label:'IFVG',ok:!!ifvg},{label:'IFVG retracement',ok:!!(ifvg&&ifvg.retest>=0)},{label:'15M CISD',ok:!!cisd},{label:'Liquidity target',ok:!!target},{label:'RR ≥ 1.5',ok:!!(rr&&rr>=1.5)}],
    candles4h:c4.slice(-140).map(k=>[Math.floor(k.t/1000),round(k.o),round(k.h),round(k.l),round(k.c)])};
}

(async()=>{
  const started=Date.now(),symbols=await topSymbols(),results=[],errors=[];
  for(const meta of symbols){try{results.push(await analyzeSymbol(meta))}catch(e){errors.push({symbol:meta.symbol,error:e.message})}await sleep(140)}
  results.sort((a,b)=>(+b.ready)-(+a.ready)||b.score-a.score||(b.levels.rr||0)-(a.levels.rr||0));
  const readySetups=results.filter(x=>x.ready).map(x=>x.setup);
  const payload={source:'MEXC Futures',generatedAt:Date.now(),strategy:'TS+ → MSS → OB → IFVG → Retracement → 15M CISD',universe:{requested:MAX_SYMBOLS,scanned:results.length,errors:errors.length},readyCount:readySetups.length,readySetups,results,errors,durationMs:Date.now()-started};
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(payload,null,2));
  console.log(`MEXC FUTURES: ${results.length} tarandı | ${readySetups.length} setup hazır`); readySetups.forEach(s=>console.log(`${s.symbol} ${s.side} ENTRY ${s.entry} SL ${s.sl} TP ${s.tp} RR ${s.rr}`));
})().catch(e=>{console.error(e);process.exit(1)});
