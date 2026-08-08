// src/utils/nativeSave.js
// Web'de (tarayıcıda) klasik <a download> linki çalışır ama Capacitor ile
// paketlenmiş Android uygulamasında (APK) bu yöntem cihaza dosya indirmez.
// Görseller artık "Paylaş" ekranı açılmadan DOĞRUDAN telefonun galerisine
// kaydediliyor (@capacitor-community/media). Sadece bu başarısız olursa
// (ör. izin reddedilirse) son çare olarak eski paylaşım ekranına düşüyoruz.

import { Capacitor } from '@capacitor/core';

let _fsModule = null;
let _shareModule = null;
let _mediaModule = null;

const loadFsShare = async () => {
  if (!_fsModule) _fsModule = await import('@capacitor/filesystem');
  if (!_shareModule) _shareModule = await import('@capacitor/share');
  return { ..._fsModule, ..._shareModule };
};

const loadMedia = async () => {
  if (!_mediaModule) _mediaModule = await import('@capacitor-community/media');
  return _mediaModule;
};

const ALBUM_NAME = 'Anka art';
let _albumIdentifierCache = null;

// Android'de savePhoto() artık bir albumIdentifier ZORUNLU istiyor (plugin'in
// güncel sürümünde bu alan artık opsiyonel değil — vermezsen "Album identifier
// required" hatasıyla HER ZAMAN başarısız olur ve kod her seferinde son çare
// olan Paylaş ekranına düşer). Bu yüzden önce kendi albümümüzün kimliğini
// buluyoruz/oluşturuyoruz ve sonucu önbelleğe alıyoruz (her indirmede tekrar
// tekrar sormaya gerek yok).
const ensureAlbumIdentifier = async (Media) => {
  if (_albumIdentifierCache) return _albumIdentifierCache;

  // Android'de albüm kimliği doğrudan klasör yoludur (getAlbumsPath() + isim).
  if (Media.getAlbumsPath) {
    try {
      const { path } = await Media.getAlbumsPath();
      const identifier = `${path}/${ALBUM_NAME}`;
      // Albüm zaten var olabilir — "already exists" hatasını yoksay.
      try {
        await Media.createAlbum({ name: ALBUM_NAME });
      } catch (createErr) {
        const msg = String((createErr && createErr.message) || createErr || '').toLowerCase();
        if (!msg.includes('already exists') && !msg.includes('exist')) {
          console.error('Albüm oluşturma hatası (yoksayılıyor):', createErr);
        }
      }
      _albumIdentifierCache = identifier;
      return identifier;
    } catch (err) {
      console.error('Albüm yolu alınamadı:', err);
    }
  }

  // iOS veya getAlbumsPath yoksa: getAlbums() ile ara, yoksa oluştur.
  try {
    const { albums } = await Media.getAlbums();
    const existing = albums && albums.find(a => a.name === ALBUM_NAME);
    if (existing) {
      _albumIdentifierCache = existing.identifier;
      return existing.identifier;
    }
    await Media.createAlbum({ name: ALBUM_NAME });
    const { albums: albums2 } = await Media.getAlbums();
    const created = albums2 && albums2.find(a => a.name === ALBUM_NAME);
    if (created) {
      _albumIdentifierCache = created.identifier;
      return created.identifier;
    }
  } catch (err) {
    console.error('Albüm bulma/oluşturma hatası:', err);
  }

  return null;
};

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// dataUrl: "data:image/png;base64,...." formatında bir string
export async function saveDataUrlToDevice(dataUrl, filename) {
  if (isNative()) {
    const { Filesystem, Directory } = await loadFsShare();
    const base64Data = dataUrl.split(',')[1];

    // Önce geçici (cache) alana yaz — hem galeriye kaydetmek hem de
    // (gerekirse) paylaşmak için buradan okunacak.
    let written;
    try {
      written = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
      });
    } catch (err) {
      console.error('Geçici dosya yazma hatası:', err);
      throw err;
    }

    // Galeriye doğrudan kaydetmeyi dene (paylaşım ekranı AÇILMAZ).
    try {
      const { Media } = await loadMedia();

      // İzin durumunu ÖNCE kontrol et, sadece gerekliyse iste. Bazı
      // cihazlarda requestPermissions() sonucunu kontrol etmeden direkt
      // savePhoto'ya geçmek, izin reddedilmişse (veya diyalog hiç
      // gösterilmemişse) sessizce başarısız olup her seferinde Paylaş
      // ekranına düşülmesine sebep oluyordu. Şimdi durumu açıkça
      // okuyup, gerekiyorsa istiyoruz ve sonucu doğruluyoruz.
      let permStatus = null;
      try {
        if (Media.checkPermissions) permStatus = await Media.checkPermissions();
        console.log('Medya izin durumu:', JSON.stringify(permStatus));
      } catch { /* plugin bu metodu desteklemiyor olabilir, yoksay */ }

      const isGranted = (status) => {
        if (!status) return null; // bilinmiyor
        // Eklenti Android sürümüne göre farklı izin takma adları (alias)
        // kullanıyor: eski Android'lerde "publicStorage", Android 13+'ta
        // ise "publicStorage13Plus". Sadece birini kontrol etmek, diğer
        // alanda gerçekten verilmiş bir izni "reddedilmiş" sanmamıza yol
        // açıyordu (Android 13+ cihazlarda tam olarak bu oluyordu).
        // Herhangi biri "granted" ise izin var demektir.
        const candidates = [
          status.publicStorage13Plus,
          status.publicStorage,
          status.photos,
          status.granted,
          status.status
        ];
        return candidates.some(val => val === 'granted' || val === true);
      };

      if (isGranted(permStatus) !== true && Media.requestPermissions) {
        try {
          permStatus = await Media.requestPermissions();
        } catch (permErr) {
          console.error('İzin isteme hatası:', permErr);
        }
      }

      if (isGranted(permStatus) === false) {
        // Kullanıcı izni reddetmiş — Paylaş ekranına düşmek yerine
        // durumu açıkça bildir ki kullanıcı Ayarlar'dan izni açabilsin.
        return {
          ok: false,
          native: true,
          gallery: false,
          permissionDenied: true,
          galleryErrorReason: 'Fotoğraflar/Medya izni verilmedi'
        };
      }

      // Not: Android'de albumIdentifier ZORUNLU (bkz. ensureAlbumIdentifier
      // yorumu) — vermeden savePhoto çağırmak her zaman başarısız olurdu.
      const albumIdentifier = await ensureAlbumIdentifier(Media);
      await Media.savePhoto({ path: written.uri, fileName: filename, albumIdentifier });
      return { ok: true, native: true, gallery: true };
    } catch (mediaErr) {
      const reason = (mediaErr && (mediaErr.message || String(mediaErr))) || 'bilinmeyen hata';
      console.error('Galeriye kaydetme hatası, paylaşım ekranına düşülüyor:', mediaErr);
      // Son çare: eski paylaşım ekranı
      try {
        const { Share } = await loadFsShare();
        await Share.share({
          title: filename,
          url: written.uri,
          dialogTitle: 'Görseli Kaydet veya Paylaş',
        });
        return { ok: true, native: true, gallery: false, galleryErrorReason: reason };
      } catch (shareErr) {
        if (shareErr && String(shareErr.message || '').toLowerCase().includes('cancel')) {
          return { ok: false, cancelled: true };
        }
        throw shareErr;
      }
    }
  }

  // --- Web / tarayıcı davranışı (değişmedi) ---
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { ok: true, native: false };
}

