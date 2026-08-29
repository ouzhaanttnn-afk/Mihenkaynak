/**
 * UPDATEv1 §2 — TALEP/ÜRÜN UYUMU VE BEŞ SAVUNMA KATMANI.
 *
 * Canlı denetimin şikâyeti şuydu: ürün kartında "Aradığı değil" yazıyor ama
 * ürün yine de seçilebiliyor, pakete ekleniyor ve pazarlığa geçilebiliyordu.
 * §2 bunun için tek bir arayüz filtresi değil, BEŞ KATMAN istiyor.
 *
 * Bu dosya katmanların ilk üçünü ve merkezî kuralı domain düzeyinde bağlar
 * (4. ve 5. katman store'da yaşadığı için orada, gerçek akışla sınanır).
 */

import { describe, expect, it } from 'vitest';

import { spawnItem } from './item-spawn';
import {
  createPurchaseSession,
  isProductCompatible,
  matchDemand,
  minSaleOffer,
  offerableStock,
  repricePackage,
} from './purchase';
import { createMarketForDay } from './market';
import { spawnCustomer } from './customer-spawn';
import { dayCharacter } from './intent';
import { START } from './balance';
import type { CustomerDemand, InventoryPosition, ItemInstance, StoreState } from './types';

const SEED = 20260828;
const MARKET = createMarketForDay(SEED, 1);
const CHARACTER = dayCharacter(SEED, 1, MARKET);

function makeStore(): StoreState {
  return {
    name: 'T', cash: START.cash, reputation: START.reputation, level: 3, xp: 0, xpToNext: 900,
    storeTier: 2, displaySlots: START.displaySlots, backStockSlots: START.backStockSlots,
    workshopCapacity: START.workshopCapacity, staff: [],
    supplier: { trust: START.supplierTrust, limit: START.supplierLimit, terms: START.supplierTerms,
      openInvoices: [], priceBand: 1, specialLotEligibility: false },
    payables: [], dailyOverhead: START.dailyOverhead,
  } as StoreState;
}

function demandFor(templateId: string, quantity = 1): CustomerDemand {
  return {
    families: [], wantsBullion: true, templateId, quantity,
    isBulk: false, acceptsPartial: false, minQuantity: quantity,
    summary: templateId, alternativesLabel: '',
  };
}

function stockOf(templateIds: string[]): {
  inventory: InventoryPosition[];
  items: Record<string, ItemInstance>;
} {
  const items: Record<string, ItemInstance> = {};
  const inventory: InventoryPosition[] = [];
  templateIds.forEach((templateId, i) => {
    const item = spawnItem(SEED, 700 + i, templateId);
    items[item.id] = item;
    inventory.push({
      itemId: item.id, quantity: 1, costBasis: 10_000, currentValue: 11_000,
      age: 1, demand: 'steady', thesis: null, location: 'display', expectedExitValues: {},
    } as InventoryPosition);
  });
  return { inventory, items };
}

// ===========================================================================

describe('Merkezî uygunluk kuralı', () => {
  it('§2 kabul kriteri: bilezik talebinde gram altın uymaz', () => {
    const d = demandFor('bracelet_22k_thin');
    expect(isProductCompatible(d, spawnItem(SEED, 1, 'gram_gold_1'))).toBe(false);
    expect(isProductCompatible(d, spawnItem(SEED, 2, 'bracelet_22k_thin'))).toBe(true);
  });

  it('§2 kabul kriteri: 5 g talebinde 1 g ve 10 g uymaz', () => {
    const d = demandFor('gram_gold_5');
    for (const other of ['gram_gold_1', 'gram_gold_10', 'gram_gold_2_5']) {
      expect(isProductCompatible(d, spawnItem(SEED, 3, other)), other).toBe(false);
    }
    expect(isProductCompatible(d, spawnItem(SEED, 4, 'gram_gold_5'))).toBe(true);
  });

  it('§2 kabul kriteri: çeyrek talebinde kolye, bilezik ve gram altın uymaz', () => {
    const d = demandFor('quarter_gold');
    for (const other of ['necklace_14k', 'bracelet_22k_thin', 'gram_gold_1']) {
      expect(isProductCompatible(d, spawnItem(SEED, 5, other)), other).toBe(false);
    }
  });

  it('§2 kabul kriteri: 14 ayar kolye talebinde 22 ayar bilezik uymaz', () => {
    const d = demandFor('necklace_14k');
    expect(isProductCompatible(d, spawnItem(SEED, 6, 'bracelet_22k_thin'))).toBe(false);
    expect(isProductCompatible(d, spawnItem(SEED, 7, 'necklace_14k'))).toBe(true);
  });

  it('tam istenen ürün her zaman "exact"tir', () => {
    for (const id of ['gram_gold_5', 'quarter_gold', 'ata_gold', 'necklace_14k']) {
      expect(matchDemand(demandFor(id), spawnItem(SEED, 8, id)), id).toBe('exact');
    }
  });
});

