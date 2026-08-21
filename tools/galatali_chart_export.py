#!/usr/bin/env python3
import json, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from tvDatafeed import TvDatafeed, Interval

OUT=Path('data/galatali_bist')
SRC=OUT/'prz_scan.json'
_tls=threading.local()
def tv():
    if not hasattr(_tls,'c'): _tls.c=TvDatafeed()
    return _tls.c

def fetch_one(key,symbol,tf):
    try:
        iv=Interval.in_daily if tf=='1d' else Interval.in_weekly
        n=260 if tf=='1d' else 180
        df=tv().get_hist(symbol=symbol,exchange='BIST',interval=iv,n_bars=n,extended_session=False)
        if df is None or len(df)<20:return key,None
        bars=[]
        for idx,r in df.iterrows():
            bars.append({'time':idx.strftime('%Y-%m-%d'),'open':round(float(r.open),4),'high':round(float(r.high),4),'low':round(float(r.low),4),'close':round(float(r.close),4)})
        return key,bars
    except Exception:return key,None

def main():
    if not SRC.exists():
        print('prz_scan.json missing'); return
    p=json.loads(SRC.read_text(encoding='utf-8'))
    findings=p.get('findings',[])
    # Sitede gösterilebilecek tüm benzersiz sembol/zaman dilimleri için mumları üret.
    keys=[]; seen=set()
    for f in findings:
        k=f"{f['symbol']}|{f['timeframe']}"
        if k not in seen:
            seen.add(k); keys.append((k,f['symbol'],f['timeframe']))
    charts={}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs=[ex.submit(fetch_one,*x) for x in keys]
        for fut in as_completed(futs):
            k,b=fut.result()
            if b: charts[k]=b
    (OUT/'charts.json').write_text(json.dumps({'generated_at':p.get('generated_at'),'charts':charts},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'chart_series={len(charts)}')
if __name__=='__main__':main()
