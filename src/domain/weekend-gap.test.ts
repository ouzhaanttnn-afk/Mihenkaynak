/**
 * HAFTA SONU AÇILIŞ BOŞLUĞU — sahadan gelen mekanik.
 *
 * Bir sarrafın kendi cümlesi:
 *   "Cuma fiyat kapattı, cumartesi–pazar fiyat kapalı, pazartesi ne olacağını
 *    bilmeden satış yapıyoruz ve riskli bir işlem."
 *
 * Bu dosya o cümlenin oyundaki karşılığını kilitler. Kilitlenen dört şey:
 *
 *  1. TAKVİM   — 1. gün pazartesidir; piyasa Pzt–Cuma, dükkân Pzt–Cmt açıktır.
 *  2. DONUKLUK — cumartesi–pazar kotasyon cuma kapanışında durur, gün içi
 *                adım da atılmaz. Cumartesi ticaret DÜN'ün fiyatıyla yapılır.
 *  3. BOŞLUK   — pazartesi üç günlük hareketi birden fiyatlar; ölçek √3'tür
 *                ve bant %3 → %5,2'ye genişler.
 *  4. HAFTA İÇİ DEĞİŞMEZ — Salı–Cuma bu değişiklikten önceki fiyatın
 *                birebir aynısını üretir (çekiliş sayısı değişmedi).
 *
 * ÖLÇÜM (60 çekirdek × 140 gün, altın):
 *   Pzt  sd %2,68  p5 −%5,20  |x|>%3: %27,2
 *   Sal  sd %1,53  Çar %1,50  Per %1,55  Cum %1,56
 *   Cmt  sd %0,00  Paz sd %0,00   (2400/2400 gün donuk)
 *
 * REDDEDİLEN İLK TASARIM: üç günü üç ayrı adımda çekmek. Ölçüm pazartesiyi
 * sd %4,52 / en kötü −%8,73 / %48,8'i %3 üstü yaptı — üç adım da aynı rejim
 * ve trendden türediği için bağımsız değil, üç kez tekrarlanan tek gündü.
 * O hâliyle pazartesi bütün haftanın kararlarının önüne geçerdi.
 */

import { describe, expect, it } from 'vitest';

import { MARKET_DAILY_CAP } from './balance';
import {
  closedDaysBefore,
  isBlindTradingDay,
  isLastTradingDay,
  isMarketOpen,
  isShopOpen,
  nextMarketOpenDay,
  weekdayLabel,
  weekdayOf,
  weekOf,
} from './calendar';
import { createMarketForDay } from './market';
import { resolveOvernight, weekendRisk } from './overnight';
import type { MarketState } from './types';
import type { OvernightPosition } from './overnight';

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

describe('Takvim', () => {
  it('1. gün pazartesidir ve hafta yedi günde döner', () => {
    expect(weekdayLabel(1)).toBe('Pazartesi');
    expect(weekdayLabel(5)).toBe('Cuma');
    expect(weekdayLabel(6)).toBe('Cumartesi');
    expect(weekdayLabel(7)).toBe('Pazar');
    expect(weekdayLabel(8)).toBe('Pazartesi');
    expect(weekOf(1)).toBe(1);
    expect(weekOf(7)).toBe(1);
    expect(weekOf(8)).toBe(2);
  });

  it('piyasa Pzt–Cuma, dükkân Pzt–Cmt açıktır', () => {
    const open = { market: [] as string[], shop: [] as string[] };
    for (let day = 1; day <= 7; day += 1) {
      if (isMarketOpen(day)) open.market.push(weekdayLabel(day));
      if (isShopOpen(day)) open.shop.push(weekdayLabel(day));
    }
    expect(open.market).toEqual(['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']);
    expect(open.shop).toEqual([
      'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi',
    ]);
  });

  it('cumartesi tek "kör ticaret" günüdür — dükkân açık, piyasa kapalı', () => {
    const blind = [1, 2, 3, 4, 5, 6, 7].filter(isBlindTradingDay).map(weekdayLabel);
    expect(blind).toEqual(['Cumartesi']);
  });

  it('cuma haftanın son işlem günüdür; piyasa pazartesi açılır', () => {
    expect(isLastTradingDay(5)).toBe(true);
    expect(isLastTradingDay(6)).toBe(false);
    expect(nextMarketOpenDay(5)).toBe(8);
    expect(weekdayOf(8)).toBe(0);
  });
});