describe('KATMAN 1 — uyumsuz ürün listeye girmez', () => {
  it('karışık stokta yalnız istenen ürün sunulur', () => {
    const d = demandFor('quarter_gold');
    const { inventory, items } = stockOf([
      'quarter_gold', 'gram_gold_1', 'half_gold', 'necklace_14k', 'bracelet_22k_thin',
    ]);
    const rows = offerableStock(d, inventory, items);
    expect(rows).toHaveLength(1);
    expect(items[rows[0]!.position.itemId]!.templateId).toBe('quarter_gold');
    // "Aradığı değil" etiketli satır artık HİÇ üretilmiyor.
    expect(rows.every((r) => r.match !== 'off')).toBe(true);
  });

  it('uygun ürün yoksa liste BOŞ döner — yanlış öneri yapılmaz', () => {
    const d = demandFor('ata_gold');
    const { inventory, items } = stockOf(['gram_gold_1', 'necklace_14k', 'quarter_gold']);
    expect(offerableStock(d, inventory, items)).toEqual([]);
  });
});

describe('KATMAN 3 — uyumsuz kalem değerlemeye girmez', () => {
  it('uyumsuz satır fiyata dönüşmez ve karşılama üretmez', () => {
    const d = demandFor('quarter_gold', 1);
    const { inventory, items } = stockOf(['gram_gold_1', 'necklace_14k']);
    const session = createPurchaseSession(d);
    const lines = Object.keys(items).map((itemId) => ({ itemId, quantity: 1 }));

    const customer = spawnCustomer(SEED, 1, MARKET, makeStore(), CHARACTER).customer;
    const priced = repricePackage(session, lines, items, inventory, customer, MARKET);

    expect(priced.lines).toEqual([]);
    expect(priced.packageFairValue).toBe(0);
    expect(priced.suggestedPrice).toBe(0);
    expect(priced.units).toBe(0);
    expect(priced.fulfilment).toBe('none');
  });

  it('karışık pakette yalnız uyumlu kalem kalır', () => {
    const d = demandFor('quarter_gold', 2);
    const { inventory, items } = stockOf(['quarter_gold', 'gram_gold_1']);
    const ids = Object.keys(items);
    const session = createPurchaseSession(d);
    const customer = spawnCustomer(SEED, 1, MARKET, makeStore(), CHARACTER).customer;

    const priced = repricePackage(
      session, ids.map((itemId) => ({ itemId, quantity: 1 })),
      items, inventory, customer, MARKET,
    );
    expect(priced.lines).toHaveLength(1);
    expect(items[priced.lines[0]!.itemId]!.templateId).toBe('quarter_gold');
    expect(priced.packageFairValue).toBeGreaterThan(0);
  });
});

describe('Gerçek oyunda üretilen talepler bu kuralla tutarlı', () => {
  it('her buy talebi kendi ürünüyle exact, başka sarrafiyeyle off', () => {
    const store = makeStore();
    let checked = 0;
    for (let day = 1; day <= 10; day++) {
      const market = createMarketForDay(SEED, day);
      const character = dayCharacter(SEED, day, market);
      for (let i = 0; i < 60; i++) {
        const c = spawnCustomer(SEED + day, i, market, store, character);
        const d = c.customer.demand;
        if (!d?.templateId) continue;
        expect(matchDemand(d, spawnItem(SEED, 1, d.templateId))).toBe('exact');
        const other = d.templateId === 'quarter_gold' ? 'half_gold' : 'quarter_gold';
        expect(matchDemand(d, spawnItem(SEED, 2, other)), `${d.summary} ← ${other}`).toBe('off');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

/**
 * SATIŞ TEKLİFİ TABANI (§2 ikinci katman).
 *
 * Ölçüldü: taban yalnız arayüz slider'ındaydı. `submitOffer` doğrudan
 * çağrıldığında 768.000 ₺'lik bir altın pozisyonu 3 ₺'ye tertemiz settle
 * oldu — ne uyarı, ne invariant. §2: "yalnızca kullanıcı arayüzünde filtre
 * uygulama."
 */
describe('satış teklifi tabanı', () => {
  it('maliyet ile adil değerin KÜÇÜĞÜNDEN türer', () => {
    // Maliyetin altına düşmüş bir mal, adil değerinden fiyatlanmalı;
    // tersi durumda oyuncu zararını taban sanardı.
    expect(minSaleOffer(1000, 500)).toBe(minSaleOffer(500, 1000));
  });

  it('zararına satma hakkı durur — taban maliyetin ALTINDADIR', () => {
    const maliyet = 10_000;
    expect(minSaleOffer(maliyet, maliyet)).toBeLessThan(maliyet);
    expect(minSaleOffer(maliyet, maliyet)).toBeGreaterThan(0);
  });

  it('bir kuruşluk satışı eler', () => {
    // Asıl regresyon: 768.000 ₺'lik pozisyon 3 ₺'ye gitmişti.
    expect(minSaleOffer(768_000, 768_000)).toBeGreaterThan(3);
  });

  it('değersiz pakette negatife düşmez', () => {
    expect(minSaleOffer(0, 0)).toBe(0);
  });
});
