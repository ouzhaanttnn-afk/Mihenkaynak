/**
 * DOKUNSAL GERİ BİLDİRİM.
 *
 * `navigator.vibrate` gerçek ve bugün çalışan bir API'dir — ama HER YERDE
 * DEĞİL: iOS Safari desteklemez, masaüstü tarayıcılarda çoğunlukla yoktur.
 * Bu yüzden `isHapticsSupported` dışa açık: Ayarlar ekranı desteklenmeyen
 * cihazda düğmeyi pasif gösterip NEDENİNİ yazabiliyor (UPDATEv2 §12:
 * "pasif düğmelerin nedeni metin ve erişilebilir adla açıklanmalı").
 *
 * DESENLER KISA: titreşim bir bildirim değil, bir onaydır. Uzun titreşim
 * telefonu masada zıplatır ve oyuncuyu ürkütür; buradaki en uzunu bile
 * 30 ms'lik iki darbedir.
 */

const PATTERNS: Record<'tap' | 'success' | 'warn', number | number[]> = {
  /** Dokunma onayı — en hafifi. */
  tap: 15,
  /** Olumlu sonuç: teklif kabul, satış kapandı. */
  success: [12, 40, 22],
  /** Olumsuz sonuç: teklif reddedildi, nakit yetmedi. */
  warn: [28, 60, 28],
};

export type HapticPattern = keyof typeof PATTERNS;

export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/**
 * Titreşir. Kapalıysa veya cihaz desteklemiyorsa sessizce hiçbir şey yapmaz.
 *
 * `enabled` PARAMETRE, modül içinden okunan bir durum değil: bu dosyanın
 * ayarları da bilmesi, iki yerde saklanan tek bir gerçek demekti.
 */
export function vibrate(pattern: HapticPattern, enabled: boolean): void {
  if (!enabled || !isHapticsSupported()) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Bazı tarayıcılar kullanıcı etkileşimi olmadan reddeder; hata değil.
  }
}
