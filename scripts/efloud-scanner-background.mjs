import { writeFile } from 'node:fs/promises';

const API = 'https://api.binance.com';
const OUTPUT = new URL('../docs/efloud-scanner-results.json', import.meta.url);
const ema = (v,n) => { const k=2/(n+1); let e=v[0]; for(let i=1;i<v.length;i++) e=v[i]*k+e*(1-k); return e; };
const atr = (c,n=14) => { const a=[]; for(let i=1;i<c.length;i++) a.push(Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c))); return a.slice(-n).reduce((s,x)=>s+x,0)/Math.min(n,a.length); };
const swings = (c,n=40) => { const x=c.slice(-n); return {hi:Math.max(...x.map(z=>z.h)),lo:Math.min(...x.map(z=>z.l))}; };
async function json(url){ const r=await fetch(url); if(!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function kl(symbol,interval,limit){ const a=await json(`${API}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`); return a.map(x=>({o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],t:x[0]})); }
function scoreOne(sym,h,l){
 const hc=h.map(x=>x.c),lc=l.map(x=>x.c),H=h.at(-1),L=l.at(-1),e20=ema(hc.slice(-80),20),e50=ema(hc.slice(-100),50),a=atr(h),sw=swings(h,36),range=sw.hi-sw.lo||1,pos=(H.c-sw.lo)/range; let side='WAIT',score=0,why=[];
 const up=e20>e50&&H.c>e20,dn=e20<e50&&H.c<e20;if(up){side='LONG';score+=2;why.push('4H trend bullish')}if(dn){side='SHORT';score+=2;why.push('4H trend bearish')}
 const nearLow=(H.c-sw.lo)/H.c<.035,nearHigh=(sw.hi-H.c)/H.c<.035;if(side==='LONG'&&nearLow){score+=2;why.push('HTF support/demand yakın')}if(side==='SHORT'&&nearHigh){score+=2;why.push('HTF resistance/supply yakın')}
 const le20=ema(lc.slice(-80),20),le50=ema(lc.slice(-100),50),prev=l.at(-2),bullReact=L.l<prev.l&&L.c>prev.c,bearReact=L.h>prev.h&&L.c<prev.c;if(side==='LONG'&&bullReact){score++;why.push('15M bullish reaction')}if(side==='SHORT'&&bearReact){score++;why.push('15M bearish reaction')}
 const reclaimLong=L.c>le20&&prev.c<=le20,reclaimShort=L.c<le20&&prev.c>=le20;if(side==='LONG'&&reclaimLong){score+=2;why.push('15M close/reclaim')}if(side==='SHORT'&&reclaimShort){score+=2;why.push('15M close/breakdown')}
 const lsw=swings(l,24),brLong=L.c>lsw.hi*.9995,brShort=L.c<lsw.lo*1.0005;if(side==='LONG'&&brLong){score++;why.push('LTF range high breakout')}if(side==='SHORT'&&brShort){score++;why.push('LTF range low breakdown')}
 const lAtr=atr(l),chop=Math.abs(le20-le50)/(lAtr||1)<.35;if(chop){score--;why.push('chop cezası')}const dist=side==='LONG'?(L.c-sw.lo):(sw.hi-L.c),rr=dist>0?(a*2)/dist:0;if(rr>=1.5){score++;why.push('RR alanı uygun')}
 score=Math.max(0,Math.min(10,score));const grade=score>=8?'A':score>=6?'B':'C';return {sym,side,score,grade,px:L.c,pos,why,htf:up?'UP':dn?'DOWN':'RANGE'};
}
const tickers=await json(`${API}/api/v3/ticker/24hr`);
const excluded=new Set(['USDCUSDT','FDUSDUSDT','TUSDUSDT','USDPUSDT','DAIUSDT','EURUSDT']);
const top=tickers.filter(x=>x.symbol.endsWith('USDT')&&!excluded.has(x.symbol)&&+x.quoteVolume>0).sort((a,b)=>+b.quoteVolume-+a.quoteVolume).slice(0,50);
const results=[];
for(let i=0;i<top.length;i+=5){
 const batch=await Promise.all(top.slice(i,i+5).map(async x=>{try{const [h,l]=await Promise.all([kl(x.symbol,'4h',120),kl(x.symbol,'15m',120)]);return scoreOne(x.symbol,h,l)}catch(error){console.warn(`${x.symbol}: ${error.message}`);return null}}));
 results.push(...batch.filter(Boolean)); await new Promise(resolve=>setTimeout(resolve,220));
}
results.sort((a,b)=>b.score-a.score);
await writeFile(OUTPUT,JSON.stringify({generatedAt:new Date().toISOString(),source:'GitHub Actions hourly scan',results},null,2)+'\n');
console.log(`Wrote ${results.length} results to ${OUTPUT.pathname}`);
