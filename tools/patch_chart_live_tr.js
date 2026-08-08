'use strict';
const fs=require('fs');
const p='docs/index.html';
let s=fs.readFileSync(p,'utf8');

function rep(a,b){
  if(!s.includes(a)) throw new Error('Patch hedefi bulunamadi: '+a.slice(0,100));
  s=s.replace(a,b);
}

rep(
"const NYs=t=>t?new Date(t).toLocaleString('en-US',{timeZone:'America/New_York',hour12:false}):'-';",
"const NYs=t=>t?new Date(t).toLocaleString('en-US',{timeZone:'America/New_York',hour12:false}):'-';\nconst TR=t=>t?new Date(t).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'-';\nconst TRs=t=>t?new Date(t).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',hour12:false}):'-';"
);

rep(
"function showChart(kind,idx){\n  if(!ST) return;\n  const t=(kind==='open'?ST.open:ST.closed)[idx];\n  if(!t) return;\n  document.getElementById('mtitle').textContent=t.symbol.replace('_','/')+' · '+(t.tf||'-')+' · '+t.side+' · güven %'+t.conf+' · '+t.grade+(t.mmxm?' · MMxM '+t.mmxm.score+'/'+t.mmxm.max+(t.mmxm.valid?' ✓':''):'');\n  document.getElementById('mfoot').textContent='Giriş anı görüntüsü (NY '+NYs(t.openedAt)+') — mumlar girişten ÖNCEKİ dönem · giriş '+fmt(t.entry)+' · SL '+fmt(t.sl)+(t.deriskDone?' (BE — TP1\\'de %50 kâr alındı, pozisyon artık kaybedemez)':'')+' · TP1 '+fmt(t.tp1)+' · TP-F '+fmt(t.tpF)+(t.fills&&t.fills.length?' · fill: '+t.fills.map(f=>f.why+'@'+fmt(f.px)).join(', '):'');\n  document.getElementById('mod').hidden=false;\n  drawSnap(t);\n}\nfunction drawSnap(t){",
"async function fetchChartCandles(t){\n  const iv={ '5m':'Min5','15m':'Min15','60m':'Min60','4h':'Hour4','1d':'Day1' }[t.tf||'60m']||'Min60';\n  const sn=t.snap&&t.snap.candles;\n  const first=sn&&sn.length?sn[0][0]*1000:(t.openedAt-48*3600000);\n  const end=t.status==='closed'&&t.closedAt?t.closedAt:Date.now();\n  const start=Math.max(first,t.openedAt-48*3600000);\n  try{\n    const u='https://contract.mexc.com/api/v1/contract/kline/'+encodeURIComponent(t.symbol)+'?interval='+iv+'&start='+Math.floor(start/1000)+'&end='+Math.floor(end/1000);\n    const r=await fetch(u+'&_='+Date.now(),{cache:'no-store'});\n    if(!r.ok)return [];\n    const j=await r.json(),d=j.data||{};\n    if(!d.time||!d.time.length)return [];\n    return d.time.map((x,i)=>({t:+x*1000,o:+d.open[i],h:+d.high[i],l:+d.low[i],c:+d.close[i]})).filter(x=>isFinite(x.c)&&x.c>0);\n  }catch(e){return [];}\n}\nasync function showChart(kind,idx){\n  if(!ST) return;\n  const t=(kind==='open'?ST.open:ST.closed)[idx];\n  if(!t) return;\n  document.getElementById('mtitle').textContent=t.symbol.replace('_','/')+' · '+(t.tf||'-')+' · '+t.side+' · güven %'+t.conf+' · '+t.grade+(t.mmxm?' · MMxM '+t.mmxm.score+'/'+t.mmxm.max+(t.mmxm.valid?' ✓':''):'');\n  document.getElementById('mfoot').textContent='Setup + giriş sonrası fiyat hareketi · Türkiye saati · giriş '+fmt(t.entry)+' · SL '+fmt(t.sl)+(t.deriskDone?' (BE — TP1\\'de %50 kâr alındı)':'')+' · TP1 '+fmt(t.tp1)+' · TP-F '+fmt(t.tpF)+(t.fills&&t.fills.length?' · fill: '+t.fills.map(f=>f.why+'@'+fmt(f.px)).join(', '):'');\n  document.getElementById('mod').hidden=false;\n  drawSnap(t,[]);\n  const live=await fetchChartCandles(t);\n  if(!document.getElementById('mod').hidden) drawSnap(t,live);\n}\nfunction drawSnap(t,liveCandles){"
);

rep(
"  const cs=sn.candles.map(a=>({t:a[0]*1000,o:a[1],h:a[2],l:a[3],c:a[4]}));",
"  const base=sn.candles.map(a=>({t:a[0]*1000,o:a[1],h:a[2],l:a[3],c:a[4]}));\n  const byT=new Map(base.map(x=>[x.t,x]));\n  for(const x of (liveCandles||[])) if(x.t>=base[0].t) byT.set(x.t,x);\n  const cs=[...byT.values()].sort((a,b)=>a.t-b.t);"
);

rep(
"  [t.entry,t.sl,t.tp1,t.tpF,origSL].forEach(v=>{if(v!=null){if(v<mn)mn=v;if(v>mx)mx=v;}});",
"  const cur=livePx(t);\n  [t.entry,t.sl,t.tp1,t.tpF,origSL,cur].forEach(v=>{if(v!=null){if(v<mn)mn=v;if(v>mx)mx=v;}});"
);

rep(
"  if(t.tpF!==t.tp1) lvl(t.tpF,'#26a269','TP-F',[5,3]);\n  ctx.fillStyle='#8b949e';ctx.font='9px Arial';ctx.textAlign='left';\n  ctx.fillText(NY(cs[0].t)+' NY',pL+2,H-8);\n  ctx.textAlign='right';ctx.fillText(NY(cs[cs.length-1].t)+' NY',pR-2,H-8);",
"  if(t.tpF!==t.tp1) lvl(t.tpF,'#26a269','TP-F',[5,3]);\n  if(cur!=null){\n    const y=Y(cur);ctx.strokeStyle='#e8c34a';ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(pL,y);ctx.lineTo(pR,y);ctx.stroke();ctx.setLineDash([]);\n    ctx.fillStyle='#b89420';ctx.fillRect(pR,y-8,66,15);ctx.fillStyle='#fff';ctx.font='bold 9px Arial';ctx.textAlign='left';ctx.fillText('GÜNCEL '+fmt(cur,4),pR+3,y+3);\n  }\n  const entryX=cs.findIndex(x=>x.t>=t.openedAt);\n  if(entryX>=0){const x=X(entryX);ctx.strokeStyle='rgba(232,195,74,.45)';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,pT);ctx.lineTo(x,pB);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e8c34a';ctx.font='9px Arial';ctx.textAlign='center';ctx.fillText('GİRİŞ',x,pT+9);}\n  ctx.fillStyle='#8b949e';ctx.font='9px Arial';ctx.textAlign='left';\n  ctx.fillText(TR(cs[0].t)+' TR',pL+2,H-8);\n  ctx.textAlign='right';ctx.fillText(TR(cs[cs.length-1].t)+' TR',pR-2,H-8);"
);

rep("· tüm saatler <b>New York (NY)</b> ·","· grafik saatleri <b>Türkiye (TR)</b> ·");

fs.writeFileSync(p,s);
console.log('docs/index.html patchlendi');
