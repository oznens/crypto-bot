import json
import math
import urllib.request
from pathlib import Path

import pandas as pd

DATA_URL = "https://raw.githubusercontent.com/simom1/XAUUSD-history/main/Gold-Cash/XAUUSD/XAUUSD_M15_2010_2026.csv"
OUT = Path("backtests/yusuf-results")
OUT.mkdir(parents=True, exist_ok=True)


def load_data():
    p = Path('/tmp/xau_m15.csv')
    urllib.request.urlretrieve(DATA_URL, p)
    df = pd.read_csv(p)
    df.columns = [c.lower().strip() for c in df.columns]
    dtcol = 'time' if 'time' in df.columns else 'date'
    df[dtcol] = pd.to_datetime(df[dtcol], utc=True, errors='coerce')
    df = df.dropna(subset=[dtcol]).sort_values(dtcol).drop_duplicates(dtcol).set_index(dtcol)
    for c in ['open','high','low','close','tick_volume']:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    return df.dropna(subset=['open','high','low','close'])


def atr(df, n=14):
    pc = df['close'].shift(1)
    tr = pd.concat([(df.high-df.low).abs(), (df.high-pc).abs(), (df.low-pc).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean()


def add_features(m15):
    x = m15.copy()
    x['atr'] = atr(x, 14)
    x['vol_ma20'] = x.tick_volume.rolling(20).mean()
    x['prev8_low'] = x.low.shift(1).rolling(8).min()
    x['prev8_high'] = x.high.shift(1).rolling(8).max()
    x['prev3_high'] = x.high.shift(1).rolling(3).max()
    x['prev3_low'] = x.low.shift(1).rolling(3).min()
    x['body'] = (x.close-x.open).abs()

    h1 = x[['open','high','low','close','tick_volume']].resample('1h', label='right', closed='right').agg({
        'open':'first','high':'max','low':'min','close':'last','tick_volume':'sum'
    }).dropna()
    h1['ema20'] = h1.close.ewm(span=20, adjust=False).mean()
    h1['ema50'] = h1.close.ewm(span=50, adjust=False).mean()
    h1['hh20'] = h1.high.shift(1).rolling(20).max()
    h1['ll20'] = h1.low.shift(1).rolling(20).min()
    mid = (h1.hh20 + h1.ll20) / 2
    h1['bias'] = 0
    h1.loc[(h1.ema20 > h1.ema50) & (h1.close > mid), 'bias'] = 1
    h1.loc[(h1.ema20 < h1.ema50) & (h1.close < mid), 'bias'] = -1
    hb = h1[['bias']].shift(1).reset_index().rename(columns={h1.index.name or 'index':'time'})
    xx = x.reset_index().rename(columns={x.index.name or 'index':'time'})
    xx = pd.merge_asof(xx.sort_values('time'), hb.sort_values('time'), on='time', direction='backward')
    return xx.set_index('time')


def candidate_setups(x):
    setups=[]
    for i in range(25, len(x)-20):
        r=x.iloc[i]
        if not math.isfinite(r.atr) or r.atr <= 0 or not math.isfinite(r.vol_ma20):
            continue
        if r.tick_volume < 1.05*r.vol_ma20:
            continue
        long_evt = (r.bias==1 and r.low < r.prev8_low and r.close > r.prev8_low and r.close > r.open and r.body >= 0.9*r.atr and r.close > r.prev3_high)
        short_evt = (r.bias==-1 and r.high > r.prev8_high and r.close < r.prev8_high and r.close < r.open and r.body >= 0.9*r.atr and r.close < r.prev3_low)
        if not (long_evt or short_evt):
            continue
        side = 1 if long_evt else -1
        z=None
        for j in range(i-1, max(i-6,0), -1):
            q=x.iloc[j]
            if (side==1 and q.close < q.open) or (side==-1 and q.close > q.open):
                z=(float(q.low), float(q.high))
                break
        if z is None:
            continue
        zl, zh = z
        if zh-zl > 1.5*r.atr:
            continue
        setups.append((i, side, zl, zh, float(r.atr)))
    return setups


def run_variant(x, setups, rr=2.0, session=False):
    trades=[]
    busy_until=-1
    for i,side,zl,zh,a in setups:
        if i <= busy_until:
            continue
        entry_idx=None; entry=None
        midpoint=(zl+zh)/2
        stop = zl-0.10*a if side==1 else zh+0.10*a
        for k in range(i+1, min(i+13,len(x))):
            bar=x.iloc[k]
            if session and not (7 <= bar.name.hour < 17):
                continue
            # A bar that reaches entry is a fill even if it also reaches SL.
            if bar.low <= midpoint <= bar.high:
                entry_idx=k; entry=midpoint; break
            # Only invalidate when price reaches SL without trading through entry.
            if side==1 and bar.high < midpoint and bar.low <= stop:
                break
            if side==-1 and bar.low > midpoint and bar.high >= stop:
                break
        if entry_idx is None:
            continue
        risk = abs(entry-stop)
        if risk <= 0:
            continue
        target = entry + side*rr*risk
        result=None; exit_idx=None
        for k in range(entry_idx, min(entry_idx+97,len(x))):
            bar=x.iloc[k]
            hit_sl = bar.low <= stop if side==1 else bar.high >= stop
            hit_tp = bar.high >= target if side==1 else bar.low <= target
            if hit_sl and hit_tp:
                result=-1.0; exit_idx=k; break
            if hit_sl:
                result=-1.0; exit_idx=k; break
            if hit_tp:
                result=rr; exit_idx=k; break
        if result is None:
            k=min(entry_idx+96,len(x)-1)
            px=float(x.iloc[k].close)
            result=max(-1.0,min(rr, side*(px-entry)/risk))
            exit_idx=k
        trades.append({'entry_time':str(x.index[entry_idx]),'exit_time':str(x.index[exit_idx]),'side':'LONG' if side==1 else 'SHORT','entry':entry,'stop':stop,'target':target,'R':result})
        busy_until=exit_idx
    if not trades:
        return trades, {'trades':0}
    rs=pd.Series([t['R'] for t in trades], dtype=float)
    eq=rs.cumsum(); dd=eq-eq.cummax()
    wins=(rs>0).sum(); losses=(rs<0).sum()
    gross_win=rs[rs>0].sum(); gross_loss=-rs[rs<0].sum()
    stats={'trades':int(len(rs)),'win_rate_pct':round(100*wins/len(rs),2),'net_R':round(float(rs.sum()),2),'avg_R':round(float(rs.mean()),4),'profit_factor':round(float(gross_win/gross_loss),3) if gross_loss else None,'max_drawdown_R':round(float(dd.min()),2),'wins':int(wins),'losses':int(losses),'start':trades[0]['entry_time'],'end':trades[-1]['exit_time']}
    return trades, stats


def main():
    m15=load_data(); x=add_features(m15); setups=candidate_setups(x)
    summary={'data_rows':len(x),'data_start':str(x.index.min()),'data_end':str(x.index.max()),'candidate_setups':len(setups),'variants':{}}
    for session_name,session in [('all_hours',False),('london_ny_07_17utc',True)]:
        for rr in (1.5,2.0):
            name=f'{session_name}_rr{rr}'
            trades,stats=run_variant(x,setups,rr=rr,session=session)
            summary['variants'][name]=stats
            pd.DataFrame(trades).to_csv(OUT/f'{name}.csv',index=False)
    with open(OUT/'summary.json','w') as f:
        json.dump(summary,f,indent=2)
    print(json.dumps(summary,indent=2))

if __name__=='__main__':
    main()
