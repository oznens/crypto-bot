# Efloud Research

@Efloud hesabının son 1 yıllık X paylaşımlarını Xquik üzerinden arşivlemek, tweetlerdeki grafik/görselleri indirmek ve kullanılan trading yaklaşımını sistematik biçimde çıkarmak için hazırlanmış çalışma alanı.

## Kapsam

- Tarih aralığı: 2025-08-17 → 2026-08-17
- Kaynak: Xquik `GET /api/v1/x/tweets/search`
- Sorgu: `from:Efloud`
- Tweet metni, tarih, etkileşim metrikleri, tweet URL'si ve medya metadata'sı saklanır.
- Görsel/video URL'leri `media/` altına indirilir.
- `analyze.py` içerikleri konu, piyasa, zaman dilimi ve price-action kavramlarına göre etiketler.

## Güvenlik

Xquik API anahtarını repoya yazmayın. Yerelde `XQUIK_API_KEY` ortam değişkeni veya GitHub Actions Secret olarak kullanın.

## Çalıştırma

```bash
cd efloud-research
python -m pip install -r requirements.txt
export XQUIK_API_KEY="..."
python fetch_xquik.py
python analyze.py
```

Windows PowerShell:

```powershell
$env:XQUIK_API_KEY="..."
python fetch_xquik.py
python analyze.py
```

Çıktılar:

- `data/tweets.jsonl`: ham tweet arşivi
- `data/tweets.csv`: analiz için tablo
- `media/`: tweet görselleri/videoları
- `analysis/report.md`: özet yaklaşım raporu
- `analysis/concepts.csv`: tweet bazlı etiketler

## Not

Bu klasör yalnızca araştırma/eğitim amaçlıdır; üretilen analiz yatırım tavsiyesi değildir.
