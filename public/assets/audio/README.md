# Ses dosyaları

Ses motoru (`src/ui/audio.ts`) hazır ve Ayarlar ekranındaki düğmeler
çalışıyor; **eksik olan tek şey dosyalar**. Buraya doğru adla bir dosya
bırakmak yeterli — kodda değişiklik gerekmez.

Dosya yokken motor **sessizce susar**: konsol hatası, kırık istek ya da
bekleyen promise üretmez. Bir yol bir kez başarısız olursa bir daha
denenmez (her tıkta 404 üretip konsolu doldurmasın diye).

## Beklenen dosyalar

| Yol | Ne zaman çalar |
| --- | --- |
| `music/shop-ambience.mp3` | Arka planda, döngüyle |
| `sfx/tap.mp3` | Nötr bilgi geri bildirimi |
| `sfx/offer-sent.mp3` | Teklif gönderildi |
| `sfx/offer-accepted.mp3` | Olumlu sonuç (kabul, satış kapandı) |
| `sfx/offer-rejected.mp3` | Olumsuz sonuç (ret, nakit yetmedi) |
| `sfx/cash-register.mp3` | Kasa / tahsilat |
| `sfx/test-done.mp3` | Test sonucu geldi |
| `sfx/customer-arrive.mp3` | Müşteri kapıda |
| `sfx/day-end.mp3` | Gün kapanışı |
| `sfx/error.mp3` | Engellenen işlem |

## Notlar

- **Biçim:** `.mp3` (geniş destek). Başka biçim kullanılacaksa
  `src/ui/audio.ts` içindeki `SFX` tablosundaki yollar güncellenir.
- **Efektler kısa olmalı** (< 1 sn). Uzun efekt art arda işlemde birikir.
- **Müzik döngüye uygun kesilmeli** — başı ve sonu duyulur biçimde
  eşleşmezse döngü her turda tık sesi verir.
- **Ses seviyesi dosyada normalize edilmeli.** Oyuncunun seviye kaydırıcısı
  bunun üstüne çarpan olarak biner; dosyalar arası seviye farkı kaydırıcıyla
  düzeltilemez.
