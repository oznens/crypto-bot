#!/usr/bin/env python3
import json, math, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

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
    'Gartley': {'b':(0.56,0.68),'d':(0.72,0.84)},
    'Bat': {'b':(0.32,0.55),'d':(0.84,0.93)},
    'Butterfly': {'b':(0.72,0.84),'d':(1.20,1.70)},
    'Crab': {'b':(0.32,0.68),'d':(1.50,1.75)},
}

UA='Mozilla/5.0 crypto-bot-galatali-bist/1.0'

def fetch_chart(symbol, interval='1d', rng='2y'):
    ysym = symbol + '.IS'
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{ysym}?range={rng}&interval={interval}&includePrePost=false&events=div%2Csplits'
    req = Request(url, headers={'User-Agent':UA,'Accept':'application/json'})
    try:
        with urlopen(req, timeout=25) as r:
            obj = json.load(r)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return []
    try:
        res = obj['chart']['result'][0]
        ts = res['timestamp']
        q = res['indicators']['quote'][0]
    except Exception:
        return []
    rows=[]
    for i,t in enumerate(ts):
        try:
            o,h,l,c = q['open'][i],q['high'][i],q['low'][i],q['close'][i]
            if None in (o,h,l,c): continue
            rows.append({'t':t,'o':float(o),'h':float(h),'l':float(l),'c':float(c)})
        except Exception:
            continue
    return rows


def pivots(rows, span=4):
    out=[]
    n=len(rows)
    for i in range(span,n-span):
        hi=rows[i]['h']; lo=rows[i]['l']
        hs=[rows[j]['h'] for j in range(i-span,i+span+1)]
        ls=[rows[j]['l'] for j in range(i-span,i+span+1)]
        if hi==max(hs): out.append((i,'H',hi))
        if lo==min(ls): out.append((i,'L',lo))
    out.sort()
    cleaned=[]
    for p in out:
        if not cleaned or p[1]!=cleaned[-1][1]: cleaned.append(p)
        else:
            if p[1]=='H' and p[2]>cleaned[-1][2]: cleaned[-1]=p
            elif p[1]=='L' and p[2]<cleaned[-1][2]: cleaned[-1]=p
    return cleaned[-12:]


def ratio(a,b):
    return abs(b[2]-a[2])


def score_pattern(x,a,b,c,d,name):
    xa=ratio(x,a)
    if xa<=0: return None
    bxa=ratio(a,b)/xa
    dxa=abs(d[2]-x[2])/xa
    cfg=PATTERNS[name]
    if not (cfg['b'][0] <= bxa <= cfg['b'][1] and cfg['d'][0] <= dxa <= cfg['d'][1]):
        return None
    midb=sum(cfg['b'])/2; midd=sum(cfg['d'])/2
    eb=abs(bxa-midb)/((cfg['b'][1]-cfg['b'][0])/2)
    ed=abs(dxa-midd)/((cfg['d'][1]-cfg['d'][0])/2)
    score=max(0,100-round(20*eb+25*ed))
    return score,bxa,dxa


def classify_direction(points):
    x,a,b,c,d=points
    return 'pozitif' if d[1]=='L' else 'negatif'


