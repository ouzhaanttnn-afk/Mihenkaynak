/**
 * HAFTA SONU TAKVİMİ — store yolu.
 *
 * `weekend-gap.test.ts` piyasa matematiğini domain katmanında kilitler; bu
 * dosya o takvimin GERÇEKTEN oynanışa bağlandığını doğrular. İkisi ayrı
 * soruya cevap verir: "kural doğru mu" ve "kural devrede mi". Spawn kapısı
 * bağlanmayı unutulsaydı domain testleri yine geçerdi.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { isMarketOpen, isShopOpen, weekdayLabel, weekdayOf } from '@domain/calendar';
import { useGame } from './gameStore';

/*
  `resetGame` KASITLI OLARAK BELLEĞİ TEMİZLEMEZ — yalnız kaydı siler ve yeni
  oyun bir sonraki açılışta başlar. Bu yüzden testler "1. günden başlarım"
  varsayamaz; her biri store'un o an kaçıncı gündeyse oradan ilerler ve
  aradığı HAFTA GÜNÜNE kadar oynar. İlk hâli 1. günü varsayıyordu ve ikinci
  testten sonra 'Cuma' yerine 'Salı' bulup kırıldı.
*/
beforeEach(() => {
  useGame.setState({ pauseDepth: 0 });
});

/** Aranan hafta gününe kadar oynamadan ilerler: gelen müşteriyi geri çevirir. */
function runUntilWeekday(target: number): void {
  for (let step = 0; step < 300_000; step += 1) {
    const s = useGame.getState();
    if (weekdayOf(s.market.day) === target && s.market.clockMinutes < 11 * 60) return;
    if (s.activeDeal) {
      useGame.getState().finishDeal();
      continue;
    }
    useGame.getState().tick(4);
  }
  throw new Error(`${weekdayLabel(target + 1)} üretilemedi`);
}

/** Bir günü baştan sona oynatır ve o gün üretilen müşteri sayısını sayar. */
function customersOnCurrentDay(): number {
  const startDay = useGame.getState().market.day;
  const startSpawn = useGame.getState().spawnCounter;

  for (let step = 0; step < 300_000; step += 1) {
    const s = useGame.getState();
    if (s.market.day !== startDay) break;
    if (s.activeDeal) {
      useGame.getState().finishDeal();
      continue;
    }
    useGame.getState().tick(4);
  }

  return useGame.getState().spawnCounter - startSpawn;
}

describe('Pazar dükkân kapalı, cumartesi açık', () => {
  it('cumartesi müşteri gelir', () => {
    runUntilWeekday(5);
    expect(weekdayLabel(useGame.getState().market.day)).toBe('Cumartesi');
    expect(customersOnCurrentDay()).toBeGreaterThan(0);
  });

  it('pazar HİÇ müşteri gelmez', () => {
    runUntilWeekday(6);
    expect(weekdayLabel(useGame.getState().market.day)).toBe('Pazar');
    expect(customersOnCurrentDay()).toBe(0);
  });

  it('pazartesi müşteri yeniden gelir — kapı kilitli kalmaz', () => {
    runUntilWeekday(0);
    expect(weekdayLabel(useGame.getState().market.day)).toBe('Pazartesi');
    expect(customersOnCurrentDay()).toBeGreaterThan(0);
  });
});

describe('Hafta sonu fiyatı donuk kalır (store)', () => {
  it('cumartesi gün boyu tek kuruş oynamaz', () => {
    runUntilWeekday(5);
    const open = useGame.getState().market.goldSpot;
    expect(useGame.getState().market.marketOpen).toBe(false);

    // Gün içi adımlar boyunca fiyat sabit kalmalı — "yavaş hareket eden
    // gün" değil, DONUK gün.
    const startDay = useGame.getState().market.day;
    let steps = 0;

    for (let i = 0; i < 4_000; i += 1) {
      const before = useGame.getState();
      if (before.market.day !== startDay) break;
      if (before.activeDeal) {
        useGame.getState().finishDeal();
        continue;
      }

      useGame.getState().tick(4);

      const after = useGame.getState();
      if (after.market.day !== startDay) break;
      steps += 1;
      expect(after.market.goldSpot, `cumartesi ${after.market.clockMinutes}. dk`).toBe(open);
      expect(after.market.silverSpot).toBe(before.market.silverSpot);
    }

    expect(steps, 'gün içi adım atılmadı — test hiçbir şey ölçmedi').toBeGreaterThan(50);
  });

  it('gün raporu kapanan günün adını ve yarını taşır', () => {
    runUntilWeekday(4);
    const day = useGame.getState().market.day;
    expect(weekdayLabel(day)).toBe('Cuma');

    useGame.getState().advanceDay();
    const report = useGame.getState().lastDayClose!;

    expect(report.weekday).toBe('Cuma');
    expect(report.tomorrow).toBe('Cumartesi');
    expect(report.tomorrowMarketOpen).toBe(false);
    expect(report.tomorrowShopOpen).toBe(true);
    // Cuma kapanışı hafta sonu uyarısını TAŞIR — haftanın en pahalı kararı.
    expect(report.weekendNote).toBeTruthy();
    expect(report.weekendNote).toMatch(/2 gün kapalı/);
  });

  it('hafta içi kapanışta hafta sonu uyarısı YOKTUR', () => {
    runUntilWeekday(1);
    useGame.getState().advanceDay();
    const report = useGame.getState().lastDayClose!;
    expect(report.weekday).toBe('Salı');
    expect(report.weekendNote).toBeNull();
    expect(report.tomorrowMarketOpen).toBe(true);
  });

  it('takvim ile piyasa/dükkân durumu tutarlı ilerler', () => {
    for (let day = 1; day <= 14; day += 1) {
      expect(isMarketOpen(day), `${day}. gün piyasa`).toBe(((day - 1) % 7) <= 4);
      expect(isShopOpen(day), `${day}. gün dükkân`).toBe(((day - 1) % 7) <= 5);
    }
  });
});
