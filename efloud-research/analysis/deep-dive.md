# Efloud Trading Framework — Deep Dive

Bu belge, `efloud-research` arşivindeki son 1 yıllık 4.167 tweet ve 478 medya/grafik içeren tweet üzerinden çıkarılan sistematik çerçevedir. Amaç, Efloud'un tekrar eden karar mantığını botlaştırılabilir kurallara çevirmektir.

## 1. Ana fikir

Efloud'un yaklaşımı tek bir pattern veya indikatöre dayanmıyor. Omurga beş katmandan oluşuyor:

1. **HTF bağlam / rejim** — trend, range, chopping zone, önemli HTF destek-direnç bölgeleri.
2. **S/R + Supply/Demand haritası** — fiyatın reaksiyon vermesi beklenen box/zone/level bölgeleri.
3. **LTF confirmation** — yalnızca seviyeye temas değil; kapanış, reclaim, breakout veya retest ile teyit.
4. **Pozisyon yönetimi** — parçalı giriş/çıkış, spot ve margin/futures ayrımı, gerektiğinde hedge.
5. **Risk/psikoloji filtresi** — lose streak, piyasa rejimine uygun olmayan agresif işlemden kaçınma, chopping zone'da risk azaltma.

Arşivde kavram sıklıkları bu omurgayı destekliyor: support/resistance 707, risk/psychology 320, market structure 230, supply/demand 178, range/regime 98, breakout/close 48, liquidity 46.

## 2. Efloud'un piyasa okuma sırası

### A. Önce rejim

İlk soru 'long mu short mu?' değil, **piyasa trend mi, range mi, chop mu?**

- Trend piyasada yönlü continuation ve pullback'ler daha değerli.
- Range piyasada range low / EQ / range high ana haritayı oluşturuyor.
- Chopping zone'da fazla işlem hem bakiyeyi hem psikolojiyi aşındırdığı için trade frekansı ve agresiflik düşürülüyor.

Bu nedenle aynı setup her rejimde aynı kalitede sayılmıyor.

## 3. Seviye mantığı

Efloud çizgiden çok **bölge/box** mantığı kullanıyor. Ana bölgeler:

- Eski support → yeni resistance
- Eski resistance → yeni support
- Range high / range low
- Range EQ (midpoint)
- HTF supply / demand
- LTF reaction zone
- Önceden çalışmış güçlü candle-body bölgeleri

Bir bölgenin değeri yalnızca wick dokunmasına göre değil, **candle body'lerin o bölgeyi kabul/reddetmesine** göre artıyor.

## 4. Confirmation modeli

En kritik çıkarım: **seviye tek başına entry değildir.**

Efloud'un eski ve yeni içeriklerinde tekrar eden yapı şöyledir:

1. Fiyat ana zone'a gelir.
2. İlk reaksiyon görülür.
3. LTF'de belirli bir seviyenin üzerinde/altında candle close beklenir.
4. Gerekirse ikinci bir box/level reclaim veya breakout beklenir.
5. Ancak bundan sonra bullish/bearish senaryo güçlenmiş sayılır.

Bu model iki aşamalı teyit şeklinde düşünülebilir:

- **C1 — Reaction / first confirmation**
- **C2 — Structure reclaim / second confirmation**

Dolayısıyla 'support'a değdi = long' veya 'resistance'a değdi = short' şeklinde mekanik değildir.

## 5. Breakout yaklaşımı

Range high örneklerinde Efloud'un tercih ettiği pozitif yapı:

- Range high'ın impulsive/breakout mumuyla aşılması,
- Ardından kırılan bölgenin support'a dönüşmesi,
- Bölge üzerinde acceptance/close görülmesi.

Bu nedenle botlaştırılabilir breakout şablonu:

`Range High Break -> Close Above -> Retest/Hold -> Long continuation`

Tersi short için:

`Range Low Break -> Close Below -> Retest/Reject -> Short continuation`

Fake breakout filtresi olarak yalnız wick break değil, body close ve sonrasında bölgenin rol değişimi aranmalı.

## 6. HTF → LTF ilişkisi

Arşivde LTF ifadesi 189, HTF 148 kez geçiyor. Belirli sabit timeframe'den ziyade **çoklu zaman dilimi hiyerarşisi** kullanılıyor.

Model:

- **HTF:** yön, rejim, büyük supply/demand ve major S/R.
- **LTF:** execution, confirmation, invalidation ve trade management.

Bu nedenle LTF sinyal HTF bağlamından kopuk kullanılmamalı.

## 7. Entry modeli

Efloud'a en yakın mekanik giriş modeli şu şekilde özetlenebilir.

### Long

- HTF bullish veya nötr/range bağlamı.
- Fiyat HTF/LTF demand, support veya range low'a gelir.
- Bölge tamamen kaybedilmez; reaction oluşur.
- LTF'de local resistance / trigger level üstü close veya reclaim gelir.
- Tercihen kırılan trigger retestte support olur.
- Entry tek sefer yerine parçalı olabilir.

### Short

