/*
 * test_mexc.js — MEXC API yetenek testi (KRİTİK İLK ADIM).
 * MEXC, vadeli (futures) emir API'sini çoğu hesapta kapalı tutar — bu script senin hesabında açık mı test eder.
 * GERÇEK EMİR AÇMAZ: kasıtlı olarak minimum altı miktarla emir dener; borsanın verdiği HATA KODUNDAN yeteneği anlar.
 * Çalıştır: node test_mexc.js   (.env içinde MEXC_KEY / MEXC_SECRET dolu olmalı)
 */
require('dotenv').config();
const ccxt = require('ccxt');

(async () => {
  if (!process.env.MEXC_KEY || !process.env.MEXC_SECRET) {
    console.log('❌ .env içinde MEXC_KEY / MEXC_SECRET yok. nano .env ile doldur.');
    process.exit(1);
  }
  const ex = new ccxt.mexc({ apiKey: process.env.MEXC_KEY, secret: process.env.MEXC_SECRET, options: { defaultType: 'swap' }, enableRateLimit: true });
  console.log('1) Marketler yükleniyor...');
  await ex.loadMarkets();
  const swaps = Object.values(ex.markets).filter(m => m.swap && m.quote === 'USDT').length;
  console.log('   ✓ swap market sayısı:', swaps);

  console.log('2) Vadeli (swap) bakiye okunuyor...');
  try {
    const b = await ex.fetchBalance();
    console.log('   ✓ USDT vadeli bakiye:', (b.USDT && (b.USDT.total ?? b.USDT.free)) ?? 0);
  } catch (e) { console.log('   ❌ bakiye okunamadı:', e.constructor.name, '-', e.message.slice(0, 140)); }

  console.log('3) VADELİ EMİR YETKİSİ testi (min altı miktar — dolmaz, hata kodundan anlaşılır)...');
  try {
    await ex.createOrder('BTC/USDT:USDT', 'market', 'buy', 0.000001);
    console.log('   ⚠ Emir KABUL edildi?! (beklenmedik — pozisyonları kontrol et)');
  } catch (e) {
    const m = (e.message || '').toLowerCase();
    if (/maintenance|not.*(support|available)|forbidden|permission|prohibit|无权|暂不/.test(m) || e.constructor.name === 'PermissionDenied' || e.constructor.name === 'NotSupported')
      console.log('   ❌ VADELİ EMİR KAPALI görünüyor → mesaj:', e.message.slice(0, 160), '\n   Seçenekler: MEXC spot (long-only) ya da perp API açık borsa. Bana bu çıktıyı gönder.');
    else if (/amount|volume|min|size|precision|insufficient|balance|margin/.test(m))
      console.log('   ✅ VADELİ EMİR AÇIK görünüyor (miktar/bakiye hatası döndü = endpoint çalışıyor) → mesaj:', e.message.slice(0, 160));
    else
      console.log('   ❓ Belirsiz:', e.constructor.name, '-', e.message.slice(0, 200), '\n   Bana bu çıktıyı gönder, yorumlayayım.');
  }

  console.log('\n4) Spot emir yetkisi (yedek plan) testi...');
  try {
    const sp = new ccxt.mexc({ apiKey: process.env.MEXC_KEY, secret: process.env.MEXC_SECRET, enableRateLimit: true });
    await sp.loadMarkets();
    await sp.createOrder('BTC/USDT', 'limit', 'buy', 0.000001, 1);
    console.log('   ⚠ spot emir kabul edildi?! iptal etmeyi unutma');
  } catch (e) {
    const m = (e.message || '').toLowerCase();
    if (/amount|volume|min|notional|size|precision|insufficient|balance/.test(m)) console.log('   ✅ SPOT EMİR AÇIK (miktar hatası döndü) →', e.message.slice(0, 120));
    else console.log('   sonuç:', e.constructor.name, '-', e.message.slice(0, 160));
  }
  console.log('\nBitti. Bu çıktının tamamını kopyala → sohbete yapıştır.');
})().catch(e => console.log('GENEL HATA:', e.constructor.name, '-', e.message));
