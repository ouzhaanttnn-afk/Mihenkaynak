/**
 * UPDATEv2 §8 — stok kalemi eylemleri.
 *
 * Bu testlerin ASIL işi eylemlerin çalıştığını göstermek değil; §14'ün
 * "korunacak mevcut davranışlar" listesini bu iki yeni eylemin ÇİĞNEMEDİĞİNİ
 * göstermek. Konum değiştirmek ve çıkış planı seçmek bir işlem değildir:
 * nakit, defter, gerçekleşmiş kâr ve maliyet tabanı kıpırdamaz.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useGame } from './gameStore';
import { customerBuyDemandPool, supplierCounterIds } from '@domain/sales-catalog';
import { START } from '@domain/balance';
import type { InventoryPosition } from '@domain/types';
import { isBullion } from '@data/bullion';

/** Stoğa gerçek bir kalem koyar — uydurma pozisyon enjekte edilmez. */
function stockOneItem(): string {
  const s = useGame.getState();
  const templateId = supplierCounterIds(s.store.storeTier)[0]!;
  s.buyFromWholesaler(templateId, 1);
  const position = useGame.getState().inventory[0];
  expect(position, 'toptancıdan alım stoğa düşmedi').toBeDefined();
  return position!.itemId;
}

beforeEach(() => {
  useGame.getState().resetGame();
  useGame.setState({ pauseDepth: 0 });
});

