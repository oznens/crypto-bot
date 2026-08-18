import io,zipfile,urllib.request,json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import pandas as pd
import numpy as np

SYMBOL='BTCUSDT'; START='2022-01'; END='2026-07'; OUT=Path('backtests/yusuf-btc-results'); OUT.mkdir(parents=True,exist_ok=True)
COLS=['open_time','open','high','low','close','volume','close_time','quote_volume','trades','taker_base','taker_quote','ignore']

def months(a,b):
    p=pd.Period(a,'M'); e=pd.Period(b,'M')
    while p<=e:
        yield str(p); p+=1

def fetch_month(m):
    url=f'https://data.binance.vision/data/spot/monthly/klines/{SYMBOL}/15m/{SYMBOL}-15m-{m}.zip'
    try:
        z=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url,timeout=20).read())); return pd.read_csv(z.open(z.namelist()[0]),header=None,names=COLS)
    except Exception as e: print('skip',m,e); return None

def load():
    frames=[]
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs={ex.submit(fetch_month,m):m for m in months(START,END)}
        for f in as_completed(futs):
            d=f.result()
            if d is not None: frames.append(d)
    d=pd.concat(frames,ignore_index=True); d['time']=pd.to_datetime(d.open_time,unit='ms',utc=True,errors='coerce')
    for c in ['open','high','low','close','volume']: d[c]=pd.to_numeric(d[c],errors='coerce')
    return d.dropna(subset=['time','open','high','low','close']).drop_duplicates('time').sort_values('time').set_index('time')

def atr(d,n=14):
    pc=d.close.shift(1); return pd.concat([(d.high-d.low).abs(),(d.high-pc).abs(),(d.low-pc).abs()],axis=1).max(axis=1).rolling(n).mean()

def feat(x):
    x=x.copy(); x['atr']=atr(x); x['vol_ma20']=x.volume.rolling(20).mean(); x['prev8_low']=x.low.shift(1).rolling(8).min(); x['prev8_high']=x.high.shift(1).rolling(8).max(); x['prev3_high']=x.high.shift(1).rolling(3).max(); x['prev3_low']=x.low.shift(1).rolling(3).min(); x['body']=(x.close-x.open).abs()
    h=x[['open','high','low','close','volume']].resample('1h',label='right',closed='right').agg({'open':'first','high':'max','low':'min','close':'last','volume':'sum'}).dropna(); h['ema20']=h.close.ewm(span=20,adjust=False).mean(); h['ema50']=h.close.ewm(span=50,adjust=False).mean(); h['hh20']=h.high.shift(1).rolling(20).max(); h['ll20']=h.low.shift(1).rolling(20).min(); mid=(h.hh20+h.ll20)/2; h['bias']=0; h.loc[(h.ema20>h.ema50)&(h.close>mid),'bias']=1; h.loc[(h.ema20<h.ema50)&(h.close<mid),'bias']=-1
    return pd.merge_asof(x.reset_index(),h[['bias']].shift(1).reset_index(),on='time',direction='backward').set_index('time')

def setups(x):
    valid=x.atr.notna()&x.vol_ma20.notna()&(x.atr>0)&(x.volume>=1.05*x.vol_ma20)
    L=valid&(x.bias==1)&(x.low<x.prev8_low)&(x.close>x.prev8_low)&(x.close>x.open)&(x.body>=.9*x.atr)&(x.close>x.prev3_high)
    S=valid&(x.bias==-1)&(x.high>x.prev8_high)&(x.close<x.prev8_high)&(x.close<x.open)&(x.body>=.9*x.atr)&(x.close<x.prev3_low)
    idx=np.flatnonzero((L|S).to_numpy()); op=x.open.to_numpy(); cl=x.close.to_numpy(); lo=x.low.to_numpy(); hi=x.high.to_numpy(); av=x.atr.to_numpy(); lb=L.to_numpy(); out=[]
    for i in idx:
        if i<25 or i>=len(x)-20: continue
        side=1 if lb[i] else -1; z=None
        for j in range(i-1,max(i-6,0),-1):
            if (side==1 and cl[j]<op[j]) or (side==-1 and cl[j]>op[j]): z=(lo[j],hi[j]); break
        if z is None: continue
        zl,zh=z
        if zh-zl<=1.5*av[i]: out.append((int(i),side,float(zl),float(zh),float(av[i])))
    return out

def run(x,ss,rr,session):
    t=[]; busy=-1; lo=x.low.to_numpy(); hi=x.high.to_numpy(); cl=x.close.to_numpy(); times=x.index; hours=x.index.hour.to_numpy()
    for i,side,zl,zh,a in ss:
        if i<=busy: continue
        mid=(zl+zh)/2; stop=zl-.1*a if side==1 else zh+.1*a; ei=None
        for k in range(i+1,min(i+13,len(x))):
            if session and not (7<=hours[k]<17): continue
            touched=lo[k]<=mid<=hi[k]; invalid=(lo[k]<=stop if side==1 else hi[k]>=stop)
            if touched: ei=k; break
            if invalid: break
        if ei is None: continue
        risk=abs(mid-stop)
        if risk<=0: continue
        tp=mid+side*rr*risk; res=None; xo=None
        for k in range(ei,min(ei+97,len(x))):
            sl=(lo[k]<=stop if side==1 else hi[k]>=stop); hit=(hi[k]>=tp if side==1 else lo[k]<=tp)
            if sl: res=-1.; xo=k; break
            if hit: res=rr; xo=k; break
        if res is None:
            xo=min(ei+96,len(x)-1); res=max(-1,min(rr,side*(cl[xo]-mid)/risk))
        t.append({'entry_time':str(times[ei]),'exit_time':str(times[xo]),'side':'LONG' if side==1 else 'SHORT','entry':mid,'stop':stop,'target':tp,'R':res}); busy=xo
    rs=pd.Series([q['R'] for q in t],dtype=float)
    if len(rs)==0:return t,{'trades':0}
    eq=rs.cumsum(); dd=eq-eq.cummax(); gw=rs[rs>0].sum(); gl=-rs[rs<0].sum()
    return t,{'trades':len(rs),'win_rate_pct':round(100*(rs>0).mean(),2),'net_R':round(float(rs.sum()),2),'avg_R':round(float(rs.mean()),4),'profit_factor':round(float(gw/gl),3) if gl else None,'max_drawdown_R':round(float(dd.min()),2),'wins':int((rs>0).sum()),'losses':int((rs<0).sum()),'start':t[0]['entry_time'],'end':t[-1]['exit_time']}

def main():
    x=feat(load()); ss=setups(x); s={'symbol':SYMBOL,'rows':len(x),'start':str(x.index.min()),'end':str(x.index.max()),'candidate_setups':len(ss),'variants':{}}
    for name,se in [('all_hours',False),('london_ny_07_17utc',True)]:
        for rr in (1.5,2.0):
            key=f'{name}_rr{rr}'; tr,st=run(x,ss,rr,se); s['variants'][key]=st; pd.DataFrame(tr).to_csv(OUT/f'{key}.csv',index=False)
    (OUT/'summary.json').write_text(json.dumps(s,indent=2)); print(json.dumps(s,indent=2))
if __name__=='__main__': main()
