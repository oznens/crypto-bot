(()=>{
  const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>v==null?'—':Number(v).toLocaleString('tr-TR',{maximumFractionDigits:8});
  const dt=v=>v?new Date(v).toLocaleString('tr-TR'):'—';
  const status=s=>`<span class="trade-status trade-${String(s).toLowerCase()}">${e(s)}</span>`;
  let root=document.getElementById('history');
  if(!root){root=document.createElement('section');root.id='history';root.className='history';document.querySelector('main').appendChild(root)}
  async function loadHistory(){
    try{
      const r=await fetch(`signal-history.json?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error('Geçmiş dosyası yüklenemedi');
      const h=await r.json(),s=h.stats||{},trades=(h.trades||[]).slice().sort((a,b)=>Date.parse(b.openedAt)-Date.parse(a.openedAt)).slice(0,100);
      const stats=[['Toplam sinyal',s.total||0],['Entry bekliyor',s.pending||0],['Aktif',s.open||0],['TP1 aktif',s.tp1Active||0],['TP2',s.tp2||0],['Stop',s.stops||0],['Başarı oranı',s.winRate==null?'—':`${n(s.winRate)}%`],['Toplam sonuç',`${n(s.totalR||0)}R`]];
      root.innerHTML=`<div class="history-head"><div><h2>Sinyal Geçmişi</h2><div class="muted">Sinyal önce PENDING olarak kaydolur; entry görülünce OPEN olur · Aynı mumda SL ve TP görülürse temkinli olarak STOP sayılır</div></div><div class="muted">Son güncelleme: ${dt(h.updatedAt)}</div></div><div class="history-stats">${stats.map(x=>`<div class="history-stat"><b>${e(x[0])}</b><span>${e(x[1])}</span></div>`).join('')}</div><div class="history-table-wrap">${trades.length?`<table><thead><tr><th>Durum</th><th>Sembol</th><th>Yön</th><th>Sinyal</th><th>Açılış</th><th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>Skor</th><th>Kapanış</th><th>Sonuç</th></tr></thead><tbody>${trades.map(t=>`<tr><td>${status(t.status)}</td><td><b>${e(t.symbol)}</b></td><td class="${t.side==='BUY'?'buy':'sell'}">${e(t.side)}</td><td>${dt(t.signalAt||t.openedAt)}</td><td>${dt(t.openedAt)}</td><td>${n(t.entry)}</td><td>${n(t.sl)}</td><td>${n(t.tp1)}</td><td>${n(t.tp2)}</td><td>${n(t.confidence)}/100</td><td>${dt(t.closedAt)}</td><td>${t.outcomeR==null?'—':`${n(t.outcomeR)}R`}</td></tr>`).join('')}</tbody></table>`:'<div class="history-empty">Henüz kayıtlı, tüm koşulları karşılayan bir sinyal yok.</div>'}</div>`;
    }catch(err){root.innerHTML=`<div class="history-empty">Sinyal geçmişi bekleniyor: ${e(err.message)}</div>`}
  }
  loadHistory();setInterval(loadHistory,60000);
})();