describe('moveStock — konum değişikliği işlem DEĞİLDİR', () => {
  it('vitrine taşımak nakde, maliyete ve deftere dokunmaz', () => {
    const itemId = stockOneItem();
    const before = useGame.getState();
    const cash = before.store.cash;
    const applied = before.ledger.appliedTxIds.length;
    const realizedToday = before.ledger.realizedProfitToday;
    const realizedTotal = before.ledger.realizedProfitTotal;
    const cost = before.inventory.find((p) => p.itemId === itemId)!.costBasis;

    useGame.getState().moveStock(itemId, 'display');

    const after = useGame.getState();
    const position = after.inventory.find((p) => p.itemId === itemId)!;
    expect(position.location).toBe('display');
    expect(after.store.cash).toBe(cash);
    expect(after.ledger.appliedTxIds.length).toBe(applied);
    expect(after.ledger.realizedProfitToday).toBe(realizedToday);
    expect(after.ledger.realizedProfitTotal).toBe(realizedTotal);
    expect(position.costBasis).toBe(cost);
    // Adet kaybolmaz: taşımak stok silmez.
    expect(position.quantity).toBeGreaterThan(0);
  });

  it('aynı konuma taşımak hiçbir şey yapmaz', () => {
    const itemId = stockOneItem();
    const current = useGame.getState().inventory.find((p) => p.itemId === itemId)!.location;
    const snapshot = JSON.stringify(useGame.getState().inventory);

    useGame.getState().moveStock(itemId, current === 'display' ? 'display' : 'backStock');

    expect(JSON.stringify(useGame.getState().inventory)).toBe(snapshot);
  });

  it('hedefte aynı yığın varsa BİRLEŞİR; iki ayrı satır bırakmaz', () => {
    /*
      Yığın kimliği konumu da içerir (`stackKey`). Birleştirmeden taşımak
      aynı anahtara sahip iki pozisyon bırakır ve sonraki alımlarda hangi
      satıra ekleneceği belirsizleşir.

      UPDATEv5 SONRASI TEST FİZİKSEL ÜRÜNLE KURULUR.

      Eski hâli toptancıdan gram altın alıp arka stokta yeni bir satır
      arıyordu. v5'te sarrafiye ORTAK HAVUZDA tutuluyor: aynı şablonun
      tamamı tek pozisyondur ve alım mevcut satıra birleşir, arka stokta
      yeni satır oluşmaz (ölçüldü: 3 pozisyon → 3 pozisyon, gram altın
      vitrindeki yığına eklendi). Yani testin ARADIĞI durum sarrafiyede
      artık üretilemiyor. İşçilikli ürün hâlâ ayrılabilir fiziksel kalem
      olduğu için birleştirme kuralının asıl konusu odur.
    */
    const base = useGame.getState();

    /*
      SENARYO ELLE KURULUR: aynı sarrafiye şablonundan biri VİTRİNDE, biri
      ARKA STOKTA iki pozisyon. `stackKey` konumu içerdiği için bunlar iki
      ayrı yığındır; taşıma onları birleştirmek zorundadır.

      İşçilikli ürün bu testin konusu OLAMAZ: `stackKey` sarrafiye dışında
      null döner, yani takı hiç birleşmez (ayrılabilir fiziksel kalemdir) —
      ölçüldü, iki yüzük taşımadan sonra iki satır olarak kaldı ve bu doğru
      davranıştır.
    */
    const displayed = base.inventory.find((p) => {
      const item = base.items[p.itemId];
      return p.location === 'display' && !!item && isBullion(item.templateId);
    });
    expect(displayed, 'açılış vitrininde sarrafiye yok').toBeDefined();

    const source = base.items[displayed!.itemId]!;
    const twin = { ...source, id: `${source.id}_twin` };

    useGame.setState({
      items: { ...base.items, [twin.id]: twin },
      inventory: [
        ...base.inventory,
        {
          itemId: twin.id,
          quantity: 2,
          costBasis: 12_000,
          currentValue: 13_000,
          demand: 'steady',
          thesis: null,
          location: 'backStock',
          expectedExitValues: {},
          age: 5,
        } as InventoryPosition,
      ],
      store: { ...base.store, displaySlots: 20 },
    });

    const sameTemplate = (loc: 'display' | 'backStock') =>
      useGame
        .getState()
        .inventory.filter(
          (p) =>
            p.location === loc &&
            useGame.getState().items[p.itemId]?.templateId === source.templateId,
        );

    expect(sameTemplate('display')).toHaveLength(1);
    expect(sameTemplate('backStock')).toHaveLength(1);

    const totalBefore = useGame.getState().inventory.reduce((n, p) => n + p.quantity, 0);
    const costBefore = useGame.getState().inventory.reduce((n, p) => n + p.costBasis, 0);

    useGame.getState().moveStock(twin.id, 'display');

    const inv = useGame.getState().inventory;
    // İki yığın vitrinde buluşur; aynı anahtarla iki satır kalmaz.
    expect(sameTemplate('display')).toHaveLength(1);
    // Adet ve maliyet KORUNUR — birleşme kaybetmez.
    expect(inv.reduce((n, p) => n + p.quantity, 0)).toBe(totalBefore);
    expect(inv.reduce((n, p) => n + p.costBasis, 0)).toBeCloseTo(costBefore, 6);
    // Yaşta ESKİ olan kazanır: ölü stok uyarısı taşımayla silinmez.
    expect(sameTemplate('display')[0]!.age).toBe(Math.max(displayed!.age, 5));

    /*
      KURULUMU GERİ AL. `resetGame` belleği temizlemediği için enjekte edilen
      pozisyon sonraki testlerin servet ve katalog beklentilerini bozuyordu
      (ölçüldü: "mal BEDAVA değil" testi 1.022.000 ₺ görüyordu).
    */
    useGame.setState({ items: base.items, inventory: base.inventory, store: base.store });
  });

  it('vitrin doluysa taşımaz ve stoğu bozmaz', () => {
    const itemId = stockOneItem();
    // Kapasiteyi sıfırlamak, "dolu" durumunu kurmanın en kısa yolu.
    useGame.setState({ store: { ...useGame.getState().store, displaySlots: 0 } });
    const snapshot = JSON.stringify(useGame.getState().inventory);

    useGame.getState().moveStock(itemId, 'display');

    expect(JSON.stringify(useGame.getState().inventory)).toBe(snapshot);
  });
});

