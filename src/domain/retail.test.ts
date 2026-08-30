/**
 * VİTRİN SATIŞI — dört ölü çıkış kanalından birinin bağlanması.
 *
 * BULUNAN HATA: altı çıkış kanalından yalnız ikisi (toptancı, esnaf ağı)
 * gerçekten uygulanabiliyordu. `retail`, `melt`, `collection` ve
 * `serviceResale` tam modellenmişti, İşlem Tezinde oyuncuya sunuluyordu ve
 * uygulanacak hiçbir yolu yoktu.
 *
 * ÖLÇÜM (958 ticaret işlemi):
 *   kanal        sunulma   ort. alış tavanı   uygulanabilir?
 *   retail           928            157.583   HAYIR
 *   melt             958            134.272   HAYIR
 *   wholesale        958            130.633   evet
 *
 * Oyuncuya sunulan EN İYİ tez %99,9 oranında uygulanamaz olandı. Oyun
 * "vitrinde satarsan 157.583'e kadar verebilirsin" diyor, oyuncu ödüyor,
 * sonra malı ancak 130.633'e toptancıya verebiliyordu: her işçilikli
 * alımda sistematik ~%21 fazla ödeme.
 *
 * Bağlandıktan sonra (40 gün): 16 mal alındı, 16'sı vitrinden satıldı,
 * 163.780 ₺ ciro, 6.806 ₺ gerçekleşmiş kâr, 1.820 ₺ taşıma maliyeti.
 */

import { describe, expect, it } from 'vitest';
import { EXIT_CHANNEL, RETAIL } from './balance';
import { dailySaleChance, resolveRetailDay } from './retail';
import type { InventoryPosition } from './types';

const poz = (over: Partial<InventoryPosition> = {}): InventoryPosition => ({
  itemId: 'it_1',
  quantity: 1,
  costBasis: 10_000,
  currentValue: 12_000,
  age: 0,
  demand: 'steady',
  thesis: 'retail',
  location: 'display',
  expectedExitValues: { retail: 12_000 },
  ...over,
});

describe('günlük satılma olasılığı', () => {
  it('çıpası nakde dönüş süresidir', () => {
    const [lo, hi] = EXIT_CHANNEL.retail.daysToCash;
    // Ortalama 5 günde dönen vitrin ≈ günde 1/5.
    expect(dailySaleChance(poz())).toBeCloseTo(1 / ((lo + hi) / 2), 5);
  });

  it('talep etiketi hızı değiştirir', () => {
    expect(dailySaleChance(poz({ demand: 'hot' }))).toBeGreaterThan(dailySaleChance(poz()));
    expect(dailySaleChance(poz({ demand: 'cold' }))).toBeLessThan(dailySaleChance(poz()));
  });

  it('bekleyen mal yavaşlar ama hiç satılmaz olmaz', () => {
    // Vitrinde unutulan kalem gerçekte de indirimle gider; sıfıra inmesi
    // oyuncuyu kurtulamayacağı bir pozisyona hapsederdi.
    const eski = dailySaleChance(poz({ age: 90 }));
    expect(eski).toBeLessThan(dailySaleChance(poz({ age: 0 })));
    expect(eski).toBeGreaterThan(0);
    expect(eski).toBeGreaterThanOrEqual((1 / 5) * RETAIL.ageFloor - 1e-9);
  });

  it('olasılık 1'.concat("'i aşmaz"), () => {
    expect(dailySaleChance(poz({ demand: 'hot', age: 0 }))).toBeLessThanOrEqual(1);
  });
});

describe('gün çözümü', () => {
  it('yalnız VİTRİNDEKİ ve tezi vitrin olan kalem satılır', () => {
    const envanter = [
      poz({ itemId: 'arka', location: 'backStock' }),
      poz({ itemId: 'baska_tez', thesis: 'wholesale' }),
      poz({ itemId: 'atolye', location: 'workshop' }),
    ];
    // 200 gün boyunca hiçbiri satılmamalı.
    for (let g = 1; g <= 200; g += 1) {
      expect(resolveRetailDay(1, g, envanter).sales).toHaveLength(0);
    }
  });

  it('tez bu kanalı fiyatlamadıysa satış olmaz', () => {
    const envanter = [poz({ expectedExitValues: {} })];
    for (let g = 1; g <= 200; g += 1) {
      expect(resolveRetailDay(1, g, envanter).sales).toHaveLength(0);
    }
  });

  it('taşıma maliyeti vitrindeki kalem başına doğar', () => {
    const bir = resolveRetailDay(1, 1, [poz()]);
    const uc = resolveRetailDay(1, 1, [poz({ itemId: 'a' }), poz({ itemId: 'b' }), poz({ itemId: 'c' })]);
    expect(bir.holdingCost).toBe(EXIT_CHANNEL.retail.holdingCostPerDay);
    expect(uc.holdingCost).toBe(3 * EXIT_CHANNEL.retail.holdingCostPerDay);
  });

  it('arka stok taşıma maliyeti doğurmaz — vitrin slotu kıt olandır', () => {
    expect(resolveRetailDay(1, 1, [poz({ location: 'backStock' })]).holdingCost).toBe(0);
  });

  it('deterministiktir — aynı tohum ve gün aynı sonucu verir', () => {
    // GDD 28.3: haftalık liste ve tekrar oynatma buna dayanır.
    const envanter = [poz()];
    for (let g = 1; g <= 30; g += 1) {
      expect(resolveRetailDay(7, g, envanter)).toEqual(resolveRetailDay(7, g, envanter));
    }
  });

  it('girdiyi mutasyona uğratmaz', () => {
    const envanter = [poz()];
    const kopya = JSON.parse(JSON.stringify(envanter));
    for (let g = 1; g <= 50; g += 1) resolveRetailDay(3, g, envanter);
    expect(envanter).toEqual(kopya);
  });

  it('zamanla gerçekten satar', () => {
    /*
      ASIL REGRESYON: kanalın bağlı olduğunun kanıtı. Yeterince gün
      geçince vitrindeki mal satılmalı — aksi hâlde tez yine boş bir vaat.
    */
    let satis = 0;
    for (let g = 1; g <= 60; g += 1) satis += resolveRetailDay(11, g, [poz()]).sales.length;
    expect(satis).toBeGreaterThan(0);
  });

  it('yığılabilir üründen günde tek adet gider', () => {
    // 40 çeyreğin bir anda satılması, oyuncunun bekleme kararını
    // anlamsız kılardı.
    for (let g = 1; g <= 60; g += 1) {
      for (const s of resolveRetailDay(11, g, [poz({ quantity: 40 })]).sales) {
        expect(s.quantity).toBe(1);
      }
    }
  });

  it('satış fiyatı tezin gösterdiği sayıdan türer', () => {
    // Vaat edilenle gerçekleşen aynı olmalı; ikinci bir formül yok.
    const p = poz({ quantity: 1, expectedExitValues: { retail: 12_345 } });
    for (let g = 1; g <= 60; g += 1) {
      for (const s of resolveRetailDay(11, g, [p]).sales) expect(s.price).toBe(12_345);
    }
  });
});
