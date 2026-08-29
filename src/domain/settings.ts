/**
 * OYUNCU AYARLARI — cihaz tercihi, oyun durumu DEĞİL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * KAPSAM SINIRI — profile.ts ile aynı ilkeyle dar tutulmuştur.
 *
 * Buradaki hiçbir ayar oyunu KOLAYLAŞTIRMAZ veya ZORLAŞTIRMAZ. Ses kapalı
 * oynayan oyuncu daha ucuza almaz, titreşimi açan daha iyi test yapmaz,
 * dil değiştiren farklı bir müşteri görmez. Ayarlar yalnız oyunun nasıl
 * SUNULDUĞUNU değiştirir.
 *
 * Pratik sonucu: bu dosya hiçbir ekonomi, değerleme, pazarlık veya
 * rastgelelik fonksiyonunu import ETMEZ. Böyle bir import belirse, ayar
 * sessizce bir mekaniğe dönüşmüş demektir.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NEDEN KAYIT DOSYASINDA DEĞİL (bkz. settings-store.ts):
 * Ayarlar CİHAZA aittir, kayda değil. Kayıt dosyasına konsaydı:
 *   · "Yeni oyun"da sesi tekrar kapatmak gerekirdi,
 *   · farklı kayıtlar farklı dilde açılırdı,
 *   · kaydı silmek dili sıfırlardı.
 * Hiçbiri oyuncunun beklediği davranış değil.
 */

/** Uygulanan diller. Yeni dil eklemek burayı ve sözlüğü genişletir. */
export const LOCALES = ['tr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABEL: Record<Locale, string> = {
  tr: 'Türkçe',
  en: 'English',
};

export interface GameSettings {
  /** Arka plan müziği açık mı. */
  music: boolean;
  /** Müzik ses seviyesi (0–1). */
  musicVolume: number;
  /** Efekt sesleri açık mı. */
  sfx: boolean;
  /** Efekt ses seviyesi (0–1). */
  sfxVolume: number;
  /** Dokunsal geri bildirim (titreşim) açık mı. */
  haptics: boolean;
  /** Arayüz dili. */
  locale: Locale;
}

export const DEFAULT_SETTINGS: GameSettings = {
  music: true,
  musicVolume: 0.5,
  sfx: true,
  /*
    Efekt sesi müzikten YÜKSEK başlar: efekt bir geri bildirimdir (teklif
    kabul edildi, test bitti), müzik ise zemindir. Eşit başlasalardı zemin
    geri bildirimi bastırırdı.
  */
  sfxVolume: 0.7,
  haptics: true,
  locale: 'tr',
};

/** 0–1 aralığına çeker; bozuk sayı varsayılana düşer. */
function normalizeVolume(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(1, Math.max(0, raw));
}

function normalizeBool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

export function normalizeLocale(raw: unknown): Locale {
  return LOCALES.includes(raw as Locale) ? (raw as Locale) : DEFAULT_SETTINGS.locale;
}

/**
 * Diskten okunmuş (eksik / bozuk / eski sürüm) ayarları güvenli hâle getirir.
 *
 * PARAMETRE `unknown` — `Partial<GameSettings>` DEĞİL. Girdi tarayıcı
 * deposundan gelir; orada her şey olabilir (elle düzenlenmiş, yarım yazılmış,
 * eski sürümden kalmış). `Partial` demek, derleyiciye asla doğrulayamadığı
 * bir söz verdirmek olurdu — profile.ts'te aynı hata bir kez yapıldı.
 *
 * EKSİK ALAN VARSAYILANA DÜŞER, kayıt reddedilmez: ileride yeni bir ayar
 * eklendiğinde eski tercihler silinmemeli.
 */
export function normalizeSettings(raw: unknown): GameSettings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    music: normalizeBool(src.music, DEFAULT_SETTINGS.music),
    musicVolume: normalizeVolume(src.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfx: normalizeBool(src.sfx, DEFAULT_SETTINGS.sfx),
    sfxVolume: normalizeVolume(src.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    haptics: normalizeBool(src.haptics, DEFAULT_SETTINGS.haptics),
    locale: normalizeLocale(src.locale),
  };
}

/**
 * Bir kanalın ETKİN ses seviyesi: kapalıysa sıfır, açıksa kendi seviyesi.
 *
 * Tek kapı olması bilinçli — "açık mı" ile "kaç seviye" iki ayrı yerde
 * çarpılsaydı, biri kapalıyken diğerinin ses çıkardığı bir hâl er geç
 * doğardı.
 */
export function effectiveVolume(settings: GameSettings, channel: 'music' | 'sfx'): number {
  if (channel === 'music') return settings.music ? settings.musicVolume : 0;
  return settings.sfx ? settings.sfxVolume : 0;
}