describe('setStockThesis — plan yalnız MARK değerini değiştirir', () => {
  it('plan etiketi yazılır ve bugünkü değer o kanala oturur', () => {
    const itemId = stockOneItem();
    const position = useGame.getState().inventory.find((p) => p.itemId === itemId)!;
    const channels = Object.keys(position.expectedExitValues);
    expect(channels.length, 'kanal hesabı oluşmamış').toBeGreaterThan(0);

    const channel = channels[0] as keyof typeof position.expectedExitValues;
    useGame.getState().setStockThesis(itemId, channel);

    const after = useGame.getState().inventory.find((p) => p.itemId === itemId)!;
    expect(after.thesis).toBe(channel);
    // Mark seçili kanalın beklenen netidir (adetle çarpılı).
    expect(after.currentValue).toBeCloseTo(
      (after.expectedExitValues[channel] ?? 0) * after.quantity,
      6,
    );
  });

  it('plan değişikliği nakde, maliyet tabanına ve gerçekleşmiş kâra dokunmaz', () => {
    const itemId = stockOneItem();
    const before = useGame.getState();
    const cash = before.store.cash;
    const realizedToday = before.ledger.realizedProfitToday;
    const realizedTotal = before.ledger.realizedProfitTotal;
    const applied = before.ledger.appliedTxIds.length;
    const cost = before.inventory.find((p) => p.itemId === itemId)!.costBasis;

    const channels = Object.keys(
      before.inventory.find((p) => p.itemId === itemId)!.expectedExitValues,
    );
    for (const channel of channels) {
      useGame.getState().setStockThesis(itemId, channel as never);
    }

    const after = useGame.getState();
    expect(after.store.cash).toBe(cash);
    expect(after.ledger.realizedProfitToday).toBe(realizedToday);
    expect(after.ledger.realizedProfitTotal).toBe(realizedTotal);
    expect(after.ledger.appliedTxIds.length).toBe(applied);
    expect(after.inventory.find((p) => p.itemId === itemId)!.costBasis).toBe(cost);
  });
});

describe('§8 — satış rotası yalnız gezinmedir', () => {
  it('rota işareti sekmeyi değiştirir, ekonomiye dokunmaz', () => {
    const before = useGame.getState();
    const cash = before.store.cash;
    const inventory = JSON.stringify(before.inventory);

    useGame.getState().openBusinessRoute('wholesaler');

    const after = useGame.getState();
    expect(after.tab).toBe('business');
    expect(after.pendingBusinessRoute).toBe('wholesaler');
    expect(after.store.cash).toBe(cash);
    expect(JSON.stringify(after.inventory)).toBe(inventory);
  });

  it('işaret tüketilince silinir — İşletme her açılışta rotaya düşmez', () => {
    useGame.getState().openBusinessRoute('network');
    useGame.getState().consumeBusinessRoute();
    expect(useGame.getState().pendingBusinessRoute).toBeNull();
  });
});

// ===========================================================================
// SAHA DEFTERİ B9 — açılış vitrini
// ===========================================================================

describe('Dükkân boş açılmaz ama servet de değişmez', () => {
  it('yeni oyunda vitrinde mal vardır', () => {
    /*
      Ölçüldü: on yeni oyunun ikisinde ilk müşteri "almak istiyorum" dedi ve
      stok sıfırdı. Oyuncunun ilk eylemi müşteriyi geri çevirmek oluyordu.
    */
    const s = useGame.getState();
    const vitrin = s.inventory.filter((p) => p.location === 'display');
    expect(vitrin.length, 'açılış vitrini boş').toBeGreaterThan(0);
    expect(vitrin.reduce((n, p) => n + p.quantity, 0)).toBeGreaterThan(0);
  });

  it('mal BEDAVA değil — bedeli başlangıç nakdinden düşülmüş', () => {
    /*
      Açılış stoğu sermayeyi ARTIRMAZ, biçimini değiştirir. Nakit + stok
      maliyeti, eski başlangıç nakdine eşit kalmalı; aksi hâlde oyuncuya
      sessizce para verilmiş olurdu.
    */
    const s = useGame.getState();
    const stokMaliyeti = s.inventory.reduce((n, p) => n + p.costBasis, 0);
    expect(s.store.cash + stokMaliyeti).toBeCloseTo(START.cash, 0);
    expect(s.store.cash).toBeLessThan(START.cash);
  });

  it('açılış malı SATILABİLİR kataloğun içindedir', () => {
    // Satılamayacak bir malla başlamak, ilk günü çözümsüz kılardı.
    const s = useGame.getState();
    const havuz = customerBuyDemandPool(s.store.storeTier);
    for (const p of s.inventory) {
      const templateId = s.items[p.itemId]?.templateId;
      expect(havuz, `${templateId} satılabilir katalogda yok`).toContain(templateId);
    }
  });

  it('açılış stoğu defterde İŞLEM olarak görünmez', () => {
    // Kepenk açmak bir alım değildir; gerçekleşmiş kâr ve işlem sayısı sıfır.
    const s = useGame.getState();
    expect(s.ledger.realizedProfitTotal).toBe(0);
    expect(s.ledger.deals).toHaveLength(0);
  });
});
