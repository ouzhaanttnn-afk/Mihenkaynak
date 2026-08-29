/**
 * ARAYÜZ DİLİ.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * KAPSAM — ÖLÇÜLEREK ÇİZİLDİ
 *
 * Projede 1547 Türkçe metin var ve 964'ü `src/domain` içinde: müşteri
 * cümleleri, ders metinleri, gerekçe satırları. Bunlar sabit dize değil,
 * DİLBİLGİSİYLE ÜRETİLEN cümlelerdir ("20 gram 22 ayar işçiliksiz bilezik
 * almak istiyorum" — sayı sıfatı, ek uyumu, "bir" kuralı). Onları taşımak
 * ayrı bir iştir ve bu katman onu ÜSTLENMEZ.
 *
 * Bu dosyanın kapsamı ARAYÜZ metinleridir: ekran başlıkları, düğme
 * etiketleri, alan adları, boş durum yazıları.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN VARSAYILAN METİN ÇAĞRI YERİNDE
 *
 *     t('nav.shop', 'Dükkan')
 *
 * Türkçe metin anahtarın YANINDA durur. Üç şey birden kazanılır:
 *
 *   1. GEÇİŞ KIRIK ARA DURUM ÜRETMEZ. 356 metni tek seferde taşımak zorunlu
 *      değil; taşınmamış her çağrı Türkçesini göstermeye devam eder.
 *   2. ANAHTAR KAYBOLURSA EKRAN BOŞALMAZ. Sözlükte olmayan anahtar sessizce
 *      varsayılana düşer — oyuncu 'nav.shop' gibi bir kimlik görmez.
 *   3. KOD OKUNUR KALIR. `t('dock.endDay')` okuyan biri ne yazdığını
 *      bilemez; `t('dock.endDay', 'Günü Bitir')` bilir.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Locale } from '@domain/settings';

/**
 * İngilizce sözlük. Türkçe için giriş YOKTUR ve olmamalıdır — Türkçe metin
 * zaten çağrı yerindeki varsayılandır. İki yerde tutmak, birinin diğerinden
 * sapmasına izin vermek olurdu.
 */
const EN: Record<string, string> = {
  // --- Navigasyon ---
  'nav.shop': 'Shop',
  'nav.stock': 'Stock',
  'nav.workshop': 'Workshop',
  'nav.market': 'Market',
  'nav.business': 'Business',

  // --- Durum şeridi ---
  'strip.day': 'Day',
  'strip.cash': 'Cash',
  'strip.speed': 'Game speed',
  'strip.editProfile': 'Edit profile',

  // --- Ayarlar ---
  'settings.title': 'Settings',
  'settings.subtitle': 'Sound, haptics and language',
  'settings.audio': 'Sound',
  'settings.music': 'Music',
  'settings.musicVolume': 'Music volume',
  'settings.sfx': 'Sound effects',
  'settings.sfxVolume': 'Effects volume',
  'settings.haptics': 'Vibration',
  'settings.hapticsNote': 'Short feedback on offers and results.',
  'settings.hapticsUnsupported': 'This device does not support vibration.',
  'settings.language': 'Language',
  'settings.languageNote':
    'Interface texts only. Customer dialogue and lessons stay in Turkish for now.',
  'settings.audioPending':
    'Sound files have not been added yet, so the game is silent. These switches are already saved and will take effect as soon as the files land.',
  'settings.back': 'Back',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.storageFailed': 'Settings could not be saved on this device.',

  // --- Ortak ---
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
};

const DICTIONARIES: Record<Locale, Record<string, string>> = {
  tr: {},
  en: EN,
};

let active: Locale = 'tr';

/** Etkin dili değiştirir. Bileşenler yeniden çizildiğinde yeni dili okur. */
export function setLocale(locale: Locale): void {
  active = locale;
}

export function getLocale(): Locale {
  return active;
}

/**
 * Çeviri. Anahtar etkin dilde yoksa Türkçe varsayılana düşer.
 *
 * @param key       Nokta ile ayrılmış kimlik ('settings.music').
 * @param turkish   Türkçe metin — aynı zamanda son çare karşılık.
 */
export function t(key: string, turkish: string): string {
  return DICTIONARIES[active][key] ?? turkish;
}

/** Test ve denetim için: bir dilde eksik olan anahtarları listeler. */
export function missingKeys(locale: Locale, keys: readonly string[]): string[] {
  const dict = DICTIONARIES[locale];
  return keys.filter((k) => !(k in dict));
}

/** Sözlükteki tüm anahtarlar — denetim testi bunu kullanır. */
export function localeKeys(locale: Locale): string[] {
  return Object.keys(DICTIONARIES[locale]);
}
