#!/usr/bin/env python3
import json, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from tvDatafeed import TvDatafeed, Interval

TICKERS = [
    'AKBNK','ALARK','ARCLK','ASELS','ASTOR','BIMAS','DOAS','EKGYO','ENJSA','EREGL',
    'FROTO','GARAN','GESAN','GUBRF','HEKTS','ISCTR','KCHOL','KONTR','KOZAL','KRDMD',
    'MGROS','ODAS','OYAKC','PETKM','PGSUS','SAHOL','SASA','SISE','SMRTG','TAVHL',
    'TCELL','THYAO','TOASO','TSKB','TUPRS','ULKER','VAKBN','VESTL','YKBNK','ZOREN',
    'AGHOL','AEFES','AKSA','AKSEN','ALFAS','CCOLA','CWENE','EGEEN','ENKAI','GWIND',
    'HALKB','ISGYO','IZENR','JANTS','KARSN','MAVI','MPARK','OTKAR','QUAGR','SKBNK',
    'SOKM','TABGD','TKFEN','TRGYO','TTRAK'
]
OUT = Path('data/galatali_bist')
OUT.mkdir(parents=True, exist_ok=True)

PATTERNS = {
    'Gartley':   {'b':(0.56,0.68),'bc':(0.35,0.92),'cd':(1.05,1.70),'d':(0.74,0.82)},
    'Bat':       {'b':(0.34,0.54),'bc':(0.35,0.92),'cd':(1.50,2.75),'d':(0.84,0.92)},
    'Butterfly': {'b':(0.74,0.83),'bc':(0.35,0.92),'cd':(1.50,2.35),'d':(1.20,1.68)},
    'Crab':      {'b':(0.34,0.66),'bc':(0.35,0.92),'cd':(2.10,3.80),'d':(1.50,1.72)},
}

_tls = threading.local()

def _tv():
    if not hasattr(_tls, 'client'):
        _tls.client = TvDatafeed()
    return _tls.client

def fetch_chart(symbol, interval='1d', rng='2y'):
    try:
        iv = Interval.in_daily if interval == '1d' else Interval.in_weekly
        n_bars = 520 if interval == '1d' else 260
        df = _tv().get_hist(symbol=symbol, exchange='BIST', interval=iv, n_bars=n_bars, extended_session=False)
        if df is None or len(df) == 0:
            return [], 'TradingView no data'
        rows=[]
        for idx,r in df.iterrows():
            try:
                rows.append({'t':int(idx.timestamp()),'o':float(r['open']),'h':float(r['high']),'l':float(r['low']),'c':float(r['close'])})
            except Exception:
                continue
        return rows, None if rows else 'TradingView empty rows'
    except Exception as e:
        return [], f'TradingView {type(e).__name__}: {e}'


def pivots(rows, span=4):
    out=[]; n=len(rows)
    for i in range(span,n-span):
        hi=rows[i]['h']; lo=rows[i]['l']
        hs=[rows[j]['h'] for j in range(i-span,i+span+1)]
        ls=[rows[j]['l'] for j in range(i-span,i+span+1)]
        if hi==max(hs): out.append((i,'H',hi))
        if lo==min(ls): out.append((i,'L',lo))
    out.sort(); cleaned=[]
    for p in out:
        if not cleaned or p[1]!=cleaned[-1][1]: cleaned.append(p)
        elif p[1]=='H' and p[2]>cleaned[-1][2]: cleaned[-1]=p
        elif p[1]=='L' and p[2]<cleaned[-1][2]: cleaned[-1]=p
    return cleaned[-16:]


def leg(a,b): return abs(b[2]-a[2])
def _err_to_mid(v, lo, hi):
    mid=(lo+hi)/2; half=max((hi-lo)/2,1e-9)
    return abs(v-mid)/half

def score_pattern(x,a,b,c,d,name):
    xa=leg(x,a); ab=leg(a,b); bc=leg(b,c); cd=leg(c,d)
    if min(xa,ab,bc,cd)<=0: return None
    bxa=ab/xa; bcab=bc/ab; cd_bc=cd/bc; dxa=abs(d[2]-x[2])/xa
    cfg=PATTERNS[name]
    vals={'b':bxa,'bc':bcab,'cd':cd_bc,'d':dxa}
    for k,v in vals.items():
        lo,hi=cfg[k]
        if not (lo <= v <= hi): return None
    err=(0.30*_err_to_mid(bxa,*cfg['b'])+0.15*_err_to_mid(bcab,*cfg['bc'])+
         0.20*_err_to_mid(cd_bc,*cfg['cd'])+0.35*_err_to_mid(dxa,*cfg['d']))
    score=max(0, min(100, round(100-32*err)))
    return score,bxa,bcab,cd_bc,dxa