// text: düz metin/JSON içeriği
export async function saveTextToDevice(text, filename, mimeType = 'application/json') {
  if (isNative()) {
    try {
      const { Filesystem, Directory, Encoding, Share } = await loadFsShare();

      const result = await Filesystem.writeFile({
        path: filename,
        data: text,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });

      await Share.share({
        title: filename,
        url: result.uri,
        dialogTitle: 'Proje Dosyasını Kaydet veya Paylaş',
      });
      return { ok: true, native: true };
    } catch (err) {
      if (err && String(err.message || '').toLowerCase().includes('cancel')) {
        return { ok: false, cancelled: true };
      }
      console.error('Native kaydetme hatası:', err);
      throw err;
    }
  }

  // --- Web / tarayıcı davranışı (değişmedi) ---
  const dataStr = `data:${mimeType};charset=utf-8,` + encodeURIComponent(text);
  const link = document.createElement('a');
  link.setAttribute('href', dataStr);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { ok: true, native: false };
}

// Bir kaynak canvas'ı hedef boyuta (örn. 64x64) piksel-sanatı bozmadan
// (nearest-neighbor / keskin kenar) yeniden boyutlandırır.
// NOT: Bu, gerçek piksel-grid verisini (mainCanvas) BÜYÜTMEK için uygundur
// (hedef boyut kaynaktan büyük/eşitse) çünkü sonuç net, blok blok piksellerdir.
// KÜÇÜLTMEK için KULLANMAYIN — bkz. resizeCanvasBoxDownsample.
export function resizeCanvasSharp(sourceCanvas, targetSize) {
  const out = document.createElement('canvas');
  out.width = targetSize;
  out.height = targetSize;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, 0, 0, targetSize, targetSize);
  return out;
}

