/**
 * İTİBAR → MÜŞTERİ TRAFİĞİ VE TALEP BİLEŞİMİ
 *
 * GDD 10.1: "Semt/Marka İtibarı → müşteri trafiği, premium segment."
 * Bunun yalnız ikinci yarısı yazılmıştı. Ölçüldü: itibar 20 ile 40
 * arasında müşteri akışı BİREBİR aynıydı; 100 puanlık skalanın içinde tek
 * gerçek basamak vardı (VIP eşiği 60) ve 60 üstü hiçbir şey yapmıyordu.
 *
 * İki yarısı birlikte eklendi ve BİRLİKTE olmaları şart:
 *   · trafik tek başına artsaydı angarya artardı (günlük müşterinin %72'si
 *     rutin, en büyük kova "istediğim mal burada yok")
 *   · bileşim tek başına düzelseydi büyüme hissi olmazdı
 * Ölçüm (20 gün, itibar 42 → 100): günlük müşteri 112 → 138, rutin yük
 * 56,1 → 56,6 (sabit), gerçek karar 55,8 → 81,8 (+%47).
 */

import { describe, expect, it } from 'vitest';
import { DAY, START } from './balance';
import { trafficFactor } from './customer-spawn';
import { stockAffinityPool } from './purchase';

describe('trafik çarpanı', () => {
  it('başlangıç itibarında tam 1,0 — mevcut denge kaymaz', () => {
    // Bu çıpa bilinçli: yeni oyuncu ve eski kayıtlar bugünkü akışı görür.
    expect(trafficFactor(START.reputation)).toBe(1);
  });

  it('itibar verilmezse çarpan uygulanmaz', () => {
    expect(trafficFactor(undefined)).toBe(1);
  });

  it('itibarla birlikte tek yönlü artar', () => {
    const seri = [0, 20, 42, 60, 80, 100].map(trafficFactor);
    for (let i = 1; i < seri.length; i += 1) {
      expect(seri[i]!).toBeGreaterThanOrEqual(seri[i - 1]!);
    }
    expect(trafficFactor(0)).toBeLessThan(1);
    expect(trafficFactor(100)).toBeGreaterThan(1);
  });

  it('bandın dışına çıkmaz', () => {
    // Tavansız trafik oyunu değil angaryayı büyütür; tabansız trafik
    // dükkânı kapatır ve kapanmış dükkân oyun değildir.
    const [lo, hi] = DAY.reputationTrafficRange;
    for (const rep of [-100, 0, 50, 100, 500]) {
      expect(trafficFactor(rep)).toBeGreaterThanOrEqual(lo);
      expect(trafficFactor(rep)).toBeLessThanOrEqual(hi);
    }
  });
});

describe('talebin stoğa kayması', () => {
  const havuz = () => [
    { value: 'quarter_gold', weight: 30 },
    { value: 'half_gold', weight: 12 },
    { value: 'gram_gold_100', weight: 1 },
  ];

  it('stok bilgisi yoksa havuz değişmez', () => {
    expect(stockAffinityPool(havuz(), undefined)).toEqual(havuz());
    expect(stockAffinityPool(havuz(), { templateIds: [], reputation: 90 })).toEqual(havuz());
  });

  it('başlangıç itibarında ve altında kayırma yoktur', () => {
    // Oyunun başında talep bugünkü gibi kör dağılır.
    for (const rep of [0, 20, START.reputation]) {
      expect(stockAffinityPool(havuz(), { templateIds: ['quarter_gold'], reputation: rep })).toEqual(
        havuz(),
      );
    }
  });

  it('itibar yükseldikçe stoktaki kalem daha çok sorulur', () => {
    const az = stockAffinityPool(havuz(), { templateIds: ['half_gold'], reputation: 60 });
    const cok = stockAffinityPool(havuz(), { templateIds: ['half_gold'], reputation: 100 });
    const w = (p: { value: string; weight: number }[]) =>
      p.find((r) => r.value === 'half_gold')!.weight;
    expect(w(az)).toBeGreaterThan(12);
    expect(w(cok)).toBeGreaterThan(w(az));
  });

  it('stokta OLMAYAN kalemin ağırlığı düşürülmez, yalnız payı azalır', () => {
    /*
     * Kayırma bir ELEME değildir: dükkânda olmayan mal hâlâ sorulabilir,
     * yalnız daha seyrek. Aksi hâlde oyuncu stoğunu asla çeşitlendirmezdi
     * ve kaçan talep defteri (demand-log) boşalırdı.
     */
    const sonuc = stockAffinityPool(havuz(), { templateIds: ['quarter_gold'], reputation: 100 });
    const yok = sonuc.find((r) => r.value === 'gram_gold_100')!;
    expect(yok.weight).toBe(1);
    expect(sonuc).toHaveLength(havuz().length);
  });

  it('girdiyi mutasyona uğratmaz', () => {
    const p = havuz();
    stockAffinityPool(p, { templateIds: ['quarter_gold'], reputation: 100 });
    expect(p).toEqual(havuz());
  });
});
