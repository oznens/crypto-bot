#!/usr/bin/env python3
import json,re
from collections import Counter
from pathlib import Path

SRC=Path('data/galatali/tweets.json')
OUT=Path('data/galatali/method_summary.md')
rows=json.loads(SRC.read_text(encoding='utf-8'))
texts=[str(x.get('text') or '') for x in rows]
blob='\n'.join(texts).lower()

patterns={
 'gartley':['gartley','gartley'],
 'bat_yarasa':['yarasa','bat'],
 'crab_yengec':['yengeç','yengec','crab'],
 'butterfly_kelebek':['kelebek','butterfly'],
 'shark':['shark','köpekbalığı','kopekbaligi'],
 'cypher':['cypher'],
 'ab=cd':['ab=cd','abcd'],
 'negatif_formasyon':['negatif formasyon'],
 'harmonik':['harmonik'],
 'hedef_duzeltmesi':['hedef düzeltmesi','hedef duzeltmesi'],
 'formasyon_tamamlandi':['formasyon tamamlandı','formasyon tamamlandi'],
 'hedefe_ulasti':['hedefe ulaştı','hedefe ulasti'],
 'uyari':['uyarı','uyari'],
 'maliyet':['maliyet'],
 'kar_realizasyonu':['kar realizasyonu','kâr realizasyonu'],
 'stop':['stop','zarar kes'],
 'fibonacci':['fibonacci','fib '],
 'destek':['destek'],
 'direnc':['direnç','direnc'],
 'trend':['trend'],
 'kanal':['kanal'],
 'formasyon':['formasyon'],
}
counts={k:sum(blob.count(v) for v in vs) for k,vs in patterns.items()}

sym=Counter()
for t in texts:
    for s in re.findall(r'#([A-ZÇĞİÖŞÜ]{3,10})\b',t):
        if s not in {'BIST','BORSA','XU100','XU030','YTD','FED'}:
            sym[s]+=1

lines=['# Galatalı Borsacı Metodoloji Özeti','',f'İncelenen benzersiz tweet: {len(rows)}','', '## Terim frekansları','']
for k,v in sorted(counts.items(), key=lambda x:x[1], reverse=True):
    lines.append(f'- {k}: {v}')
lines += ['', '## En sık geçen semboller','']
for k,v in sym.most_common(30): lines.append(f'- {k}: {v}')
lines += ['', '## Otomatik çıkarım','',
'- Paylaşım dili güçlü biçimde formasyon-merkezli; hedefe ulaşma ve hedef sonrası düzeltme ayrı aşamalar olarak takip ediliyor.',
'- Harmonik formasyon adlarının frekansı, yöntemin ana omurgasının harmonik/geometrik hedefleme olduğunu test etmek için kullanılacak.',
'- Maliyet, uyarı, kâr realizasyonu ve stop ifadeleri işlem yönetimi katmanını anlamak için ayrıca incelenecek.',
'- Grafik içi çizimler sonraki aşamada tweet metniyle eşleştirilerek giriş, PRZ/hedef ve geçersizlik mantığına ayrılacak.','']
OUT.write_text('\n'.join(lines),encoding='utf-8')
print(OUT)