// Bir kaynak canvas'ı (piksel-grid katmanı dahil) hedef boyuta KÜÇÜLTÜRKEN
// kullanılır. imageSmoothingEnabled=false ile küçültme yapmak tarayıcıda
// TEK NOKTA örnekleme (nearest-neighbor minification) demektir: her hedef
// piksel için kaynaktan rastgele/gürültülü TEK bir piksel seçilir, komşu
// pikseller tamamen atlanır. Kaynakta ufak piksel-piksel varyasyon
// (fotoğraftan pikselleştirilmiş sanat, ince doku, vs.) varsa bu durum
// tam olarak "TV parazit" gibi noktalı/gürültülü bir görünüme yol açar —
// export sırasında (özellikle 64x64/128x128 gibi küçük boyutlarda) fark
// edilen kalite kaybının sebebi budur.
// Bunun yerine her hedef piksel için kaynaktaki karşılık gelen dikdörtgen
// bölgenin GERÇEK (alfa-ağırlıklı) renk ortalamasını alan klasik bir
// "box filter" kullanıyoruz. Bu hem gürültüyü ortadan kaldırır hem de
// kenarlarda doğru/yumuşak bir sonuç verir.
export function resizeCanvasBoxDownsample(sourceCanvas, targetSize) {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;

  if (targetSize >= srcW && targetSize >= srcH) {
    // Küçültme değil, büyütme/eşit durum — keskin nearest-neighbor yeterli.
    return resizeCanvasSharp(sourceCanvas, targetSize);
  }

  const srcCtx = sourceCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const out = document.createElement('canvas');
  out.width = targetSize;
  out.height = targetSize;
  const outCtx = out.getContext('2d');
  const outImageData = outCtx.createImageData(targetSize, targetSize);

  for (let ty = 0; ty < targetSize; ty++) {
    const sy0 = Math.floor((ty / targetSize) * srcH);
    const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) / targetSize) * srcH));
    for (let tx = 0; tx < targetSize; tx++) {
      const sx0 = Math.floor((tx / targetSize) * srcW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) / targetSize) * srcW));

      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        let idx = (sy * srcW + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx++) {
          const a = srcData[idx + 3];
          rSum += srcData[idx] * a;
          gSum += srcData[idx + 1] * a;
          bSum += srcData[idx + 2] * a;
          aSum += a;
          count++;
          idx += 4;
        }
      }

      const outIdx = (ty * targetSize + tx) * 4;
      if (aSum > 0) {
        outImageData.data[outIdx] = Math.round(rSum / aSum);
        outImageData.data[outIdx + 1] = Math.round(gSum / aSum);
        outImageData.data[outIdx + 2] = Math.round(bSum / aSum);
        outImageData.data[outIdx + 3] = Math.round(aSum / count);
      }
    }
  }

  outCtx.putImageData(outImageData, 0, 0);
  return out;
}

// Kaynak canvas'ı (özellikle HD/serbest çizim katmanını) BÜYÜK ORANDA
// küçültürken (ör. 1080 -> 64, yani ~16.9x küçültme) tek adımda yapılan
// tarayıcı ölçeklendirmesi ciddi kalite kaybına ve "moiré" (girişim deseni)
// bozulmasına yol açar. Bunu önlemek için boyutu her adımda yarıya
// indirerek (mipmap mantığı) hedef boyuta kademeli ve yüksek kalitede
// yaklaşıyoruz. 64x64 / 128x128 gibi küçük boyutlarda net, kaliteli sonuç
// için bu fonksiyon kullanılmalı (resizeCanvasSharp DEĞİL).
export function resizeCanvasSmooth(sourceCanvas, targetSize) {
  let current = sourceCanvas;
  let currentSize = current.width;

  while (currentSize / 2 > targetSize) {
    const nextSize = Math.max(targetSize, Math.floor(currentSize / 2));
    const stepCanvas = document.createElement('canvas');
    stepCanvas.width = nextSize;
    stepCanvas.height = nextSize;
    const stepCtx = stepCanvas.getContext('2d');
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(current, 0, 0, nextSize, nextSize);
    current = stepCanvas;
    currentSize = nextSize;
  }

  if (currentSize === targetSize) return current;

  const out = document.createElement('canvas');
  out.width = targetSize;
  out.height = targetSize;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, targetSize, targetSize);
  return out;
}
