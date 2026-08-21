# Galatalı Borsacı — Kanıta Dayalı Metodoloji Kural Kitabı

Bu dosya @GalataliBorsaci arşivinden çıkarılan yöntemi operasyonel hale getirir. Amaç kişiyi taklit etmek değil, paylaşımlarda tekrar eden teknik yöntemi BIST analizlerinde yeniden üretmektir.

## 1. Veri kapsamı

- XQuik profil timeline arşivi: 638 benzersiz tweet.
- Grafik/medya içeren paylaşımlar: 569.
- Tarama cursor sonuna kadar tamamlandı (`no_next_page`).
- Metin frekansları: `formasyon` 289, `hedef düzeltmesi` 91, `formasyon tamamlandı` 73, `hedefe ulaştı` 32, `destek` 29, `uyarı` 26, `maliyet` 24, `direnç` 24, `negatif formasyon` 18, `yarasa/bat` 16, `yengeç/crab` 9, `kâr realizasyonu` 9, `kanal` 7, `stop/zarar kes` 5, `trend` 5, `gartley` 2.

## 2. Kanıtlanan yöntem omurgası — yüksek güven

1. Analizin ana nesnesi formasyondur; indikatör merkezli bir dil kullanılmaz.
2. Formasyon için bir teknik hedef önceden tanımlanır ve süreç hedef gerçekleşene kadar takip edilir.
3. Hedefe ulaşılması işlem/izleme sürecinin kritik dönüm noktasıdır: sıklıkla `formasyon tamamlandı`, `takip sona erdi`, `teknik hedef gerçekleşti` denir.
4. Hedef sonrası fiyat hareketi ayrı bir ikinci faz olarak takip edilir ve `hedef düzeltmesi` adıyla raporlanır.
5. Hedef sonrası risk artışı özellikle vurgulanır; kâr realizasyonu ve pozisyon disiplini yöntemin parçasıdır.
6. Boğa ve ayı/negatif formasyonlar birlikte kullanılır. Sistem yalnızca yükseliş formasyonu aramaz.
7. Destek/direnç, kanal ve trend yardımcı bağlamdır; formasyonun önüne geçmez.
8. `Doğru maliyet` kavramı önemlidir: formasyon ortaya çıktıktan sonra rastgele kovalamak yerine uygun maliyet bölgesinden katılım tercih edilir.
9. Uzun süreli formasyon takibi yapılabilir; örneklerde 12–18 ay ve daha uzun süreçler bulunur.
10. Hedef tamamlandıktan sonra yeni zirve kovalamak yerine risk/ödülün yeniden değerlendirilmesi gerekir.

## 3. Paylaşımlardan görülen işlem yaşam döngüsü

### Aşama A — Yapıyı bul
- Büyük salınımları ve geometrik formasyonu tanımla.
- Pozitif veya negatif yönü belirle.
- Formasyonun henüz tamamlanıp tamamlanmadığını ayır.

### Aşama B — Doğru maliyet / formasyon aktivasyonu
- Fiyat formasyonun beklenen dönüş/aktivasyon bölgesine geldiğinde takip başlar.
- Maliyetin kötüleştiği, formasyon hedefinin büyük kısmının zaten tüketildiği fiyatlarda kovalamaktan kaçın.

### Aşama C — Teknik hedef
- Formasyonun projeksiyon hedefini belirle.
- Marjı yüzde olarak ölç.
- Hedefe ulaşana kadar yapıyı bozacak bir invalidasyon oluşmadıkça formasyon takibi sürer.

### Aşama D — Formasyon tamamlandı
- Teknik hedef gerçekleştiğinde eski analiz `tamamlandı` kabul edilir.
- Bu nokta otomatik olarak yeni alım noktası değildir.
- Pozisyon disiplinine ve kâr realizasyonuna geçilir.

### Aşama E — Hedef düzeltmesi
- Hedef sonrası düzeltme ayrıca izlenir.
- Arşiv örneklerinde hedef sonrası %15, %18, %20, %25, %26, %40, %41, %55, %75, %84 gibi sert geri çekilmeler raporlanmıştır.
- Dolayısıyla hedef gerçekleşmesi sonrası `daha da gider` varsayımı yerine risk yükseltilir.

