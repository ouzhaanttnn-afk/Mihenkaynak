/**
 * GÜNLÜK HAREKET TAVANI — %3.
 *
 * Kullanıcı raporu: "kur çok dengesiz". Ölçüldü ve doğrulandı: gün-güne
 * hareket %6,84'e, gün içi tepe-dip bandı %5,72'ye çıkıyordu.
 *
 * Bu testler tavanın İKİ AYRI yerde tutulduğunu bağlar — biri düzeltilip
 * diğeri unutulursa oyuncu yine dengesiz bir kur görür.
 *
 * HAFTA SONU BOŞLUĞU TAVANI BÜYÜTÜR, KALDIRMAZ (calendar.ts · market.ts).
 * Piyasa cumartesi–pazar kapalıdır; pazartesi üç günlük hareketi birden
 * fiyatlar ve bandı √3 ile genişler (%3 → %5,2). Test artık günün kaç
 * günlük boşluk taşıdığını hesaplayıp O günün tavanını sınar — sabit %3
 * yazmak, boşluğu ya yasaklar ya da sınırsız bırakırdı.
 */

import { describe, expect, it } from 'vitest';

import { MARKET_DAILY_CAP } from './balance';
import { closedDaysBefore, isMarketOpen, weekdayShort } from './calendar';
import { createMarketForDay, stepMarketIntraday } from './market';

const SEEDS = [1, 7, 555, 20260829];
const DAYS = 40;
/** Kayan nokta yuvarlaması tavanı bir kıl payı aşabilir. */
const EPS = 1e-6;

/** O günün tavanı: hafta içi %3, pazartesi %3 × √3 ≈ %5,2. */
function capFor(day: number): number {
  return MARKET_DAILY_CAP * Math.sqrt(closedDaysBefore(day) + 1);
}

describe('Gün-güne hareket o günün tavanını aşmaz', () => {
  it('altın, gümüş ve kur — 4 tohum × 40 gün', () => {
    for (const seed of SEEDS) {
      let prev = createMarketForDay(seed, 1);

      for (let day = 2; day <= DAYS; day += 1) {
        const next = createMarketForDay(seed, day, prev);
        const cap = capFor(day);

        for (const [label, a, b] of [
          ['altın', next.goldSpot, prev.goldSpot],
          ['gümüş', next.silverSpot, prev.silverSpot],
          ['kur', next.fxIndex, prev.fxIndex],
        ] as const) {
          const move = Math.abs((a - b) / b);
          expect(
            move,
            `${label} · tohum ${seed} · gün ${day} (${weekdayShort(day)}): %${(move * 100).toFixed(2)} > tavan %${(cap * 100).toFixed(2)}`,
          ).toBeLessThanOrEqual(cap + EPS);
        }
        prev = next;
      }
    }
  });

  it('piyasa kapalı günde fiyat HİÇ kıpırdamaz', () => {
    let checked = 0;

    for (const seed of SEEDS) {
      let prev = createMarketForDay(seed, 1);

      for (let day = 2; day <= DAYS; day += 1) {
        const next = createMarketForDay(seed, day, prev);

        if (!isMarketOpen(day)) {
          checked += 1;
          expect(next.marketOpen, `gün ${day} açık işaretlenmiş`).toBe(false);
          expect(next.goldSpot, `gün ${day} (${weekdayShort(day)}) altın oynadı`).toBe(prev.goldSpot);
          expect(next.silverSpot).toBe(prev.silverSpot);
          expect(next.fxIndex).toBe(prev.fxIndex);
          // Gün içi adım da donuktur: yavaş hareket eden bir gün değil.
          expect(stepMarketIntraday(next, 15 * 60).goldSpot).toBe(prev.goldSpot);
        }
        prev = next;
      }
    }

    expect(checked, 'kapalı gün üretilmedi').toBeGreaterThan(20);
  });

  it('boşluk yalnız piyasanın açıldığı güne biner', () => {
    // Pazartesi 2 gün boşluk taşır; diğer açık günler 0.
    for (let day = 1; day <= 28; day += 1) {
      const expected = day % 7 === 1 && day > 1 ? 2 : 0;
      expect(closedDaysBefore(day), `gün ${day} (${weekdayShort(day)})`).toBe(
        isMarketOpen(day) ? expected : 0,
      );
    }
  });
});

describe('Gün içi fiyat açılıştan ±%3ten fazla uzaklaşmaz', () => {
  it('40 çeyrek saatlik adımın hiçbiri bandı delmez', () => {
    for (const seed of SEEDS) {
      let market = createMarketForDay(seed, 1);

      for (let day = 2; day <= 12; day += 1) {
        const open = createMarketForDay(seed, day, market);
        let cur = open;

        for (let t = 9 * 60; t <= 19 * 60; t += 15) {
          cur = stepMarketIntraday(cur, t);
          const drift = Math.abs((cur.goldSpot - open.goldSpot) / open.goldSpot);
          expect(drift, `tohum ${seed} · gün ${day} · ${t} dk: %${(drift * 100).toFixed(2)}`)
            .toBeLessThanOrEqual(MARKET_DAILY_CAP + EPS);
        }
        market = cur;
      }
    }
  });

  it('şerit yüzdesi GÜNÜN AÇILIŞINA göre okunur, kayan bir tabana göre değil', () => {
    /*
      Eski hata: taban `asset.history[0]` idi. `buildAssets` diziye başa,
      `stepMarketIntraday` sona ekliyordu; 12. adımdan sonra dizinin başı
      artık günün açılışı olmuyor ve gösterilen yüzde her adımda başka bir
      şeyi ölçüyordu. Bu test bunu 24 adım ilerleyerek yakalar.
    */
    const open = createMarketForDay(20260829, 2, createMarketForDay(20260829, 1));
    let cur = open;
    for (let t = 9 * 60; t <= 15 * 60; t += 15) cur = stepMarketIntraday(cur, t);

    const gold = cur.assets.find((a) => a.id === 'goldGram')!;
    const expected = ((cur.goldSpot - open.goldSpot) / open.goldSpot) * 100;
    expect(gold.changePct).toBeCloseTo(expected, 6);
  });
});

describe('Tavan piyasanın KARAKTERİNİ düzleştirmez', () => {
  it('rejimler arası hareket farkı korunur — şok günü hâlâ en hareketli', () => {
    /*
      Kırpma yerine rejim bantlarını küçültmek de tavanı tutturur ama sakin
      ile şok arasındaki farkı siler. Bu test o çözümü reddeder.
    */
    const sample = (regime: string) => {
      const moves: number[] = [];
      for (const seed of [3, 11, 42, 99, 128, 256]) {
        let prev = createMarketForDay(seed, 1);
        for (let day = 2; day <= 60; day += 1) {
          const next = createMarketForDay(seed, day, prev);
          if (next.regime === regime) {
            moves.push(Math.abs((next.goldSpot - prev.goldSpot) / prev.goldSpot));
          }
          prev = next;
        }
      }
      return moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 0;
    };

    const calm = sample('calm');
    const stressed = Math.max(sample('volatile'), sample('shock'));
    expect(calm, 'sakin rejim örneği çıkmadı').toBeGreaterThan(0);
    expect(stressed, 'stresli rejim sakinden hareketli değil').toBeGreaterThan(calm);
  });
});
