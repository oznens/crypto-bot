#!/usr/bin/env python3
import json, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from tvDatafeed import TvDatafeed, Interval

TICKERS=['AKBNK','ALARK','ARCLK','ASELS','ASTOR','BIMAS','DOAS','EKGYO','ENJSA','EREGL','FROTO','GARAN','GESAN','GUBRF','HEKTS','ISCTR','KCHOL','KONTR','KOZAL','KRDMD','MGROS','ODAS','OYAKC','PETKM','PGSUS','SAHOL','SASA','SISE','SMRTG','TAVHL','TCELL','THYAO','TOASO','TSKB','TUPRS','ULKER','VAKBN','VESTL','YKBNK','ZOREN','AGHOL','AEFES','AKSA','AKSEN','ALFAS','CCOLA','CWENE','EGEEN','ENKAI','GWIND','HALKB','ISGYO','IZENR','JANTS','KARSN','MAVI','MPARK','OTKAR','QUAGR','SKBNK','SOKM','TABGD','TKFEN','TRGYO','TTRAK']
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
            rows.append({'t':int(idx.timestamp()),'h':float(r.high),'l':float(r.low),'c':float(r.close)})
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
    return out[-14:]

def leg(a,b):return abs(b[2]-a[2])
def inr(v,r):return r[0]<=v<=r[1]

def analyze(symbol,tf,span):
    rows,err=fetch(symbol,tf)
    if err:return [],err
    pv=pivots(rows,span)
    if len(pv)<4:return [],'few pivots'
    last=rows[-1]['c']; out=[]
    # last several XABC sequences; project D from AD/XA family ratio
    for s in range(max(0,len(pv)-9),len(pv)-3):
        x,a,b,c=pv[s:s+4]
        if any((x,a,b,c)[i][1]==(x,a,b,c)[i+1][1] for i in range(3)):continue
        xa=leg(x,a); ab=leg(a,b); bc=leg(b,c)
        if min(xa,ab,bc)<=0:continue
        bxa=ab/xa; bcab=bc/ab
        # D must continue opposite C->next leg; if C is high, D projected below A for bullish reversal, vice versa.
        bullish=(c[1]=='H')
        for name,cfg in PATTERNS.items():
            if not inr(bxa,cfg['b']) or not inr(bcab,cfg['bc']):continue
            ad_mid=sum(cfg['ad'])/2
            ad_lo,ad_hi=cfg['ad']
            sign=-1 if bullish else 1
            d_mid=a[2]+sign*ad_mid*xa
            d1=a[2]+sign*ad_lo*xa; d2=a[2]+sign*ad_hi*xa
            prz_lo=min(d1,d2); prz_hi=max(d1,d2)
            # distance to zone: 0 inside, positive outside
            if last<prz_lo: dist=(prz_lo-last)/last*100
            elif last>prz_hi: dist=(last-prz_hi)/last*100
            else: dist=0.0
            # only actionable proximity, max 18% from projected zone
            if dist>18:continue
            direction='pozitif' if bullish else 'negatif'
            # approaching test based on current side of PRZ
            if direction=='pozitif': approaching=last>=prz_hi
            else: approaching=last<=prz_lo
            score=70
            score+=max(0,10-int(dist*1.5))
            score+=5 if approaching else 0
            score=min(95,score)
            out.append({'symbol':symbol,'timeframe':tf,'pattern':name,'direction':direction,'confidence':score,
              'x':round(x[2],4),'a':round(a[2],4),'b':round(b[2],4),'c':round(c[2],4),
              'b_xa':round(bxa,3),'bc_ab':round(bcab,3),'prz_low':round(prz_lo,4),'prz_high':round(prz_hi,4),'prz_mid':round(d_mid,4),
              'last':round(last,4),'distance_to_prz_pct':round(dist,1),'status':'PRZ yaklaşıyor' if approaching and dist>0 else ('PRZ içinde' if dist==0 else 'PRZ sonrası/uzakta'),
              'c_date':datetime.fromtimestamp(rows[c[0]]['t'],timezone.utc).date().isoformat()})
    out.sort(key=lambda z:(z['status']=='PRZ içinde',z['status']=='PRZ yaklaşıyor',z['confidence'],-z['distance_to_prz_pct']),reverse=True)
    return out[:5],None

def one(t):
    s,tf,sp=t
    try:return (*analyze(s,tf,sp),s,tf)
    except Exception as e:return [],str(e),s,tf

def main():
    fs=[];errs=[]; tasks=[(s,'1d',4) for s in TICKERS]+[(s,'1wk',2) for s in TICKERS]
    with ThreadPoolExecutor(max_workers=4) as ex:
        for fut in as_completed([ex.submit(one,t) for t in tasks]):
            arr,err,s,tf=fut.result(); fs+=arr
            if err:errs.append({'symbol':s,'timeframe':tf,'error':err})
    rank={'PRZ içinde':3,'PRZ yaklaşıyor':2,'PRZ sonrası/uzakta':1}
    fs.sort(key=lambda z:(rank.get(z['status'],0),z['confidence'],-z['distance_to_prz_pct']),reverse=True)
    payload={'generated_at':datetime.now(timezone.utc).isoformat(),'source':'TradingView via tvDatafeed','findings':fs,'errors':errs}
    (OUT/'prz_scan.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Galatalı — Oluşmakta Olan PRZ Adayları','',f"Güncelleme: {payload['generated_at']}",f"Aday: {len(fs)}",'']
    for f in fs[:40]:
        lines += [f"## {f['symbol']} — {f['pattern']} / {f['timeframe']}",f"- Yön: {f['direction']} | Güven: {f['confidence']}/100 | Durum: **{f['status']}**",f"- Fiyat: {f['last']} | PRZ: {f['prz_low']}–{f['prz_high']} | Uzaklık: %{f['distance_to_prz_pct']}",f"- X-A-B-C: {f['x']} / {f['a']} / {f['b']} / {f['c']}",f"- B/XA: {f['b_xa']} | BC/AB: {f['bc_ab']} | C tarihi: {f['c_date']}",'']
    (OUT/'prz_scan.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(f"prz_findings={len(fs)} errors={len(errs)}")
if __name__=='__main__':main()
