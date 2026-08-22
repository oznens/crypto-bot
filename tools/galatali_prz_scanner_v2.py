#!/usr/bin/env python3
import json, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from tvDatafeed import TvDatafeed, Interval
from galatali_bist_universe import get_bist_stocks

OUT=Path('data/galatali_bist'); OUT.mkdir(parents=True,exist_ok=True)
# Families directly evidenced in the Galatali archive/rulebook.
# Ratios are deliberately tighter than v1 to reduce false positives.
XABCD={
 'Yarasa (Bat)': {'b':(0.382,0.520),'bc':(0.382,0.886),'ad':(0.860,0.910)},
 'Yengeç (Crab)': {'b':(0.382,0.618),'bc':(0.382,0.886),'ad':(1.580,1.660)},
 'Gartley': {'b':(0.600,0.640),'bc':(0.382,0.886),'ad':(0.760,0.800)},
 'Kelebek (Butterfly)': {'b':(0.760,0.810),'bc':(0.382,0.886),'ad':(1.250,1.650)},
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
        return [{'t':int(i.timestamp()),'o':float(r.open),'h':float(r.high),'l':float(r.low),'c':float(r.close)} for i,r in df.iterrows()],None
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
    return out[-18:]

def leg(a,b):return abs(b[2]-a[2])
def inr(v,r):return r[0]<=v<=r[1]
def pdate(rows,p):return datetime.fromtimestamp(rows[p[0]]['t'],timezone.utc).date().isoformat()
def idate(rows,i):return datetime.fromtimestamp(rows[i]['t'],timezone.utc).date().isoformat()
def sma(rows,n):return sum(x['c'] for x in rows[-n:])/n if len(rows)>=n else rows[-1]['c']

def touch(rows,c_idx,direction,lo,hi,mid):
    hits=[]
    for i in range(c_idx+1,len(rows)):
        r=rows[i]
        if r['l']<=hi and r['h']>=lo:
            p=r['l'] if direction=='pozitif' else r['h']; hits.append((i,abs(p-mid),p))
    if not hits:return None
    i,_,p=min(hits,key=lambda z:(z[0],z[1])); return {'index':i,'date':idate(rows,i),'price':p}

def confirm(rows,direction,lo,hi,dist):
    last,prev=rows[-1],rows[-2]; rng=max(last['h']-last['l'],1e-9); pts=0; why=[]
    inside=lo<=last['c']<=hi
    if inside:pts+=2;why.append('fiyat doğru maliyet/PRZ içinde')
    elif dist<=2:pts+=1;why.append('PRZ mesafesi <=%2')
    if direction=='pozitif':
        rej=last['c']>last['o'] and (last['c']-last['l'])/rng>=.65; mom=last['c']>prev['c']; trend=sma(rows,20)<sma(rows,50)
    else:
        rej=last['c']<last['o'] and (last['h']-last['c'])/rng>=.65; mom=last['c']<prev['c']; trend=sma(rows,20)>sma(rows,50)
    if rej:pts+=1;why.append('D dönüş mumu')
    if mom:pts+=1;why.append('kısa momentum dönüşü')
    if trend:pts+=1;why.append('ana hareket PRZ yönünde')
    grade='A+' if inside and pts>=5 else ('A' if dist<=3 and pts>=4 else ('B' if dist<=5 and pts>=3 else 'BEKLE'))
    return pts,grade,why

def emit(rows,symbol,tf,name,direction,x,a,b,c,lo,hi,mid,bxa,bcab,geometry='XABCD'):
    last=rows[-1]['c']; dist=0 if lo<=last<=hi else ((lo-last)/last*100 if last<lo else (last-hi)/last*100)
    if dist>18:return None
    approaching=last>=hi if direction=='pozitif' else last<=lo
    status='PRZ içinde' if dist==0 else ('PRZ yaklaşıyor' if approaching else 'PRZ sonrası/uzakta')
    dt=touch(rows,c[0],direction,lo,hi,mid); pts,grade,why=confirm(rows,direction,lo,hi,dist)
    score=min(99,70+max(0,10-int(dist*1.5))+(5 if approaching else 0)+pts*2)
    z={'symbol':symbol,'timeframe':tf,'pattern':name,'geometry':geometry,'direction':direction,'confidence':score,'grade':grade,'confirmation_score':pts,'confirmations':why,
       'x':round(x[2],4),'a':round(a[2],4),'b':round(b[2],4),'c':round(c[2],4),'x_date':pdate(rows,x),'a_date':pdate(rows,a),'b_date':pdate(rows,b),'c_date':pdate(rows,c),
       'x_index':x[0],'a_index':a[0],'b_index':b[0],'c_index':c[0],'b_xa':round(bxa,3),'bc_ab':round(bcab,3),'prz_low':round(lo,4),'prz_high':round(hi,4),'prz_mid':round(mid,4),'last':round(last,4),'distance_to_prz_pct':round(dist,1),'status':status}
    if dt:z.update({'d':round(dt['price'],4),'d_date':dt['date'],'d_index':dt['index'],'d_confirmed':True})
    else:z.update({'d':round(mid,4),'d_date':None,'d_index':None,'d_confirmed':False})
    return z

def analyze(symbol,tf,span):
    rows,err=fetch(symbol,tf)
    if err:return [],err
    pv=pivots(rows,span); out=[]
    if len(pv)<4:return [],'few pivots'
    for s in range(max(0,len(pv)-12),len(pv)-3):
        x,a,b,c=pv[s:s+4]
        xa,ab,bc=leg(x,a),leg(a,b),leg(b,c)
        if min(xa,ab,bc)<=0:continue
        bxa,bcab=ab/xa,bc/ab; bullish=(c[1]=='H'); direction='pozitif' if bullish else 'negatif'; sign=-1 if bullish else 1
        # Galatali-evidenced XABCD families
        for name,cfg in XABCD.items():
            if not(inr(bxa,cfg['b']) and inr(bcab,cfg['bc'])):continue
            r1,r2=cfg['ad']; d1=a[2]+sign*r1*xa; d2=a[2]+sign*r2*xa; mid=(d1+d2)/2
            z=emit(rows,symbol,tf,name,direction,x,a,b,c,min(d1,d2),max(d1,d2),mid,bxa,bcab)
            if z:out.append(z)
        # AB=CD: Galatali archive explicitly uses it. D is projected from C by AB symmetry.
        if 0.382<=bcab<=0.886:
            d1=c[2]+sign*0.95*ab; d2=c[2]+sign*1.05*ab; mid=(d1+d2)/2
            z=emit(rows,symbol,tf,'AB=CD',direction,x,a,b,c,min(d1,d2),max(d1,d2),mid,bxa,bcab,'ABCD')
            if z:z['ab_cd_ratio_target']=1.0;out.append(z)
        # Shark candidate: archive-proven family, kept stricter and lower-priority until image-ratio calibration is complete.
        if 1.10<=bxa<=1.65 and 1.55<=bcab<=2.30:
            d1=a[2]+sign*0.86*xa; d2=a[2]+sign*0.92*xa; mid=(d1+d2)/2
            z=emit(rows,symbol,tf,'Shark',direction,x,a,b,c,min(d1,d2),max(d1,d2),mid,bxa,bcab,'SHARK')
            if z:z['confidence']=max(55,z['confidence']-8);out.append(z)
    gr={'A+':4,'A':3,'B':2,'BEKLE':1}; st={'PRZ içinde':3,'PRZ yaklaşıyor':2,'PRZ sonrası/uzakta':1}
    out.sort(key=lambda z:(gr[z['grade']],st[z['status']],z['confidence'],-z['distance_to_prz_pct']),reverse=True)
    # de-duplicate nearly identical geometry; prefer archive-common families first
    pref={'Yarasa (Bat)':6,'Yengeç (Crab)':5,'Gartley':4,'Kelebek (Butterfly)':3,'AB=CD':2,'Shark':1}; seen=set(); ded=[]
    for z in sorted(out,key=lambda q:(q['symbol'],q['timeframe'],q['x_date'],q['a_date'],q['b_date'],q['c_date'],-pref.get(q['pattern'],0))):
        k=(z['x_date'],z['a_date'],z['b_date'],z['c_date'],round(z['prz_mid'],2))
        if k in seen:continue
        seen.add(k);ded.append(z)
    ded.sort(key=lambda z:(gr[z['grade']],st[z['status']],z['confidence'],-z['distance_to_prz_pct']),reverse=True)
    return ded[:8],None

def one(t):
    s,tf,sp=t
    try:return (*analyze(s,tf,sp),s,tf)
    except Exception as e:return [],str(e),s,tf

def main():
    tickers,source=get_bist_stocks(); fs=[]; errs=[]; tasks=[(s,'1d',4) for s in tickers]+[(s,'1wk',2) for s in tickers]
    with ThreadPoolExecutor(max_workers=8) as ex:
        for fut in as_completed([ex.submit(one,t) for t in tasks]):
            arr,err,s,tf=fut.result(); fs+=arr
            if err:errs.append({'symbol':s,'timeframe':tf,'error':err})
    gr={'A+':4,'A':3,'B':2,'BEKLE':1}; st={'PRZ içinde':3,'PRZ yaklaşıyor':2,'PRZ sonrası/uzakta':1}; fs.sort(key=lambda z:(gr[z['grade']],st[z['status']],z['confidence'],-z['distance_to_prz_pct']),reverse=True)
    p={'generated_at':datetime.now(timezone.utc).isoformat(),'source':'TradingView via tvDatafeed','scanner_version':'galatali-archive-v2','archive_families':['Yarasa (Bat)','Yengeç (Crab)','Gartley','Kelebek (Butterfly)','Shark','AB=CD'],'universe_source':source,'universe':len(tickers),'findings':fs,'errors':errs}
    (OUT/'prz_scan.json').write_text(json.dumps(p,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'universe.json').write_text(json.dumps({'source':source,'count':len(tickers),'symbols':tickers},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f"version=galatali-archive-v2 universe={len(tickers)} findings={len(fs)} A={sum(1 for x in fs if x['grade'] in ('A','A+'))}")
if __name__=='__main__':main()
