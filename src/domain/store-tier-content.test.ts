/**
 * KADEME İÇERİĞİ — her kademe gerçekten bir şey açmalı ve hiçbir şey
 * geri gitmemeli.
 *
 * Ölçülen durum (düzeltmeden önce):
 *
 *   kademe   gelen ürün   satılabilir   paket satırı   vitrin   atölye
 *        1           33            22              2        8        2
 *        2           38            22              3       14        3
 *        3           41            22              4       22        4
 *        4           41            22              5       32        6
 *        5           41            22              3 <-- GERİLEME     6
 *
 * `maxPackageLinesByTier`de kademe 5 yoktu ve `?? 3` varsayılanına
 * düşüyordu. Kademe 5 bugün `inScope: false` olduğu için oyuncu bu duvara
 * çarpmıyor; hata gizliydi ve kademe 5'i açacak kişiyi bekliyordu.
 */

import { describe, expect, it } from 'vitest';
import { PURCHASE } from './balance';
import { STORE_TIERS } from '@data/store-tiers';
import { templatesForTier } from './item-spawn';
import { SERVICE_TYPES } from '@data/service-types';

const TIERS = STORE_TIERS.map((t) => t.tier);

describe('kademe ilerlemesi hiçbir yerde geri gitmez', () => {
  it('paket satırı her kademede tanımlı ve artan', () => {
    let önceki = 0;
    for (const tier of TIERS) {
      const satır = PURCHASE.maxPackageLinesByTier[tier];
      expect(satır, `kademe ${tier} tabloda yok`).toBeDefined();
      expect(satır!, `kademe ${tier} gerileme`).toBeGreaterThanOrEqual(önceki);
      önceki = satır!;
    }
  });

  it('vitrin, arka stok ve atölye kapasitesi geri gitmez', () => {
    let v = 0, a = 0, k = 0;
    for (const t of STORE_TIERS) {
      expect(t.grants.displaySlots, `kademe ${t.tier} vitrin`).toBeGreaterThanOrEqual(v);
      expect(t.grants.backStockSlots, `kademe ${t.tier} arka stok`).toBeGreaterThanOrEqual(a);
      expect(t.grants.workshopCapacity, `kademe ${t.tier} atölye`).toBeGreaterThanOrEqual(k);
      v = t.grants.displaySlots; a = t.grants.backStockSlots; k = t.grants.workshopCapacity;
    }
  });

  it('gelen ürün çeşitliliği geri gitmez', () => {
    let önceki = 0;
    for (const tier of TIERS) {
      const n = templatesForTier(tier).length;
      expect(n, `kademe ${tier}`).toBeGreaterThanOrEqual(önceki);
      önceki = n;
    }
  });
});

describe('kademe 2 ve 3 gerçekten içerik açıyor', () => {
  it('kademe 2 yeni ürün getiriyor', () => {
    // Ölçüldü: +5 (necklace_18k, set_piece_22k, silver_object,
    // small_ingot, stone_ring_entry).
    expect(templatesForTier(2).length).toBeGreaterThan(templatesForTier(1).length);
  });

  it('kademe 3 yeni ürün getiriyor', () => {
    // Ölçüldü: +3 (stone_ring_premium, vintage_brooch, collector_coin).
    expect(templatesForTier(3).length).toBeGreaterThan(templatesForTier(2).length);
  });

  it('taşlı ürün kademeyle çoğalır — taş isteyen servisin şartı budur', () => {
    const taşlı = (tier: number) => templatesForTier(tier).filter((t) => t.hasStone).length;
    expect(taşlı(2)).toBeGreaterThan(taşlı(1));
    expect(taşlı(3)).toBeGreaterThan(taşlı(2));
  });
});

/**
 * VAAT EDİLEN İLE VERİLEN AYNI OLMALI.
 *
 * Yükseltme ekranındaki `unlocks` listesi 220.000 ve 850.000 ₺'lik
 * kararların verildiği yerde durur. Ölçüldüğünde dördü karşılıksızdı:
 * "Randevu" (kodda yok), "İlk çalışan" (sistem yok), "VIP müşteri havuzu"
 * (kademeye değil itibara bağlı) ve "Taşlı ürün" (alınabiliyor ama
 * satılamıyor).
 *
 * Metin serbesttir — ama içindeki SAYILAR kademenin gerçekten verdiğiyle
 * tutmalı. Aşağıdaki testler o bağı kurar: biri değişip diğeri unutulursa
 * test düşer.
 */
describe('kademe vaatleri gerçekle tutuyor', () => {
  const sayilar = (metinler: string[]) =>
    metinler.flatMap((m) => [...m.matchAll(/\d+/g)].map((x) => Number(x[0])));

  it('listede geçen vitrin ve arka stok sayıları gerçek grants ile aynı', () => {
    for (const t of STORE_TIERS) {
      if (!t.inScope) continue;
      const n = sayilar(t.unlocks);
      const vitrinVar = t.unlocks.some((u) => u.includes('Vitrin'));
      if (!vitrinVar) continue;
      expect(n, `kademe ${t.tier}: vitrin ${t.grants.displaySlots} listede yok`).toContain(
        t.grants.displaySlots,
      );
      expect(n, `kademe ${t.tier}: arka stok ${t.grants.backStockSlots} listede yok`).toContain(
        t.grants.backStockSlots,
      );
    }
  });

  it('atölye kapasitesi anıldığı yerde doğru sayıyı taşır', () => {
    for (const t of STORE_TIERS) {
      if (!t.inScope) continue;
      const satır = t.unlocks.find((u) => u.includes('Atölyede'));
      if (!satır) continue;
      expect(satır, `kademe ${t.tier}`).toContain(String(t.grants.workshopCapacity));
    }
  });

  it('paket satırı anıldığı yerde doğru sayıyı taşır', () => {
    for (const t of STORE_TIERS) {
      if (!t.inScope) continue;
      const satır = t.unlocks.find((u) => u.includes('Pakete'));
      if (!satır) continue;
      expect(satır, `kademe ${t.tier}`).toContain(String(PURCHASE.maxPackageLinesByTier[t.tier]));
    }
  });

  it('olmayan sistem vaat edilmez', () => {
    /*
      Bu üç kelime kodda karşılığı olmayan sistemleri anlatıyordu. Biri
      yapılırsa buraya geri konabilir — ama YAPILMADAN ÖNCE değil.
    */
    const yok = ['Randevu', 'çalışan', 'Müzayede', 'laboratuvar'];
    for (const t of STORE_TIERS) {
      if (!t.inScope) continue;
      for (const u of t.unlocks) {
        for (const k of yok) {
          expect(u.toLowerCase(), `kademe ${t.tier}: "${u}"`).not.toContain(k.toLowerCase());
        }
      }
    }
  });

  it('servis türleri kademeye değil SEVİYEYE bağlıdır', () => {
    // "İleri servis" bir kademe açılımı gibi yazılmıştı; gerçekte kapı
    // oyuncu seviyesidir. Liste bu yüzden servis vaat etmez.
    expect(SERVICE_TYPES.every((s) => typeof s.unlockLevel === 'number')).toBe(true);
    for (const t of STORE_TIERS) {
      if (!t.inScope) continue;
      for (const u of t.unlocks) expect(u.toLowerCase()).not.toContain('ileri servis');
    }
  });
});
