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
import { supplierCounterIds } from '@domain/sales-catalog';

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
    */
    const s = useGame.getState();
    const templateId = supplierCounterIds(s.store.storeTier)[0]!;

    s.buyFromWholesaler(templateId, 2);
    const first = useGame.getState().inventory[0]!;
    useGame.getState().moveStock(first.itemId, 'display');

    // İkinci alım arka stoğa düşer: aynı ürün, farklı konum → ayrı yığın.
    useGame.getState().buyFromWholesaler(templateId, 3);
    const back = useGame
      .getState()
      .inventory.find((p) => p.location === 'backStock' && p.itemId !== first.itemId);
    expect(back, 'ikinci alım arka stoğa düşmedi').toBeDefined();

    const totalBefore = useGame.getState().inventory.reduce((n, p) => n + p.quantity, 0);
    const costBefore = useGame.getState().inventory.reduce((n, p) => n + p.costBasis, 0);

    useGame.getState().moveStock(back!.itemId, 'display');

    const inv = useGame.getState().inventory;
    const onDisplay = inv.filter((p) => p.location === 'display');
    expect(onDisplay).toHaveLength(1);
    // Adet ve maliyet KORUNUR — birleşme kaybetmez.
    expect(inv.reduce((n, p) => n + p.quantity, 0)).toBe(totalBefore);
    expect(inv.reduce((n, p) => n + p.costBasis, 0)).toBeCloseTo(costBefore, 6);
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