## 4. Formasyon ailesi

### Arşivde doğrudan adı geçenler — kanıtlı
- Yarasa / Bat
- Yengeç / Crab
- Gartley
- Kelebek / Butterfly
- Shark
- AB=CD
- Negatif formasyonlar

### Standart harmonik oran adayları — ORTA GÜVEN / grafiklerden teyit edilmesi gerekir
Aşağıdaki oranlar harmonik formasyonların klasik literatür oranlarıdır; Galatalı'nın her grafikte birebir bunları kullandığı henüz görsel karşılaştırmayla kanıtlanmış değildir.

- Gartley: B ≈ 0.618 XA; D ≈ 0.786 XA.
- Bat: B ≈ 0.382–0.50 XA; D ≈ 0.886 XA.
- Butterfly: B ≈ 0.786 XA; D ≈ 1.27–1.618 XA uzatma.
- Crab: B ≈ 0.382–0.618 XA; D ≈ 1.618 XA.
- AB=CD: AB ve CD bacakları yaklaşık eşit veya Fibonacci projeksiyonlu.

Bu oranlar tarayıcıda `aday formasyon` üretmek için kullanılabilir; kesin Galatalı filtresi olarak ancak grafik örneklerinden oranlar doğrulandıktan sonra kilitlenmelidir.

## 5. BIST için Galatalı-metodu analiz sırası

1. Haftalık ve günlük büyük salınımları çıkar.
2. X-A-B-C-D adaylarını üret.
3. Harmonik/geometrik adayları puanla.
4. Pozitif ve negatif formasyonları eşit şekilde tara.
5. Destek, direnç ve kanal konfluansını ekle.
6. `Doğru maliyet` bölgesini tanımla; hedefin büyük kısmı tüketilmişse yeni giriş verme.
7. Teknik hedef ve yüzde marjı hesapla.
8. Yapının bozulacağı invalidasyon seviyesini belirt.
9. Hedefe ulaşıldığında `formasyon tamamlandı` statüsüne geçir.
10. Ardından hedef düzeltmesi senaryosunu ve korunması gereken seviyeyi hesapla.

## 6. Çıktı formatı

Her BIST analizinde şu format kullanılacak:

- Hisse / zaman dilimi
- Ana yapı: pozitif / negatif
- Formasyon adayı ve güven puanı
- X-A-B-C-D noktaları
- PRZ / doğru maliyet bölgesi
- Geçersizlik seviyesi
- Teknik hedef 1 / hedef 2
- Girişten hedefe potansiyel marj
- Formasyonun durumu: oluşuyor / aktif / hedefe yakın / tamamlandı
- Hedef sonrası düzeltme riski
- Destek / direnç / kanal konfluansı
- Son karar: `Takip`, `Doğru maliyet bekle`, `Hedefe yakın-kovalama`, `Tamamlandı-kâr koru`, `Negatif formasyon aktif`

## 7. Kritik davranış filtresi

Galatalı-metodu için en önemli ek filtre: **hedefe yaklaşmış hisseyi yeni fırsat gibi sunma.**

Formasyon hedefinin yaklaşık %70–80'i tüketildiyse yeni giriş notu aşağı çekilir. Teknik hedef gerçekleşmişse sistem yeni alım yerine `tamamlandı / realizasyon / düzeltme riski` moduna geçer.

## 8. Güven düzeyleri

- Yüksek güven: formasyon-merkezli yaklaşım, hedef takibi, hedef sonrası düzeltme, maliyet/realizasyon disiplini, pozitif+negatif model kullanımı.
- Orta güven: kullanılan harmonik formasyon ailesinin klasik Fibonacci oranlarıyla uygulanması.
- Düşük/kanıtlanmamış: tek bir sabit stop yüzdesi, belirli RSI/MACD/EMA şartı veya tek zaman dilimi. Arşiv metni bunları desteklemiyor.
