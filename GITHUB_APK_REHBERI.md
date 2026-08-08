# GitHub'da Otomatik APK Derleme — Kurulum

Bu projeye `.github/workflows/android-apk.yml` adında bir "GitHub Actions"
dosyası eklendi. Bu sayede kodu GitHub'a her push ettiğinde, GitHub'ın kendi
sunucularında otomatik olarak APK derlenir — bilgisayarında Android Studio
kurmana gerek kalmaz.

**Önemli:** Sadece dosyayı repoya koymak yetmiyor, bir kereye mahsus
Firebase bilgilerini GitHub'a "Secret" olarak tanıtman gerekiyor (çünkü
`.env` dosyası güvenlik için repoya yüklenmiyor, `.gitignore` içinde).

## Adım Adım Kurulum

### 1. Projeyi GitHub'a yükle
Eğer henüz yüklemediysen: yeni bir repo oluştur, bu klasördeki tüm dosyaları
(özellikle `.github` klasörünü) o repoya push et.

### 2. Firebase bilgilerini Secret olarak ekle
GitHub'da reponun içinde:

`Settings` → sol menüde `Secrets and variables` → `Actions` → `New repository secret`

Aşağıdaki 7 secret'ı tek tek ekle (isimler birebir aynı olmalı, değerleri
kendi `.env` dosyandan kopyala):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

### 3. Derlemeyi çalıştır
Secret'ları ekledikten sonra `main` dalına bir push yap (veya reponun
`Actions` sekmesine gidip `Android APK Otomatik Derleme` iş akışını seçip
`Run workflow` butonuna bas).

### 4. APK'yı indir
Derleme bitince (birkaç dakika sürer), `Actions` sekmesinde ilgili çalıştırmayı
aç, en altta **Artifacts** bölümünde `anka-art-debug-apk` dosyasını
indirebilirsin. İçinden çıkan `app-debug.apk` dosyasını telefonuna atıp
kurabilirsin (Ayarlar'dan "bilinmeyen kaynaklardan yükleme" izni gerekebilir).

## Bunun sınırları

- Bu **debug APK**'dır — test/kendi telefonuna kurmak için sorunsuz çalışır,
  ama Google Play Store'a yüklenemez.
- Play Store'a yayınlamak için "release" APK/AAB gerekiyor; bu da bir
  imzalama anahtarı (keystore) oluşturup GitHub Secrets'a eklemeyi
  gerektirir. İstersen bunu da birlikte kurabiliriz.
- Workflow her çalıştığında `android` klasörü yoksa otomatik oluşturuyor
  (`npx cap add android`). İleride uygulama ikonu, splash screen gibi native
  özelleştirmeler yapmak istersen, `android` klasörünü bir kere oluşturup
  repoya commit etmen (ve workflow'daki otomatik-oluşturma adımını
  kaldırman) daha sağlıklı olur.