def analyze(symbol, interval, rng, span):
    rows,ferr=fetch_chart(symbol,interval,rng)
    if len(rows)<80: return [], ferr or f'insufficient rows={len(rows)}'
    pv=pivots(rows,span)
    if len(pv)<5: return [], f'insufficient pivots={len(pv)}'
    last=rows[-1]['c']; findings=[]
    for start in range(max(0,len(pv)-12),len(pv)-4):
        pts=pv[start:start+5]
        if len(pts)<5 or any(pts[i][1]==pts[i+1][1] for i in range(4)): continue
        x,a,b,c,d=pts; direction='pozitif' if d[1]=='L' else 'negatif'
        bars_since_d=len(rows)-1-d[0]; max_age=70 if interval=='1d' else 18
        if bars_since_d>max_age: continue
        for name in PATTERNS:
            sc=score_pattern(x,a,b,c,d,name)
            if not sc: continue
            score,bxa,bcab,cd_bc,dxa=sc; dprice=d[2]; xa=abs(a[2]-x[2])
            if direction=='pozitif':
                target1=dprice+0.382*xa; target2=dprice+0.618*xa; invalid=dprice-0.12*xa
                progress=(last-dprice)/(target2-dprice) if target2!=dprice else 0
                potential=(target2-last)/last*100; invalidated=last < invalid
            else:
                target1=dprice-0.382*xa; target2=dprice-0.618*xa; invalid=dprice+0.12*xa
                progress=(dprice-last)/(dprice-target2) if dprice!=target2 else 0
                potential=(last-target2)/last*100; invalidated=last > invalid
            progress=max(-1.0,min(2.0,progress))
            if invalidated: status='geçersiz'
            elif progress>=1.0: status='tamamlandı-kâr koru'
            elif progress>=0.70: status='hedefe yakın-kovalama'
            elif progress>=0.10: status='aktif-takip'
            else: status='doğru maliyet bekle'
            findings.append({
                'symbol':symbol,'timeframe':interval,'pattern':name,'direction':direction,'confidence':score,
                'x':round(x[2],4),'a':round(a[2],4),'b':round(b[2],4),'c':round(c[2],4),'d':round(d[2],4),
                'b_xa':round(bxa,3),'bc_ab':round(bcab,3),'cd_bc':round(cd_bc,3),'d_xa':round(dxa,3),
                'last':round(last,4),'invalid':round(invalid,4),'target1':round(target1,4),'target2':round(target2,4),
                'progress_pct':round(progress*100,1),'status':status,'potential_to_t2_pct':round(potential,1),
                'd_date':datetime.fromtimestamp(rows[d[0]]['t'],timezone.utc).date().isoformat(),'bars_since_d':bars_since_d,
            })
    findings.sort(key=lambda z:(z['confidence'],-abs(z['progress_pct']-35)),reverse=True)
    return findings[:4], None


def scan_one(task):
    s,interval,rng,span=task
    try:
        f,err=analyze(s,interval,rng,span)
        return f, ({'symbol':s,'timeframe':interval,'error':err} if err else None)
    except Exception as e:
        return [], {'symbol':s,'timeframe':interval,'error':f'{type(e).__name__}: {e}'}


def main():
    allf=[]; errors=[]; tasks=[]
    for s in TICKERS:
        tasks += [(s,'1d','2y',4),(s,'1wk','5y',2)]
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures=[ex.submit(scan_one,t) for t in tasks]
        for fut in as_completed(futures):
            f,err=fut.result(); allf += f
            if err: errors.append(err)
    rank={'aktif-takip':5,'doğru maliyet bekle':4,'hedefe yakın-kovalama':2,'tamamlandı-kâr koru':1,'geçersiz':0}
    allf.sort(key=lambda z:(rank.get(z['status'],0),z['confidence'],z['potential_to_t2_pct']),reverse=True)
    payload={'generated_at':datetime.now(timezone.utc).isoformat(),'source':'TradingView via tvDatafeed','universe':len(TICKERS),'findings':allf,'errors':errors}
    (OUT/'scan.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Galatalı Metodu — BIST Tarama','',f"Güncelleme: {payload['generated_at']}",'Veri: TradingView / BIST',f"Evren: {len(TICKERS)} hisse",f"Aday: {len(allf)}",f"Veri uyarısı: {len(errors)}",'',
           '> Harmonik oranlar aday üretmek için klasik literatürden gelir; Galatalı arşivinden kanıtlanan bölüm formasyon → doğru maliyet → hedef → hedef sonrası düzeltme yaşam döngüsüdür.','']
    for f in allf[:50]:
        lines += [f"## {f['symbol']} — {f['pattern']} / {f['timeframe']}",
                  f"- Yön: {f['direction']} | Güven: {f['confidence']}/100 | Durum: **{f['status']}**",
                  f"- Fiyat: {f['last']} | D/PRZ: {f['d']} | Invalidasyon: {f['invalid']}",
                  f"- Hedef 1: {f['target1']} | Hedef 2: {f['target2']} | H2 kalan: %{f['potential_to_t2_pct']}",
                  f"- X-A-B-C-D: {f['x']} / {f['a']} / {f['b']} / {f['c']} / {f['d']}",
                  f"- B/XA: {f['b_xa']} | BC/AB: {f['bc_ab']} | CD/BC: {f['cd_bc']} | D/XA: {f['d_xa']}",
                  f"- Hedef ilerleme: %{f['progress_pct']} | D'den beri bar: {f['bars_since_d']}",'']
    if errors:
        lines += ['## Veri uyarıları','']+[f"- {e['symbol']} {e['timeframe']}: {e['error']}" for e in errors[:40]]
    (OUT/'scan.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    (OUT/'status.txt').write_text(f"source=tradingview scanned={len(TICKERS)} findings={len(allf)} errors={len(errors)} generated_at={payload['generated_at']}\n",encoding='utf-8')
    print(f"source=tradingview scanned={len(TICKERS)} findings={len(allf)} errors={len(errors)}")

if __name__=='__main__': main()