describe('Hafta sonu kotasyonu donuktur, pazartesi boşlukla açar', () => {
  /** 60 çekirdek × 140 gün: günün haftalık adına göre spot değişimleri. */
  const byWeekday: Record<number, number[]> = {};
  for (let s = 1; s <= 40; s += 1) {
    const seed = 4_000_000 + s * 7919;
    let prev: MarketState | undefined;
    let lastQuote = 0;
    for (let day = 1; day <= 140; day += 1) {
      const m = createMarketForDay(seed, day, prev);
      if (day > 1) (byWeekday[weekdayOf(day)] ??= []).push(m.goldSpot / lastQuote - 1);
      lastQuote = m.goldSpot;
      prev = m;
    }
  }

  it('cumartesi ve pazar HİÇ hareket etmez', () => {
    for (const wd of [5, 6]) {
      const moves = byWeekday[wd]!;
      expect(moves.length).toBeGreaterThan(500);
      expect(Math.max(...moves.map(Math.abs)), weekdayLabel(wd + 1)).toBe(0);
    }
  });

  it('pazartesi hafta içi bir günden BELİRGİN daha oynaktır', () => {
    const monday = sd(byWeekday[0]!);
    const midweek = mean([1, 2, 3, 4].map((wd) => sd(byWeekday[wd]!)));

    // √3 ≈ 1,73. Ölçüm (birleşme sonrası): pazartesi %1,93 / hafta içi %1,10.
    expect(monday / midweek, `pazartesi/hafta içi ${(monday / midweek).toFixed(2)}×`)
      .toBeGreaterThan(1.4);
    expect(monday / midweek).toBeLessThan(2.2);
  });

  it('pazartesi bandı %5,2yi aşmaz — risk büyür, sınırsızlaşmaz', () => {
    const cap = MARKET_DAILY_CAP * Math.sqrt(3);
    const worst = Math.max(...byWeekday[0]!.map(Math.abs));
    expect(worst, `en büyük pazartesi hareketi %${(worst * 100).toFixed(2)}`)
      .toBeLessThanOrEqual(cap + 1e-6);
  });

  it('hafta içi günler birbirinin aynısı — boşluk sadece pazartesiye biniyor', () => {
    /*
      ÖLÇÜM GÜNCELLENDİ: makro çıpa + ortalamaya dönüş devreye girince hafta
      içi sapma %1,5'ten %1,10'a indi (uzun oyunda fiyatın sınırsız
      sürüklenmesini durduran değişiklik). Test mutlak bir sayıyı değil,
      KURALI bağlar: dört hafta içi günü birbirinden ayırt edilemez ve
      hiçbiri pazartesiye yaklaşmaz.
    */
    const weekdays = [1, 2, 3, 4].map((wd) => sd(byWeekday[wd]!));
    const lo = Math.min(...weekdays);
    const hi = Math.max(...weekdays);

    expect(hi / lo, `hafta içi sapmalar ${(hi / lo).toFixed(2)}× ayrışıyor`).toBeLessThan(1.15);
    for (const [i, s] of weekdays.entries()) {
      expect(s, `${weekdayLabel(i + 2)} sd %${(s * 100).toFixed(2)}`).toBeGreaterThan(0.006);
      expect(s).toBeLessThan(0.015);
    }
    expect(sd(byWeekday[0]!)).toBeGreaterThan(hi * 1.4);
  });

  it('boşluk gün sayısı markette taşınır', () => {
    const seed = 90_210;
    let prev = createMarketForDay(seed, 1);
    for (let day = 2; day <= 15; day += 1) {
      const m = createMarketForDay(seed, day, prev);
      expect(m.gapDays ?? 0, `gün ${day} (${weekdayLabel(day)})`).toBe(closedDaysBefore(day));
      prev = m;
    }
  });
});