def analyze(symbol, interval, rng, span):
    rows=fetch_chart(symbol,interval,rng)
    if len(rows)<80: return []
    pv=pivots(rows,span)
    if len(pv)<5: return []
    last=rows[-1]['c']
    findings=[]
    for start in range(max(0,len(pv)-8),len(pv)-4):
        pts=pv[start:start+5]
        if len(pts)<5: continue
        if any(pts[i][1]==pts[i+1][1] for i in range(4)): continue
        x,a,b,c,d=pts
        direction=classify_direction(pts)
        for name in PATTERNS:
            sc=score_pattern(x,a,b,c,d,name)
            if not sc: continue
            score,bxa,dxa=sc
            dprice=d[2]
            xa=abs(a[2]-x[2])
            if direction=='pozitif':
                target1=dprice+0.382*xa; target2=dprice+0.618*xa; invalid=dprice-0.12*xa
                progress=(last-dprice)/(target2-dprice) if target2!=dprice else 0
            else:
                target1=dprice-0.382*xa; target2=dprice-0.618*xa; invalid=dprice+0.12*xa
                progress=(dprice-last)/(dprice-target2) if dprice!=target2 else 0
            progress=max(-1.0,min(2.0,progress))
            if progress>=1.0: status='tamamlandı-kâr koru'
            elif progress>=0.70: status='hedefe yakın-kovalama'
            elif progress>=0.10: status='aktif-takip'
            else: status='doğru maliyet bekle'
            findings.append({
                'symbol':symbol,'timeframe':interval,'pattern':name,'direction':direction,'confidence':score,
                'x':x[2],'a':a[2],'b':b[2],'c':c[2],'d':d[2],
                'b_xa':round(bxa,3),'d_xa':round(dxa,3),'last':round(last,4),
                'invalid':round(invalid,4),'target1':round(target1,4),'target2':round(target2,4),
                'progress_pct':round(progress*100,1),'status':status,
                'potential_to_t2_pct':round(((target2-last)/last*100) if direction=='pozitif' else ((last-target2)/last*100),1),
                'd_date':datetime.fromtimestamp(rows[d[0]]['t'],timezone.utc).date().isoformat(),
            })
    findings.sort(key=lambda z:(z['confidence'], -abs(z['progress_pct']-35)), reverse=True)
    return findings[:3]


def main():
    allf=[]; errors=[]
    for i,s in enumerate(TICKERS,1):
        try:
            allf += analyze(s,'1d','2y',4)
            allf += analyze(s,'1wk','5y',2)
        except Exception as e:
            errors.append({'symbol':s,'error':str(e)})
        time.sleep(0.15)
    # Galatali filter: prefer active / right-cost candidates, penalize exhausted targets.
    rank={'doğru maliyet bekle':3,'aktif-takip':4,'hedefe yakın-kovalama':1,'tamamlandı-kâr koru':0}
    allf.sort(key=lambda z:(rank.get(z['status'],0),z['confidence'],z['potential_to_t2_pct']), reverse=True)
    payload={'generated_at':datetime.now(timezone.utc).isoformat(),'universe':len(TICKERS),'findings':allf,'errors':errors}
    (OUT/'scan.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# Galatalı Metodu — BIST Tarama','',f"Güncelleme: {payload['generated_at']}",f"Evren: {len(TICKERS)} hisse",f"Aday: {len(allf)}",'',
           '> Not: Harmonik Fibonacci oranları klasik literatürden aday üretmek için kullanılır; Galatalı arşivinden kanıtlanan kısım formasyon-hedef-maliyet-hedef sonrası düzeltme yaşam döngüsüdür.','']
    for f in allf[:40]:
        lines += [f"## {f['symbol']} — {f['pattern']} / {f['timeframe']}",
                  f"- Yön: {f['direction']} | Güven: {f['confidence']}/100 | Durum: **{f['status']}**",
                  f"- Fiyat: {f['last']} | D/PRZ: {round(f['d'],4)} | Invalidasyon: {f['invalid']}",
                  f"- Hedef 1: {f['target1']} | Hedef 2: {f['target2']} | H2 kalan potansiyel: %{f['potential_to_t2_pct']}",
                  f"- X-A-B-C-D: {round(f['x'],4)} / {round(f['a'],4)} / {round(f['b'],4)} / {round(f['c'],4)} / {round(f['d'],4)}",
                  f"- B/XA: {f['b_xa']} | D/XA: {f['d_xa']} | Hedef ilerleme: %{f['progress_pct']}",'']
    if errors:
        lines += ['## Veri hataları','']+[f"- {e['symbol']}: {e['error']}" for e in errors[:20]]
    (OUT/'scan.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(f"scanned={len(TICKERS)} findings={len(allf)} errors={len(errors)}")

if __name__=='__main__': main()
