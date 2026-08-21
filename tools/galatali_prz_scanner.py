#!/usr/bin/env python3
import json, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from tvDatafeed import TvDatafeed, Interval
from galatali_bist_universe import get_bist_stocks

OUT=Path('data/galatali_bist'); OUT.mkdir(parents=True,exist_ok=True)
PATTERNS={
 'Gartley':{'b':(0.56,0.68),'bc':(0.35,0.92),'ad':(0.74,0.82)},
 'Bat':{'b':(0.34,0.54),'bc':(0.35,0.92),'ad':(0.84,0.92)},
 'Butterfly':{'b':(0.74,0.83),'bc':(0.35,0.92),'ad':(1.20,1.68)},
 'Crab':{'b':(0.34,0.66),'bc':(0.35,0.92),'ad':(1.50,1.72)},
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
        for idx,r in df.iterrows():
            rows.append({'t':int(idx.timestamp()),'o':float(r.open),'h':float(r.high),'l':float(r.low),'c':float(r.close)})
        return rows,None
    except Exception as e:return [],f'{type(e).__name__}: {e}'

def pivots(rows,span):
    raw=[]
    for i in range(span,len(rows)-span):
        if rows[i]['h']==max(x['h'] for x in rows[i-span:i+span+1]): raw.append((i,'H',rows[i]['h']))
        if rows[i]['l']==min(x['l'] for x in rows[i-span:i+span+1]): raw.append((i,'L',rows[i]['l']))
    raw.sort(); out=[]
    for p in raw:
        if not out or p[1]!=out[-1][1]:out.append(p)
        elif p[1]=='H' and p[2]>out[-1][2]:out[-1]=p
        elif p[1]=='L' and p[2]<out[-1][2]:out[-1]=p
    return out[-16:]

def leg(a,b):return abs(b[2]-a[2])
def inr(v,r):return r[0]<=v<=r[1]
def sma(rows,n):
    return sum(x['c'] for x in rows[-n:])/n if len(rows)>=n else rows[-1]['c']
def pdate(rows,p):
    return datetime.fromtimestamp(rows[p[0]]['t'],timezone.utc).date().isoformat()

def confirmation(rows,direction,prz_lo,prz_hi,dist):
    last=rows[-1]; prev=rows[-2]
    rng=max(last['h']-last['l'],1e-9)
    s20=sma(rows,20); s50=sma(rows,50)
    pts=0; reasons=[]
    inside=prz_lo<=last['c']<=prz_hi
    if inside: pts+=2; reasons.append('fiyat PRZ içinde')
    elif dist<=2: pts+=1; reasons.append('PRZ mesafesi <=%2')
    if direction=='pozitif':
        rejection=last['c']>last['o'] and (last['c']-last['l'])/rng>=0.65
        momentum=last['c']>prev['c']
        trend=s20<s50
        sr_touch=last['l']<=prz_hi and last['c']>prz_lo
    else:
        rejection=last['c']<last['o'] and (last['h']-last['c'])/rng>=0.65
        momentum=last['c']<prev['c']
        trend=s20>s50
        sr_touch=last['h']>=prz_lo and last['c']<prz_hi
    if rejection: pts+=1; reasons.append('D dönüş mumu')
    if momentum: pts+=1; reasons.append('kısa momentum dönüşü')
    if trend: pts+=1; reasons.append('trend PRZ yönüne taşımış')
    if sr_touch: pts+=1; reasons.append('yerel S/R-PRZ teması')
    if inside and pts>=5: grade='A+'
    elif dist<=3 and pts>=4: grade='A'
    elif dist<=5 and pts>=3: grade='B'
    else: grade='BEKLE'
    return pts,grade,reasons

def analyze(symbol,tf,span):
    rows,err=fetch(symbol,tf)
    if err:return [],err
    pv=pivots(rows,span)
    if len(pv)<4:return [],'few pivots'
    last=rows[-1]['c']; out=[]
    for s in range(max(0,len(pv)-10),len(pv)-3):
        x,a,b,c=pv[s:s+4]
        if any((x,a,b,c)[i][1]==(x,a,b,c)[i+1][1] for i in range(3)):continue
        xa=leg(x,a); ab=leg(a,b); bc=leg(b,c)
        if min(xa,ab,bc)<=0:continue
        bxa=ab/xa; bcab=bc/ab; bullish=(c[1]=='H')
        for name,cfg in PATTERNS.items():
            if not inr(bxa,cfg['b']) or not inr(bcab,cfg['bc']):continue
            ad_lo,ad_hi=cfg['ad']; ad_mid=(ad_lo+ad_hi)/2; sign=-1 if bullish else 1
            d1=a[2]+sign*ad_lo*xa; d2=a[2]+sign*ad_hi*xa; dmid=a[2]+sign*ad_mid*xa
            prz_lo=min(d1,d2); prz_hi=max(d1,d2)
            if last<prz_lo: dist=(prz_lo-last)/last*100
            elif last>prz_hi: dist=(last-prz_hi)/last*100
            else: dist=0.0
            if dist>18:continue
            direction='pozitif' if bullish else 'negatif'
            if direction=='pozitif': approaching=last>=prz_hi
            else: approaching=last<=prz_lo
            status='PRZ içinde' if dist==0 else ('PRZ yaklaşıyor' if approaching else 'PRZ sonrası/uzakta')
            base=70+max(0,10-int(dist*1.5))+(5 if approaching else 0)
            cpts,grade,reasons=confirmation(rows,direction,prz_lo,prz_hi,dist)
            score=min(99,base+cpts*2)
            out.append({'symbol':symbol,'timeframe':tf,'pattern':name,'direction':direction,'confidence':score,'grade':grade,'confirmation_score':cpts,'confirmations':reasons,
              'x':round(x[2],4),'a':round(a[2],4),'b':round(b[2],4),'c':round(c[2],4),
              'x_date':pdate(rows,x),'a_date':pdate(rows,a),'b_date':pdate(rows,b),'c_date':pdate(rows,c),
              'b_xa':round(bxa,3),'bc_ab':round(bcab,3),
              'prz_low':round(prz_lo,4),'prz_high':round(prz_hi,4),'prz_mid':round(dmid,4),'last':round(last,4),'distance_to_prz_pct':round(dist,1),'status':status})
    gr={'A+':4,'A':3,'B':2,'BEKLE':1}; st={'PRZ içinde':3,'PRZ yaklaşıyor':2,'PRZ sonrası/uzakta':1}
    out.sort(key=lambda z:(gr[z['grade']],st[z['status']],z['confidence'],-z['distance_to_prz_pct']),reverse=True)
    return out[:8],None

def one(t):
    s,tf,sp=t
    try:return (*analyze(s,tf,sp),s,tf)
    except Exception as e:return [],str(e),s,tf

def main():
    tickers,universe_source=get_bist_stocks()
    fs=[];errs=[]; tasks=[(s,'1d',4) for s in tickers]+[(s,'1wk',2) for s in tickers]
    with ThreadPoolExecutor(max_workers=8) as ex:
        for fut in as_completed([ex.submit(one,t) for t in tasks]):
            arr,err,s,tf=fut.result(); fs+=arr
            if err:errs.append({'symbol':s,'timeframe':tf,'error':err})
    gr={'A+':4,'A':3,'B':2,'BEKLE':1}; st={'PRZ içinde':3,'PRZ yaklaşıyor':2,'PRZ sonrası/uzakta':1}
    fs.sort(key=lambda z:(gr[z['grade']],st[z['status']],z['confidence'],-z['distance_to_prz_pct']),reverse=True)
    payload={'generated_at':datetime.now(timezone.utc).isoformat(),'source':'TradingView via tvDatafeed','universe_source':universe_source,'universe':len(tickers),'findings':fs,'errors':errs}
    (OUT/'prz_scan.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'universe.json').write_text(json.dumps({'source':universe_source,'count':len(tickers),'symbols':tickers},ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Galatalı — Tüm BIST Oluşmakta Olan PRZ Adayları','',f"Güncelleme: {payload['generated_at']}",f"Evren: {len(tickers)} hisse ({universe_source})",f"Aday: {len(fs)} | A/A+: {sum(1 for x in fs if x['grade'] in ('A','A+'))}",'']
    for f in fs[:80]:
        lines += [f"## {f['symbol']} — {f['pattern']} / {f['timeframe']} — {f['grade']}",f"- Yön: {f['direction']} | Güven: {f['confidence']}/100 | Durum: **{f['status']}**",f"- Fiyat: {f['last']} | PRZ: {f['prz_low']}–{f['prz_high']} | Uzaklık: %{f['distance_to_prz_pct']}",f"- Teyit {f['confirmation_score']}/6: {', '.join(f['confirmations']) or 'henüz yok'}",f"- X-A-B-C: {f['x']} / {f['a']} / {f['b']} / {f['c']} | B/XA {f['b_xa']} | BC/AB {f['bc_ab']}",'']
    (OUT/'prz_scan.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(f"universe={len(tickers)} source={universe_source} prz_findings={len(fs)} A={sum(1 for x in fs if x['grade'] in ('A','A+'))} errors={len(errs)}")
if __name__=='__main__':main()
