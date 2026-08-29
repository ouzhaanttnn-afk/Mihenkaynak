/**
 * AYARLARIN KALICILIĞI — kendi deposu, kendi anahtarı.
 *
 * NEDEN KAYIT DOSYASINDAN AYRI:
 * Ayarlar cihaza aittir, kayda değil. `mihenkaynak.save.v1` içine konsaydı
 * "Yeni oyun" sesi tekrar açar, kaydı silmek dili sıfırlar, iki farklı kayıt
 * iki farklı dilde açılırdı. Ayrı anahtar bu üçünü birden çözer:
 * `resetGame` ayarlara DOKUNMAZ.
 *
 * TEST ORTAMI 'node': `localStorage` YOKTUR (bkz. vite.config.ts). Her erişim
 * try/catch içinde ve okuma başarısızlıkta varsayılana düşer — save.ts ile
 * aynı kalıp. Depoya yazamamak oyunu durdurmaz; yalnız tercih o oturumda
 * kalır.
 */

import { DEFAULT_SETTINGS, normalizeSettings, type GameSettings } from '@domain/settings';

const STORAGE_KEY = 'mihenkaynak.settings.v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    // Bozuk JSON, kapalı depo, gizli sekme: hepsi aynı güvenli sonuca çıkar.
    return DEFAULT_SETTINGS;
  }
}

/** @returns yazılabildiyse true. Çağıran taraf isterse oyuncuyu uyarır. */
export function persistSettings(settings: GameSettings): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
