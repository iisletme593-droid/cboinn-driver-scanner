# Cboinn Driver Scanner v4.6.1

## 🆕 Yenilikler
- **🌍 3 yeni dil:** Almanca, Rusça ve **Arapça** eklendi (artık toplam 5 dil: Türkçe · English · Deutsch · Русский · العربية). Arapça otomatik **sağdan-sola (RTL)** düzenle gelir. Ayarlar → Dil'den seçilir.
- **🚀 Tek Tık Optimizasyon:** Tek tıkla tam tarama + **güvenli temizlik** (geçici dosyalar ve önbellekler; Geri Dönüşüm Kutusu hariç) + sağlık kontrolü. İşlem bitince masaüstü bildirimi gönderir.
- **📊 Zenginleştirilmiş rapor:** "Rapor Oluştur" artık raporu **seçili dilde** üretir; **Sistem Sağlık Skoru** ve **sağlık trendi grafiği** ekler, yazdırma dostudur (Arapça'da RTL).
- **🔔 Bildirimler:** Uzun süren işlemler (optimizasyon) tamamlanınca masaüstü bildirimi (Ayarlar'dan açık/kapalı).

## 🐛 Düzeltmeler
- **Önyüklenebilir USB:** Kopyalama veya bölme başarısız olursa artık yanlışlıkla "hazır" denmiyor — `robocopy`/`DISM` çıkış kodları doğrulanıyor (bozuk USB'yi başarılı sanma sorunu giderildi).
- **Çıkışta temizlik:** Uygulama kapanınca arka planda kalan motor süreçleri (ve `winget`/`pnputil` alt süreçleri) düzgün sonlandırılıyor — artık orphan süreç kalmıyor.
- **Daha sağlam motor durumu:** Durum dosyası yazımı her koşulda tamamlanıyor; "motor beklenmedik biçimde kapandı / gereksiz bekleme" durumları azaldı.
- **Tarama yarış durumu:** Zamanlanmış arka plan taraması artık ön plandaki taze sonuçları eski veriyle ezmiyor.
- **Daha dayanıklı arayüz:** Bozuk/eksik tarama verisinde paneller artık çökmüyor (savunmacı korumalar).
- **Türkçe hata mesajları:** Konsol UTF-8 kodlamasıyla artık bozuk (mojibake) görünmüyor.
- Çeşitli küçük UI düzeltmeleri: üst üste gelen bildirim zamanlayıcıları, çevrilmemiş tek bir metin, geçersiz işlem modu doğrulaması.

---
**Kurulum:** `Cboinn-Driver-Scanner-Setup-4.6.1.exe` dosyasını indirip çalıştırın. Mevcut kurulum otomatik güncellenir (yönetici gerekmez).
SHA256: `f24fa7c12c985c7849936f7b28fcadd9cc8616e1ef6a46cea61aee6d75d95e9e`
