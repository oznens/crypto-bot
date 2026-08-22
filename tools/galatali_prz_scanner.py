#!/usr/bin/env python3
import json, math, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from tvDatafeed import TvDatafeed, Interval
from galatali_bist_universe import get_bist_stocks

OUT=Path('data/galatali_bist'); OUT.mkdir(parents=True,exist_ok=True)
# Galatali archive-confirmed harmonic family. Ranges are deliberately tighter than the first prototype.
HARMONICS={
 'Gartley':{'b':(0.58,0.66),'bc':(0.38,0.89),'ad':(0.76,0.81)},
 'Yarasa (Bat)':{'b':(0.36,0.52),'bc':(0.38,0.89),'ad':(0.86,0.91)},
 'Kelebek (Butterfly)':{'b':(0.76,0.81),'bc':(0.38,0.89),'ad':(1.25,1.65)},
 'Yengeç (Crab)':{'b':(0.38,0.62),'bc':(0.38,0.89),'ad':(1.58,1.66)},
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

def pdate(rows,p): return datetime.fromtimestamp(rows[p[0]]['t'],timezone.utc).date().isoformat()
def idate(rows,i): return datetime.fromtimestamp(rows[i]['t'],timezone.utc).date().isoformat()
def leg(a,b):return abs(b[2]-a[2])
def inr(v,r):return r[0]<=v<=r[1]
def sma(rows,n):return sum(x['c'] for x in rows[-n:])/min(n,len(rows))
def pct(a,b):return abs(a-b)/max(abs(b),1e-9)*100

def pivots(rows,span):
    raw=[]
    for i in range(span,len(rows)-span):
        w=rows[i-span:i+span+1]
        if rows[i]['h']==max(x['h'] for x in w): raw.append((i,'H',rows[i]['h']))
        if rows[i]['l']==min(x['l'] for x in w): raw.append((i,'L',rows[i]['l']))
    raw.sort(); out=[]
    for p in raw:
        if not out or p[1]!=out[-1][1]:out.append(p)
        elif p[1]=='H' and p[2]>out[-1][2]:out[-1]=p
        elif p[1]=='L' and p[2]<out[-1][2]:out[-1]=p
    return out[-24:]

def geom(rows,points):
    return [{'label':lab,'date':idate(rows,p[0]),'price':round(p[2],4),'type':p[1]} for lab,p in points]

def classic_patterns(rows,pv):
    out=[]; last=rows[-1]['c']
    def add(name,direction,score,status,target,support,resistance,points,kind='classic',note=''):
        grade='A+' if score>=92 else 'A' if score>=84 else 'B' if score>=76 else 'BEKLE'
        out.append({'family':kind,'pattern':name,'direction':direction,'confidence':min(99,int(score)),'grade':grade,'status':status,'last':round(last,4),
                    'target':round(target,4) if target else None,'support':round(support,4) if support else None,'resistance':round(resistance,4) if resistance else None,
                    'geometry':geom(rows,points),'note':note})
    # Double bottom / top from consecutive pivots.
    for i in range(max(0,len(pv)-10),len(pv)-2):
        a,b,c=pv[i:i+3]
        if a[1]=='L' and b[1]=='H' and c[1]=='L' and pct(a[2],c[2])<=5.5:
            neckline=b[2]; depth=neckline-(a[2]+c[2])/2; target=neckline+depth
            near=last>=neckline*.97; add('İkili Dip (W)','pozitif',88+(4 if near else 0),'onaylı' if last>neckline else 'onay bekliyor',target,min(a[2],c[2]),neckline,[('L1',a),('N',b),('L2',c)],note='Galatalı arşivinde ikili dip onayı ayrı teyit olarak kullanılıyor.')
        if a[1]=='H' and b[1]=='L' and c[1]=='H' and pct(a[2],c[2])<=5.5:
            neckline=b[2]; depth=(a[2]+c[2])/2-neckline; target=max(0,neckline-depth)
            near=last<=neckline*1.03; add('İkili Tepe (M)','negatif',87+(4 if near else 0),'onaylı' if last<neckline else 'onay bekliyor',target,neckline,max(a[2],c[2]),[('H1',a),('N',b),('H2',c)])
    # OBO / TOBO using 5 alternating pivots.
    for i in range(max(0,len(pv)-12),len(pv)-4):
        q=pv[i:i+5]; typ=''.join(x[1] for x in q)
        if typ=='HLHLH':
            ls,n1,head,n2,rs=q
            shoulders_ok=pct(ls[2],rs[2])<=9; head_ok=head[2]>max(ls[2],rs[2])*1.06
            if shoulders_ok and head_ok:
                neck=(n1[2]+n2[2])/2; target=max(0,neck-(head[2]-neck)); add('OBO','negatif',90,'onaylı' if last<neck else 'boyun çizgisi bekleniyor',target,neck,max(ls[2],rs[2]),list(zip(['OS','N1','B','N2','SS'],q)))
        if typ=='LHLHL':
            ls,n1,head,n2,rs=q
            shoulders_ok=pct(ls[2],rs[2])<=9; head_ok=head[2]<min(ls[2],rs[2])*.94
            if shoulders_ok and head_ok:
                neck=(n1[2]+n2[2])/2; target=neck+(neck-head[2]); add('TOBO','pozitif',90,'onaylı' if last>neck else 'boyun çizgisi bekleniyor',target,min(ls[2],rs[2]),neck,list(zip(['OS','N1','B','N2','SS'],q)))
    # Flag / pennant: impulse followed by a compact, shallow consolidation.
    for look in (8,12,16):
        if len(rows)<look+28: continue
        flag=rows[-look:]; pole=rows[-look-22:-look]
        p0=pole[0]['c']; p1=pole[-1]['c']; move=(p1-p0)/max(abs(p0),1e-9)
        fh=max(x['h'] for x in flag); fl=min(x['l'] for x in flag); pr=max(x['h'] for x in pole)-min(x['l'] for x in pole)
        compact=(fh-fl)<=max(pr*.48,1e-9)
        if abs(move)>=.11 and compact:
            # narrowing range => pennant, otherwise flag
            first=flag[:max(3,look//2)]; second=flag[max(3,look//2):]
            r1=max(x['h'] for x in first)-min(x['l'] for x in first); r2=max(x['h'] for x in second)-min(x['l'] for x in second)
            name='Flama' if r2<r1*.78 else 'Bayrak'
            direction='pozitif' if move>0 else 'negatif'; breakout=fh if move>0 else fl
            target=breakout+abs(p1-p0)*(1 if move>0 else -1); support=fl; resistance=fh
            pA=(len(rows)-look-22,'L' if move>0 else 'H',p0); pB=(len(rows)-look-1,'H' if move>0 else 'L',p1); pC=(len(rows)-1,'H' if move>0 else 'L',last)
            status='kırılım izleniyor'; score=84+min(8,int(abs(move)*30)); add(name,direction,score,status,target,support,resistance,[('Direk',pA),('Tepe',pB),('Sıkışma',pC)],note='Arşivde flama/bayrak ve pullback birlikte teyit olarak kullanılıyor.')
            break
    # Breakout + pullback/retest.
    if len(rows)>=70:
        prior=rows[-60:-12]; recent=rows[-12:]
        ph=max(x['h'] for x in prior); pl=min(x['l'] for x in prior)
        recent_hi=max(x['h'] for x in recent); recent_lo=min(x['l'] for x in recent)
        if recent_hi>ph*1.025 and recent_lo<=ph*1.035 and last>=ph*.985:
            idx=max(range(len(rows)-12,len(rows)),key=lambda j: rows[j]['h']); p=(idx,'H',rows[idx]['h'])
            add('Pullback / Retest','pozitif',86,'onay bölgesi',last+(ph-pl)*.35,ph, recent_hi,[('Kırılım',p)],note='Eski direncin destek olarak test edilmesi.')
        if recent_lo<pl*.975 and recent_hi>=pl*.965 and last<=pl*1.015:
            idx=min(range(len(rows)-12,len(rows)),key=lambda j: rows[j]['l']); p=(idx,'L',rows[idx]['l'])
            add('Pullback / Retest','negatif',86,'onay bölgesi',max(0,last-(ph-pl)*.35),recent_lo,pl,[('Kırılım',p)])
    # Trend channel context from two halves (used as confluence rather than primary setup).
    if len(rows)>=50:
        seg=rows[-50:]; a=sum(x['c'] for x in seg[:10])/10; b=sum(x['c'] for x in seg[-10:])/10; slope=(b-a)/max(abs(a),1e-9)
        if abs(slope)>.07:
            direction='pozitif' if slope>0 else 'negatif'; lo=min(x['l'] for x in seg[-20:]); hi=max(x['h'] for x in seg[-20:])
            add('Trend Kanalı',direction,78,'kanal içi',hi+(hi-lo)*.35 if slope>0 else max(0,lo-(hi-lo)*.35),lo,hi,[('K1',(len(rows)-50,'L',seg[0]['l'])),('K2',(len(rows)-1,'H',seg[-1]['h']))],note='Galatalı arşivinde kanal/trend yardımcı bağlam olarak kullanılıyor.')
    # De-duplicate by pattern/direction, keep best.
    best={}
    for x in out:
        k=(x['pattern'],x['direction']);
        if k not in best or x['confidence']>best[k]['confidence']:best[k]=x
    return list(best.values())

def find_d_touch(rows,c_idx,direction,lo,hi,mid):
    for i in range(c_idx+1,len(rows)):
        r=rows[i]
        if r['l']<=hi and r['h']>=lo:
            p=r['l'] if direction=='pozitif' else r['h']; return {'index':i,'date':idate(rows,i),'price':p}
    return None

def confirmation(rows,direction,lo,hi,dist):
    last=rows[-1]; prev=rows[-2]; rng=max(last['h']-last['l'],1e-9); pts=0; reasons=[]
    inside=lo<=last['c']<=hi
    if inside:pts+=2;reasons.append('fiyat PRZ içinde')
    elif dist<=2:pts+=1;reasons.append('PRZ mesafesi <=%2')
    if direction=='pozitif': rejection=last['c']>last['o'] and (last['c']-last['l'])/rng>=.65; momentum=last['c']>prev['c']; trend=sma(rows,20)<sma(rows,50)
    else: rejection=last['c']<last['o'] and (last['h']-last['c'])/rng>=.65; momentum=last['c']<prev['c']; trend=sma(rows,20)>sma(rows,50)
    if rejection:pts+=1;reasons.append('D dönüş mumu')
    if momentum:pts+=1;reasons.append('kısa momentum dönüşü')
    if trend:pts+=1;reasons.append('trend PRZ yönüne taşımış')
    return pts,reasons

def harmonic_candidates(rows,pv,classic):
    last=rows[-1]['c']; out=[]
    conf_by_dir={d:[x for x in classic if x['direction']==d and x['pattern']!='Trend Kanalı'] for d in ('pozitif','negatif')}
    for s in range(max(0,len(pv)-14),len(pv)-3):
        x,a,b,c=pv[s:s+4]
        xa=leg(x,a);ab=leg(a,b);bc=leg(b,c)
        if min(xa,ab,bc)<=0:continue
        bxa=ab/xa;bcab=bc/ab; bullish=(c[1]=='H'); direction='pozitif' if bullish else 'negatif'; sign=-1 if bullish else 1
        candidates=[]
        for name,cfg in HARMONICS.items():
            if inr(bxa,cfg['b']) and inr(bcab,cfg['bc']): candidates.append((name,cfg['ad']))
        # Shark: looser O-X-A-B-C style proxy based on deep BC extension; archive-confirmed, separately labelled.
        if 0.35<=bxa<=0.70 and 1.10<=bcab<=2.30:candidates.append(('Shark',(0.88,1.13)))
        # AB=CD candidate from proportional BC retracement and projected CD≈AB.
        if .38<=bcab<=.89:candidates.append(('AB=CD',(None,None)))
        for name,adr in candidates:
            if name=='AB=CD':
                dmid=c[2]+sign*ab; d1=c[2]+sign*ab*.94; d2=c[2]+sign*ab*1.06
            else:
                d1=a[2]+sign*adr[0]*xa;d2=a[2]+sign*adr[1]*xa;dmid=(d1+d2)/2
            lo,hi=min(d1,d2),max(d1,d2)
            dist=0 if lo<=last<=hi else (lo-last)/last*100 if last<lo else (last-hi)/last*100
            if dist>18:continue
            d=find_d_touch(rows,c[0],direction,lo,hi,dmid); status='PRZ içinde' if dist==0 else 'PRZ yaklaşıyor' if dist<=5 else 'oluşuyor'
            pts,reasons=confirmation(rows,direction,lo,hi,dist); con=conf_by_dir[direction]
            # Galatali-like ranking: harmonic + classic confirmation gets a material boost.
            bonus=min(12,len(con)*4); score=min(99,72+max(0,10-int(dist))+pts*3+bonus)
            grade='A+' if score>=92 and con else 'A' if score>=84 else 'B' if score>=76 else 'BEKLE'
            item={'family':'harmonic','symbol':None,'timeframe':None,'pattern':name,'direction':direction,'confidence':score,'grade':grade,'status':status,'confirmation_score':pts,'confirmations':reasons,
                  'confluences':[z['pattern'] for z in sorted(con,key=lambda z:z['confidence'],reverse=True)[:4]],
                  'x':round(x[2],4),'a':round(a[2],4),'b':round(b[2],4),'c':round(c[2],4),'x_date':pdate(rows,x),'a_date':pdate(rows,a),'b_date':pdate(rows,b),'c_date':pdate(rows,c),
                  'b_xa':round(bxa,3),'bc_ab':round(bcab,3),'prz_low':round(lo,4),'prz_high':round(hi,4),'prz_mid':round(dmid,4),'last':round(last,4),'distance_to_prz_pct':round(dist,1)}
            if d:item.update({'d':round(d['price'],4),'d_date':d['date'],'d_confirmed':True})
            else:item.update({'d':round(dmid,4),'d_date':None,'d_confirmed':False})
            out.append(item)
    return out

def analyze(symbol,tf,span):
    rows,err=fetch(symbol,tf)
    if err:return [],err
    pv=pivots(rows,span)
    if len(pv)<4:return [],'few pivots'
    classics=classic_patterns(rows,pv); harmonics=harmonic_candidates(rows,pv,classics)
    for x in harmonics:x['symbol']=symbol;x['timeframe']=tf
    for x in classics:
        x['symbol']=symbol;x['timeframe']=tf;x['confluences']=[];x['distance_to_prz_pct']=0
    # Keep classic setups meaningful; Trend Channel alone is context, not a top-level candidate unless strong.
    allx=harmonics+[x for x in classics if x['pattern']!='Trend Kanalı' or x['confidence']>=82]
    gr={'A+':4,'A':3,'B':2,'BEKLE':1};allx.sort(key=lambda z:(gr[z['grade']],z['confidence']),reverse=True)
    return allx[:12],None

def one(t):
    s,tf,sp=t
    try:return (*analyze(s,tf,sp),s,tf)
    except Exception as e:return [],str(e),s,tf

def main():
    tickers,source=get_bist_stocks();fs=[];errs=[];tasks=[(s,'1d',4) for s in tickers]+[(s,'1wk',2) for s in tickers]
    with ThreadPoolExecutor(max_workers=8) as ex:
        for fut in as_completed([ex.submit(one,t) for t in tasks]):
            arr,err,s,tf=fut.result();fs+=arr
            if err:errs.append({'symbol':s,'timeframe':tf,'error':err})
    gr={'A+':4,'A':3,'B':2,'BEKLE':1};fs.sort(key=lambda z:(gr[z['grade']],z['confidence']),reverse=True)
    payload={'generated_at':datetime.now(timezone.utc).isoformat(),'scanner_version':'galatali-archive-v3-harmonic-classic','source':'TradingView via tvDatafeed','universe_source':source,'universe':len(tickers),'findings':fs,'errors':errs}
    (OUT/'prz_scan.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'universe.json').write_text(json.dumps({'source':source,'count':len(tickers),'symbols':tickers},ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Galatalı — Harmonik + Klasik Formasyon Taraması','',f"Güncelleme: {payload['generated_at']}",f"Evren: {len(tickers)}",f"Aday: {len(fs)} | A/A+: {sum(1 for x in fs if x['grade'] in ('A','A+'))}",'']
    for f in fs[:120]:lines += [f"## {f['symbol']} — {f['pattern']} / {f['timeframe']} — {f['grade']}",f"- Aile: {f['family']} | Yön: {f['direction']} | Güven: {f['confidence']}/100 | Durum: {f['status']}",f"- Konfluans: {', '.join(f.get('confluences',[])) or '-'}",'']
    (OUT/'prz_scan.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(f"universe={len(tickers)} findings={len(fs)} A={sum(1 for x in fs if x['grade'] in ('A','A+'))} errors={len(errs)}")
if __name__=='__main__':main()
