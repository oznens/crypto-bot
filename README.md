# SMC Kripto Botu — yigitalagozoglu stili

Telegram kanalındaki trader stilini (SMC/ICT: likidite, FVG, order block, market yapısı,
equilibrium + RSI) otomatik uygulayan, **web panelli** kripto analiz botu. MEXC verisi.
Onun bej TradingView temasında grafik çizer; Long/Short + Giriş/SL/TP üretir.

## Çalıştırma
Gereksinim: yalnızca **Node.js** (npm install YOK — sıfır bağımlılık).

```
node server.js
```
veya Windows'ta `start.bat` dosyasına çift tıkla.
Sonra tarayıcıda aç: **http://localhost:5188**

## Ne yapar
- **Otomatik tarama:** MEXC'de hacme göre top sembolleri seçilen zaman diliminde sürekli tarar (60sn),
  yeterli confluence olan Long/Short setupları bulur ve **A+/A/B** notuyla listeler. Yeni A+/A çıkınca 🔔 alarm.
- **Grafik:** Seçtiğin setupun mumlarını + çizimlerini onun stilinde gösterir:
  - Eşit tepe/dip = **mavi kesikli** likidite (BSL/SSL)
  - **FVG** ve **order block** kutuları
  - **EQ / fib** (0 / 0,5 / 1) — premium/discount
  - **Giriş / SL / TP** bölgeleri ve etiketleri
- **Setup paneli:** Giriş, Stop, TP1-3, R/R, risk %, ve gerekçe (hangi confluence'lar).

## Mantık (trader stili)
Bot sadece yeterli **confluence** varken sinyal verir, aksi halde *izleme modu*:
indirim/premium bölge + likidite süpürmesi (manipülasyon) + FVG/OB teması + yapı (BOS/CHoCH) + RSI.
"Likiditeden likiditeye" hedefleme: TP'ler EQ → karşı likidite → ana tepe/dip.

## Dosyalar
- `server.js` — Node sunucu, MEXC proxy, tarama (stdlib, bağımlılık yok)
- `analysis.js` — SMC analiz motoru
- `public/` — web paneli (`index.html`, `style.css`, `app.js`, `chart.js`)

## Ayarlar
- Port: `PORT` ortam değişkeni (varsayılan 5188).
- Veri kaynağı MEXC spot. (MEXC futures API bölgesel olarak engelli olduğundan spot kullanılır.)

## ⚠️ Uyarı
Bu araç **algoritmik SMC örüntü tespitidir, yatırım tavsiyesi değildir.** İnsan trader'ın
takdiri/sezgisi taklit edilemez; bot yalnızca aynı *çerçeveyi* (SMC/ICT) otomatik uygular.
Kararların ve risk yönetiminin sorumluluğu sana aittir.