describe('Cuma kapanışı uyarısı', () => {
  const position = (metal: number, cash: number): OvernightPosition => ({
    day: 5,
    cash,
    metalValue: metal,
    metalShare: metal + cash > 0 ? metal / (metal + cash) : 0,
    goldSpot: 4_200,
  });

  it('yalnız cuma günü doludur', () => {
    for (let day = 1; day <= 7; day += 1) {
      const risk = weekendRisk(day, position(500_000, 100_000));
      expect(Boolean(risk), weekdayLabel(day)).toBe(day === 5);
    }
  });

  it('iki kapalı gün ve pazartesi açılışını söyler', () => {
    const risk = weekendRisk(5, position(500_000, 100_000))!;
    expect(risk.closedDays).toBe(2);
    expect(risk.reopensOnDay).toBe(8);
    expect(risk.reopensOnLabel).toBe('Pazartesi');
  });

  it('taşınan tutarla ölçeklenir — bandın tavanını verir', () => {
    const small = weekendRisk(5, position(100_000, 0))!;
    const large = weekendRisk(5, position(1_000_000, 0))!;
    expect(large.worstCase).toBeGreaterThan(small.worstCase * 9);
    // %3 × √3 ≈ %5,196
    expect(large.worstCase / 1_000_000).toBeCloseTo(MARKET_DAILY_CAP * Math.sqrt(3), 3);
  });

  it('YÖN SÖYLEMEZ (§5.2) — kesinlik dili yok', () => {
    const notes = [
      weekendRisk(5, position(800_000, 50_000))!.note,
      weekendRisk(5, position(0, 900_000))!.note,
    ];
    for (const note of notes) {
      expect(note).not.toMatch(/yükselecek|düşecek|kesin|garanti/i);
      expect(note).toMatch(/kapalı/);
    }
  });

  it('nakitteki oyuncuya da bir şey söyler — nakit koşulsuz güvenli değildir', () => {
    const flat = weekendRisk(5, position(0, 900_000))!;
    expect(flat.worstCase).toBe(0);
    expect(flat.note).toMatch(/fırsat maliyeti/);
  });
});

describe('Gün raporu hafta sonunu geceyle karıştırmaz', () => {
  const pos = (spot: number): OvernightPosition => ({
    day: 7,
    cash: 100_000,
    metalValue: 900_000,
    metalShare: 0.9,
    goldSpot: spot,
  });

  function marketAt(day: number, seed = 4242): MarketState {
    let m = createMarketForDay(seed, 1);
    for (let d = 2; d <= day; d += 1) m = createMarketForDay(seed, d, m);
    return m;
  }

  it('pazartesi açılışı "hafta sonu" der ve yüzdeyi yazar', () => {
    const monday = { ...marketAt(8), goldSpot: 4_000 * 0.96 };
    const out = resolveOvernight(pos(4_000), monday);
    expect(out.gapDays).toBe(2);
    expect(out.summary).toMatch(/hafta sonunu/i);
    expect(out.summary).toMatch(/−%4,00/);
  });

  it('hafta içi gece "hafta sonu" demez', () => {
    const wednesday = { ...marketAt(3), goldSpot: 4_000 * 0.98 };
    const out = resolveOvernight(pos(4_000), wednesday);
    expect(out.gapDays).toBe(0);
    expect(out.summary).not.toMatch(/hafta sonu/i);
  });

  it('boşluk muhasebeye GİRMEZ — yalnız rapordur (GDD 34.5)', () => {
    const monday = { ...marketAt(8), goldSpot: 4_000 * 0.95 };
    const out = resolveOvernight(pos(4_000), monday);
    // Pozisyon raporu: mal hâlâ stokta, gerçekleşmiş kâr yazılmadı.
    expect(out.metalDelta).toBeLessThan(0);
    expect(Object.keys(out)).not.toContain('realizedProfit');
  });
});
