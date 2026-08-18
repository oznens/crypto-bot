import io,zipfile,urllib.request,json,math
from pathlib import Path
import pandas as pd

SYMBOL='BTCUSDT'; START='2018-01'; END='2026-07'; OUT=Path('backtests/yusuf-btc-results'); OUT.mkdir(parents=True,exist_ok=True)

def months(a,b):
    p=pd.Period(a,'M'); e=pd.Period(b,'M')
    while p<=e:
        yield str(p); p+=1

def load():
    frames=[]
    cols=['open_time','open','high','low','close','volume','close_time','quote_volume','trades','taker_base','taker_quote','ignore']
    for m in months(START,END):
        url=f'https://data.binance.vision/data/spot/monthly/klines/{SYMBOL}/15m/{SYMBOL}-15m-{m}.zip'
        try:
            z=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url,timeout=30).read()))
            f=z.open(z.namelist()[0]); d=pd.read_csv(f,header=None,names=cols)
            frames.append(d)
        except Exception as e:
            print('skip',m,e)
    d=pd.concat(frames,ignore_index=True)
    d['time']=pd.to_datetime(d.open_time,unit='ms',utc=True,errors='coerce')
    for c in ['open','high','low','close','volume']: d[c]=pd.to_numeric(d[c],errors='coerce')
    return d.dropna(subset=['time','open','high','low','close']).drop_duplicates('time').sort_values('time').set_index('time')

def atr(d,n=14):
    pc=d.close.shift(1); tr=pd.concat([(d.high-d.low).abs(),(d.high-pc).abs(),(d.low-pc).abs()],axis=1).max(axis=1); return tr.rolling(n).mean()

def feat(x):
    x=x.copy(); x['atr']=atr(x); x['vol_ma20']=x.volume.rolling(20).mean(); x['prev8_low']=x.low.shift(1).rolling(8).min(); x['prev8_high']=x.high.shift(1).rolling(8).max(); x['prev3_high']=x.high.shift(1).rolling(3).max(); x['prev3_low']=x.low.shift(1).rolling(3).min(); x['body']=(x.close-x.open).abs()
    h=x[['open','high','low','close','volume']].resample('1h',label='right',closed='right').agg({'open':'first','high':'max','low':'min','close':'last','volume':'sum'}).dropna()
    h['ema20']=h.close.ewm(span=20,adjust=False).mean(); h['ema50']=h.close.ewm(span=50,adjust=False).mean(); h['hh20']=h.high.shift(1).rolling(20).max(); h['ll20']=h.low.shift(1).rolling(20).min(); mid=(h.hh20+h.ll20)/2; h['bias']=0; h.loc[(h.ema20>h.ema50)&(h.close>mid),'bias']=1; h.loc[(h.ema20<h.ema50)&(h.close<mid),'bias']=-1
    hb=h[['bias']].shift(1).reset_index(); xx=x.reset_index(); return pd.merge_asof(xx,hb,on='time',direction='backward').set_index('time')

def setups(x):
    out=[]
    for i in range(25,len(x)-20):
        r=x.iloc[i]
        if not math.isfinite(r.atr) or r.atr<=0 or not math.isfinite(r.vol_ma20) or r.volume<1.05*r.vol_ma20: continue
        L=(r.bias==1 and r.low<r.prev8_low and r.close>r.prev8_low and r.close>r.open and r.body>=.9*r.atr and r.close>r.prev3_high)
        S=(r.bias==-1 and r.high>r.prev8_high and r.close<r.prev8_high and r.close<r.open and r.body>=.9*r.atr and r.close<r.prev3_low)
        if not (L or S): continue
        side=1 if L else -1; z=None
        for j in range(i-1,max(i-6,0),-1):
            q=x.iloc[j]
            if (side==1 and q.close<q.open) or (side==-1 and q.close>q.open): z=(float(q.low),float(q.high)); break
        if not z: continue
        zl,zh=z
        if zh-zl>1.5*r.atr: continue
        out.append((i,side,zl,zh,float(r.atr)))
    return out

def run(x,ss,rr,session):
    t=[]; busy=-1
    for i,side,zl,zh,a in ss:
        if i<=busy: continue
        mid=(zl+zh)/2; ei=None; stop=zl-.1*a if side==1 else zh+.1*a
        for k in range(i+1,min(i+13,len(x))):
            b=x.iloc[k]
            if session and not (7<=b.name.hour<17): continue
            touched=b.low<=mid<=b.high; invalid=(b.low<=stop if side==1 else b.high>=stop)
            if touched: ei=k; break
            if invalid: break
        if ei is None: continue
        risk=abs(mid-stop)
        if risk<=0: continue
        tp=mid+side*rr*risk; res=None; xo=None
        for k in range(ei,min(ei+97,len(x))):
            b=x.iloc[k]; sl=(b.low<=stop if side==1 else b.high>=stop); hit=(b.high>=tp if side==1 else b.low<=tp)
            if sl: res=-1.; xo=k; break
            if hit: res=rr; xo=k; break
        if res is None:
            xo=min(ei+96,len(x)-1); px=float(x.iloc[xo].close); res=max(-1,min(rr,side*(px-mid)/risk))
        t.append({'entry_time':str(x.index[ei]),'exit_time':str(x.index[xo]),'side':'LONG' if side==1 else 'SHORT','entry':mid,'stop':stop,'target':tp,'R':res}); busy=xo
    rs=pd.Series([q['R'] for q in t],dtype=float)
    if len(rs)==0:return t,{'trades':0}
    eq=rs.cumsum(); dd=eq-eq.cummax(); gw=rs[rs>0].sum(); gl=-rs[rs<0].sum()
    return t,{'trades':len(rs),'win_rate_pct':round(100*(rs>0).mean(),2),'net_R':round(rs.sum(),2),'avg_R':round(rs.mean(),4),'profit_factor':round(gw/gl,3) if gl else None,'max_drawdown_R':round(dd.min(),2),'wins':int((rs>0).sum()),'losses':int((rs<0).sum()),'start':t[0]['entry_time'],'end':t[-1]['exit_time']}

def main():
    x=feat(load()); ss=setups(x); s={'symbol':SYMBOL,'rows':len(x),'start':str(x.index.min()),'end':str(x.index.max()),'candidate_setups':len(ss),'variants':{}}
    for name,se in [('all_hours',False),('london_ny_07_17utc',True)]:
        for rr in (1.5,2.0):
            key=f'{name}_rr{rr}'; tr,st=run(x,ss,rr,se); s['variants'][key]=st; pd.DataFrame(tr).to_csv(OUT/f'{key}.csv',index=False)
    (OUT/'summary.json').write_text(json.dumps(s,indent=2)); print(json.dumps(s,indent=2))
if __name__=='__main__': main()