- HTF bearish veya range-high bağlamı.
- Fiyat supply, resistance veya range high'a gelir.
- Rejection oluşur.
- LTF'de trigger support altı close / structure loss gelir.
- Tercihen kırılan seviye retestte resistance olur.
- Entry parçalı olabilir.

## 8. Invalidation / stop

Stop mantığı yalnız sabit yüzde veya ATR değildir. Temel fikir **trade fikrini geçersiz kılan yapısal nokta**dır.

Long için invalidation örnekleri:

- Demand/support box'ın body close ile kaybedilmesi,
- Reclaim edilen seviyenin tekrar altına acceptance,
- HTF yapının bozulması.

Short için tersi.

Bu, wick bazlı çok dar stop yerine 'senaryonun artık doğru olmadığı yer' mantığına yakındır.

## 9. Kâr alma ve pozisyon yönetimi

Efloud'un yaklaşımı binary all-in/all-out değil.

Tekrarlayan davranışlar:

- Desteklerde parçalı toplama.
- Dirençlerde parçalı azaltma/kâr alma.
- Margin pozisyonunun bir kısmını kapatıp spotu taşımaya devam etme.
- Büyük kazanan trade'de küçük bir 'runner' bırakma.
- Yeni pullback zone oluşursa yeniden pozisyon kurma.
- Gerektiğinde hedge kullanma.

Bu nedenle otomasyonda TP1/TP2/runner modeli Efloud tarzına tek TP'den daha yakındır.

## 10. Risk ve psikoloji filtresi

Arşivde risk/psikoloji ikinci en yoğun tema. Bu tesadüf değil; yönteminin parçası.

Özellikle:

- Art arda 3+ benzer stop = lose streak uyarısı.
- Sonuç kötü olduğunda 'trend okuması mı yanlış, metod mu yanlış?' ayrımı yapılıyor.
- Chopping zone'da sürekli işlem yapmak kötü davranış olarak görülüyor.
- Her support'ta kör alım veya her resistance'ta kör short yerine confirmation bekleniyor.

Botlaştırılırken **cooldown / regime risk reduction** eklenmeli.

Önerilen mekanik filtre:

- Aynı setup ailesinde 3 ardışık stop sonrası risk %50 azalt.
- 4. stop sonrası o setup'ı rejim değişene kadar durdur.
- Chop/range-noise skorunda trade sayısını düşür.

Bu risk kuralları Efloud'un fikirlerinden türetilmiştir; birebir ilan ettiği sabit yüzdeler değildir.

## 11. En güçlü setup ailesi

### Setup A — Support/Demand Reaction + LTF Reclaim

1. HTF zone belirle.
2. Fiyat zone'a gelsin.
3. Reaction bekle.
4. LTF trigger üstü close bekle.
5. Reclaim/hold varsa long.
6. Zone kaybı = invalidation.
7. İlk major resistance = partial TP.

### Setup B — Resistance/Supply Rejection + LTF Breakdown

Setup A'nın short simetriği.

### Setup C — Range Breakout + Role Reversal

1. Net range tespit et.
2. Range high/low body close ile kırılsın.
3. Kırılan sınır retestte yeni support/resistance olsun.
4. Hold/reject confirmation sonrası continuation trade.
5. Range içine yeniden acceptance = başarısız breakout.

### Setup D — Range Mean Reversion

Trend olmayan piyasada:

- Range low → EQ / range high hedefli long,
- Range high → EQ / range low hedefli short,
- EQ çevresinde düşük edge nedeniyle işlem seçiciliği.

## 12. Efloud modelinin formülü

En kısa haliyle:

> **Context -> Zone -> Reaction -> Confirmation -> Entry -> Structural Invalidation -> Scale-out**

ve bunun üstünde sürekli çalışan filtre:

> **Regime + Risk/Psychology**

## 13. Bot için önerilen skor sistemi

Her setup 0–10 skorlanabilir:

- HTF yön/rejim uyumu: 0–2
- Major S/R veya supply/demand confluence: 0–2
- Reaction kalitesi: 0–1
- LTF candle close confirmation: 0–2
- Retest/role reversal: 0–1
- Temiz invalidation ve en az 1:2 potansiyel: 0–1
- Chop/lose-streak filtresi temiz: 0–1

**8–10:** A setup
**6–7:** izleme / küçük risk
**0–5:** pas

Bu skor sistemi arşivden çıkarılan prensipleri mekanikleştirmek için öneridir; Efloud'un ilan ettiği resmi puan sistemi değildir.

## 14. Sonuç

Efloud'un edge'i bir indikatörden değil, **bağlam + seviye + teyit + pozisyon yönetimi** birleşiminden geliyor. En karakteristik özelliği, seviyeleri önceden haritalayıp fiyatın o seviyelerde ne yaptığına göre senaryoyu güncellemesi; kesin tepe/dip tahmini yapmak yerine reaksiyon ve confirmation takip etmesi.

Bu nedenle Efloud tarzını otomatikleştirecek sistemin 'prediction bot' değil, **scenario/confirmation engine** olarak tasarlanması daha doğru olur.