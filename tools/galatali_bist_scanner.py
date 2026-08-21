#!/usr/bin/env python3
import json, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from tvDatafeed import TvDatafeed, Interval
from galatali_bist_universe import get_bist_stocks

OUT = Path('data/galatali_bist'); OUT.mkdir(parents=True, exist_ok=True)
PATTERNS = {
    'Gartley':{'b':(0.56,0.68),'bc':(0.35,0.92),'cd':(1.05,1.70),'d':(0.74,0.82)},
    'Bat':{'b':(0.34,0.54),'bc':(0.35,0.92),'cd':(1.50,2.75),'d':(0.84,0.92)},
    'Butterfly':{'b':(0.74,0.83),'bc':(0.35,0.92),'cd':(1.50,2.35),'d':(1.20,1.68)},
    'Crab':{'b':(0.34,0.66),'bc':(0.35,0.92),'cd':(2.10,3.80),'d':(1.50,1.72)},
}
_tls=threading.local()
def tv():
    if not hasattr(_tls,'c'): _tls.c=TvDatafeed()
    return _tls.c

def fetch(symbol,tf):
    try:
        iv=Interval.in_daily if tf=='1d' else Interval.in_weekly
        n=520 if tf=='1d' else 260
        df=tv().get_hist(symbol=symbol,exchange='BIST',interval=iv,n_bars=n,extended_session=False)
        if df is None or len(df)<80:return [],'no data'
        rows=[]
        for idx,r in df.iterrows(): rows.append({'t':int(idx.timestamp()),'o':float(r.open),'h':float(r.high),'l':float(r.low),'c':float(r.close)})
        return rows,None
    except Exception as e:return [],f'{type(e).__name__}: {e}'

def pivots(rows,span):
    raw=[]
    for i in range(span,len(rows)-span):
        if rows[i]['h']==max(x['h'] for x in rows[i-span:i+span+1]):raw.append((i,'H',rows[i]['h']))
        if rows[i]['l']==min(x['l'] for x in rows[i-span:i+span+1]):raw.append((i,'L',rows[i]['l']))
    raw.sort(); out=[]
    for p in raw:
        if not out or p[1]!=out[-1][1]:out.append(p)
        elif p[1]=='H' and p[2]>out[-1][2]:out[-1]=p
        elif p[1]=='L' and p[2]<out[-1][2]:out[-1]=p
    return out[-16:]
def leg(a,b):return abs(b[2]-a[2])
def miderr(v,r):return abs(v-sum(r)/2)/max((r[1]-r[0])/2,1e-9)

def score(x,a,b,c,d,name):
    xa=leg(x,a);ab=leg(a,b);bc=leg(b,c);cd=leg(c,d);ad=leg(a,d)
    if min(xa,ab,bc,cd,ad)<=0:return None
    vals={'b':ab/xa,'bc':bc/ab,'cd':cd/bc,'d':ad/xa}; cfg=PATTERNS[name]
    if any(not cfg[k][0]<=v<=cfg[k][1] for k,v in vals.items()):return None
    e=.30*miderr(vals['b'],cfg['b'])+.15*miderr(vals['bc'],cfg['bc'])+.20*miderr(vals['cd'],cfg['cd'])+.35*miderr(vals['d'],cfg['d'])
    return max(0,min(100,round(100-32*e))),vals

def analyze(s,tf,span):
    rows,err=fetch(s,tf)
    if err:return [],err
    pv=pivots(rows,span); last=rows[-1]['c']; out=[]
    if len(pv)<5:return [],'few pivots'
    for k in range(max(0,len(pv)-12),len(pv)-4):
        x,a,b,c,d=pv[k:k+5]
        if any((x,a,b,c,d)[i][1]==(x,a,b,c,d)[i+1][1] for i in range(4)):continue
        age=len(rows)-1-d[0]
        if age>(70 if tf=='1d' else 18):continue
        direction='pozitif' if d[1]=='L' else 'negatif'
        for name in PATTERNS:
            sc=score(x,a,b,c,d,name)
            if not sc:continue
            conf,v=sc; dp=d[2]; ad=leg(a,d)
            if direction=='pozitif':
                h1=dp+.382*ad;h2=dp+.618*ad;inv=dp-.10*ad;prog=(last-dp)/(h2-dp);invalid=last<inv;pot=(h2-last)/last*100
            else:
                h1=dp-.382*ad;h2=dp-.618*ad;inv=dp+.10*ad;prog=(dp-last)/(dp-h2);invalid=last>inv;pot=(last-h2)/last*100
            prog=max(-1,min(2,prog))
            status='geçersiz' if invalid else ('tamamlandı-kâr koru' if prog>=1 else ('hedefe yakın-kovalama' if prog>=.70 else ('aktif-takip' if prog>=.10 else 'doğru maliyet bekle')))
            out.append({'symbol':s,'timeframe':tf,'pattern':name,'direction':direction,'confidence':conf,'status':status,'last':round(last,4),'d':round(dp,4),'invalid':round(inv,4),'target1':round(h1,4),'target2':round(h2,4),'potential_to_t2_pct':round(pot,1),'progress_pct':round(prog*100,1),'x':round(x[2],4),'a':round(a[2],4),'b':round(b[2],4),'c':round(c[2],4),'b_xa':round(v['b'],3),'bc_ab':round(v['bc'],3),'cd_bc':round(v['cd'],3),'ad_xa':round(v['d'],3),'d_date':datetime.fromtimestamp(rows[d[0]]['t'],timezone.utc).date().isoformat(),'bars_since_d':age})
    return out[:8],None

def one(t):
    s,tf,sp=t
    try:return (*analyze(s,tf,sp),s,tf)
    except Exception as e:return [],str(e),s,tf

def main():
    tickers,universe_source=get_bist_stocks(); fs=[];errs=[]
    tasks=[(s,'1d',4) for s in tickers]+[(s,'1wk',2) for s in tickers]
    with ThreadPoolExecutor(max_workers=8) as ex:
        for fut in as_completed([ex.submit(one,t) for t in tasks]):
            arr,err,s,tf=fut.result();fs+=arr
            if err:errs.append({'symbol':s,'timeframe':tf,'error':err})
    rank={'aktif-takip':5,'doğru maliyet bekle':4,'hedefe yakın-kovalama':2,'tamamlandı-kâr koru':1,'geçersiz':0}
    fs.sort(key=lambda z:(rank.get(z['status'],0),z['confidence'],z['potential_to_t2_pct']),reverse=True)
    payload={'generated_at':datetime.now(timezone.utc).isoformat(),'source':'TradingView via tvDatafeed','universe_source':universe_source,'universe':len(tickers),'findings':fs,'errors':errs}
    (OUT/'scan.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Galatalı Metodu — Tüm BIST Tamamlanmış Harmonikler','',f"Güncelleme: {payload['generated_at']}",f"Evren: {len(tickers)} hisse ({universe_source})",f"Aday: {len(fs)}",'']
    for f in fs[:100]:lines += [f"## {f['symbol']} — {f['pattern']} / {f['timeframe']}",f"- Yön: {f['direction']} | Güven {f['confidence']}/100 | **{f['status']}**",f"- Fiyat {f['last']} | D {f['d']} | Invalidasyon {f['invalid']} | H1 {f['target1']} | H2 {f['target2']}",f"- B/XA {f['b_xa']} | BC/AB {f['bc_ab']} | CD/BC {f['cd_bc']} | AD/XA {f['ad_xa']}",'']
    (OUT/'scan.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(f"universe={len(tickers)} source={universe_source} completed={len(fs)} errors={len(errs)}")
if __name__=='__main__':main()
