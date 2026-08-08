# Firestore Güvenlik Kuralları — Kurulum Rehberi

Uygulama artık **gerçek Firebase Authentication** kullanıyor: kayıt ve giriş
e-posta + şifre ile yapılıyor, kayıt sırasında otomatik olarak bir doğrulama
maili gönderiliyor ve e-postasını doğrulamamış kullanıcılar giriş yapamıyor.

Bu sayede Firestore artık `request.auth.uid` ile "bu kaydı sadece sahibi
değiştirebilir" gibi gerçek ve sıkı kurallar yazabiliyoruz — önceki
sürümdeki (anonim oturum + kendi şifre sistemi) açık artık yok.

## Nasıl uygulanır

1. https://console.firebase.google.com → projenin (anka-art-studio) içine gir.
2. Sol menüden **Build > Authentication** → **Sign-in method** sekmesine git,
   **Email/Password** sağlayıcısını etkinleştir (henüz açık değilse).
3. Sol menüden **Build > Firestore Database** → **Rules** sekmesine git.
4. Aşağıdaki kuralları yapıştır, **Publish** butonuna bas.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Kullanıcı profili (nickname, profil resmi). Belge ID'si = Firebase Auth uid.
    match /artifacts/{appId}/public/data/users/{userId} {
      // Giriş yapmış herkes profilleri okuyabilir (gerekirse burayı da sıkılaştırabiliriz)
      allow read: if request.auth != null;
      // Sadece kendi uid'siyle eşleşen belgeyi oluşturabilir
      allow create: if request.auth != null && request.auth.uid == userId;
      // Sadece kendi profilini güncelleyebilir/silebilir
      allow update, delete: if request.auth != null && request.auth.uid == userId;
    }

    // Projeler: owner alanı = Firebase Auth uid
    match /artifacts/{appId}/public/data/projects/{projectId} {
      allow read: if request.auth != null && resource.data.owner == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.owner == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.owner == request.auth.uid;
    }

    // Başka hiçbir yola erişim yok
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Ne değişti?

- Kayıt/giriş artık kullanıcı adı değil **e-posta** ile yapılıyor.
- Kayıt sonrası Firebase otomatik olarak bir **doğrulama e-postası** gönderiyor;
  kullanıcı bağlantıya tıklamadan giriş yapamıyor.
- "Şifremi unuttum" akışı da Firebase'in kendi şifre sıfırlama e-postasını
  kullanıyor (`sendPasswordResetEmail`).
- Şifre değiştirme ve hesap silme işlemleri artık güvenlik gereği
  **mevcut şifre ile yeniden kimlik doğrulama** (`reauthenticateWithCredential`)
  istiyor — bu, Firebase'in `auth/requires-recent-login` kısıtlamasından
  kaynaklanıyor.
- `dbUsers` koleksiyon dinleme (tüm kullanıcı listesi) kaldırıldı; artık her
  istemci sadece **kendi** profil belgesini dinliyor (`users/{uid}`).
  Bu hem daha güvenli hem de daha az veri çekiyor.
- Proje sahipliği (`owner` alanı) artık kullanıcı adı yerine **Firebase Auth
  uid** olarak tutuluyor, çünkü e-posta gibi değişebilen/gizli bir bilgi
  yerine sabit ve güvenilir bir kimlik gerekiyordu.

## Önemli not: Authorized domains

E-posta doğrulama ve şifre sıfırlama bağlantılarının çalışması için,
uygulamanın açılacağı alan adının (ör. `localhost`, yayın domaininiz veya
Capacitor için `anka-art-studio.firebaseapp.com`) Firebase Console'da
**Authentication > Settings > Authorized domains** listesinde olması
gerekir. Varsayılan olarak `localhost` ve `<projectId>.firebaseapp.com`
zaten eklidir.
