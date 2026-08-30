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
