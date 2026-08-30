/**
 * MIHENKAYNAK — Haftalık takvim ve piyasa kapanışı
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR — sahadan gelen istek (bir sarraf, kendi ağzından):
 *
 *   "Cuma fiyat kapattı, cumartesi–pazar fiyat kapalı, pazartesi ne olacağını
 *    bilmeden satış yapıyoruz ve riskli bir işlem."
 *
 * Oyunun bu zamana kadar HİÇ haftası yoktu: 1. gün ile 40. gün birbirinin
 * aynısıydı. Gecelik risk vardı ama ince marjlı bir işte gürültü kalıyordu.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ÖLÇÜM (60 çekirdek × 120 gün, altın spot):
 *
 *   pencere              std sapma   p5        p95      |x|>%2   en kötü
 *   1 gecelik            %1,52       −%2,79    +%3,00   %21,8    −%3,00
 *   3 günlük (cuma→pzt)  %3,38       −%5,43    +%5,80   %56,8    −%8,73
 *
 * Hafta sonu boşluğu bir gecenin 2,2 KATI. Yeni oynaklık uydurmaya gerek
 * yoktu: mevcut piyasa motoru üç günü biriktirince zaten bunu üretiyor.
 * Otomatik oyuncuyla ölçülen tipik gecelik metal pozisyonu 1,2–1,6 milyon ₺;
 * yani kötü bir hafta sonu bir HAFTALIK kârı silebiliyor.
 *
 * KURGU: piyasa hafta sonu karanlıkta hareket etmeye devam eder, oyuncu
 * yalnız GÖREMEZ. Cumartesi–pazar kotasyonu cuma kapanışında donar; pazartesi
 * birikmiş hareket bir AÇILIŞ BOŞLUĞU olarak görünür.
 *
 * TAKVİM (oyuncunun cevabı): Cumartesi dükkân AÇIK — piyasa donukken ticaret
 * yapılan asıl risk günü budur. Pazar dükkân KAPALI: müşteri gelmez, gün
 * planlamaya kalır.
 *
 * DEĞİŞMEZ: bu dosya saf takvim aritmetiğidir. Fiyat, RNG, para ve settlement
 * bilmez; yalnız "bugün hangi gün, piyasa açık mı, dükkân açık mı" der.
 */

import type { GameDay } from './types';

/** 0 = Pazartesi … 6 = Pazar. 1. gün Pazartesidir. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABEL: readonly string[] = [
  'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar',
];

export const WEEKDAY_SHORT: readonly string[] = [
  'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz',
];

/** Haftanın günü. Gün numarası 1'den başlar; 1. gün Pazartesidir. */
export function weekdayOf(day: GameDay): Weekday {
  // Negatif veya sıfır gün beklenmez ama modülün negatife düşmesi
  // takvimi sessizce kaydırırdı; taban her koşulda pozitife çekilir.
  const index = (((day - 1) % 7) + 7) % 7;
  return index as Weekday;
}

/** Kaçıncı hafta (1'den başlar) — haftalık özet ve sıralama için. */
export function weekOf(day: GameDay): number {
  return Math.floor((day - 1) / 7) + 1;
}

export function weekdayLabel(day: GameDay): string {
  return WEEKDAY_LABEL[weekdayOf(day)]!;
}

export function weekdayShort(day: GameDay): string {
  return WEEKDAY_SHORT[weekdayOf(day)]!;
}

/** Piyasa (spot fiyat) yalnız hafta içi çalışır: Pzt–Cuma. */
export function isMarketOpen(day: GameDay): boolean {
  return weekdayOf(day) <= 4;
}

/** Dükkân Pzt–Cmt açıktır. Pazar kapalıdır: müşteri gelmez. */
export function isShopOpen(day: GameDay): boolean {
  return weekdayOf(day) <= 5;
}

/**
 * Dükkânın AÇIK ama piyasanın KAPALI olduğu gün — yani cumartesi.
 *
 * Oyunun yeni risk günü budur: cuma kapanışının fiyatıyla ticaret yaparsın,
 * pazartesinin ne getireceğini bilmeden.
 */
export function isBlindTradingDay(day: GameDay): boolean {
  return isShopOpen(day) && !isMarketOpen(day);
}

/** Haftanın son işlem günü — cuma. Pozisyon kararının verildiği gün. */
export function isLastTradingDay(day: GameDay): boolean {
  return weekdayOf(day) === 4;
}

/**
 * Bu günden HEMEN ÖNCE kaç gün piyasa kapalı kaldı.
 *
 * Pazartesi için 2 (cumartesi + pazar), diğer açık günler için 0. Kapalı bir
 * günün kendisi için de 0 döner: boşluk yalnız piyasanın AÇILDIĞI günde
 * gerçekleşir, kapalıyken fiyat zaten donuktur.
 *
 * Döngü sabit bir sayı yazmak yerine takvimi gerçekten yürür; hafta sonu
 * tanımı değişirse (örneğin bayram günü eklenirse) boşluk kendiliğinden
 * doğru büyür.
 */
export function closedDaysBefore(day: GameDay): number {
  if (!isMarketOpen(day)) return 0;

  let count = 0;
  for (let d = day - 1; d >= 1 && !isMarketOpen(d); d -= 1) count += 1;
  return count;
}

/** Bir sonraki piyasa günü — "pazartesi açılışı" metinleri için. */
export function nextMarketOpenDay(day: GameDay): GameDay {
  let d = day + 1;
  while (!isMarketOpen(d)) d += 1;
  return d;
}
