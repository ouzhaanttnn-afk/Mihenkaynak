/**
 * UPDATEv2 §18 — satış kataloğu ile talep havuzunun aynı kapsamda kalması.
 *
 * Bu testler İKİ YÖNLÜDÜR ve ikinci yön birincisi kadar önemlidir:
 *   · satın alma talebi işçilikli ürün İSTEMEMELİ, ama
 *   · işçilikli ürünler satış / ekspertiz / servis akışlarında YAŞAMAYA
 *     DEVAM ETMELİ.
 * Yalnız birincisini test etmek, takıları oyundan tamamen silen bir
 * "düzeltmeyi" yeşil geçirirdi — §18'in açıkça yasakladığı şey.
 */

import { describe, expect, it } from 'vitest';

import { START } from './balance';
import { ITEM_TEMPLATES, getTemplate } from '@data/item-templates';
import { isBullion } from '@data/bullion';
import { spawnCustomer } from './customer-spawn';
import { spawnDemand } from './purchase';
import { dayCharacter } from './intent';
import { createMarketForDay } from './market';
import {
  customerBuyDemandPool,
  weightedBuyDemandPool,
  demandIsSellable,
  sellableTemplates,
  supplierCatalogHas,
  supplierCounterIds,
} from './sales-catalog';
import type { StoreState } from './types';

const SEED = 20260828;

function makeStore(tier = 2): StoreState {
  return {
    name: 'T', cash: START.cash, reputation: START.reputation, level: 3, xp: 0, xpToNext: 900,
    storeTier: tier, displaySlots: START.displaySlots, backStockSlots: START.backStockSlots,
    workshopCapacity: START.workshopCapacity, staff: [],
    supplier: { trust: START.supplierTrust, limit: START.supplierLimit, terms: START.supplierTerms,
      openInvoices: [], priceBand: 1, specialLotEligibility: false },
    payables: [], dailyOverhead: START.dailyOverhead,
  } as StoreState;
}

/** Belgede adı geçen, satın alma talebinde ASLA görünmemesi gereken aileler. */
const CRAFTED_FAMILIES = ['classic', 'stoneSet', 'silver', 'collectible'];

describe('1 — binlerce spawn içinde tek bir işçilikli satın alma talebi yok', () => {
  it('20 gün × 120 müşteri: hiçbir buy talebi işçilikli değil', () => {
    const store = makeStore();
    let buyCount = 0;
    const offenders: string[] = [];

    for (let day = 1; day <= 20; day++) {
      const market = createMarketForDay(SEED, day);
      const character = dayCharacter(SEED, day, market);
      for (let i = 0; i < 120; i++) {
        const c = spawnCustomer(SEED + day, i, market, store, character);
        if (c.customer.intent !== 'buy') continue;
        const d = c.customer.demand;
        buyCount++;
        if (!d) { offenders.push('talepsiz buy müşterisi'); continue; }
        if (!d.templateId || !isBullion(d.templateId)) offenders.push(d.summary);
        if (d.families.length > 0) offenders.push(`aile taşıyor: ${d.summary}`);
      }
    }

    expect(buyCount, 'hiç buy müşterisi üretilmedi — test boş geçmiş olur').toBeGreaterThan(200);
    expect(offenders.slice(0, 5), `${offenders.length} karşılanamaz talep`).toEqual([]);
  });

  it('doğrudan spawnDemand çağrısında da işçilikli çıkmaz', () => {
    const market = createMarketForDay(SEED, 1);
    const character = dayCharacter(SEED, 1, market);
    for (let i = 0; i < 2000; i++) {
      const d = spawnDemand(SEED, i, 'investor', character, 3);
      expect(d.templateId, `#${i}: ${d.summary}`).not.toBeNull();
      expect(isBullion(d.templateId!), `#${i}: ${d.summary}`).toBe(true);
    }
  });
});

describe('2 — her talep oyuncunun tedarik kataloğunda', () => {
  it('üretilen her buy talebi satılabilir', () => {
    const store = makeStore();
    let checked = 0;
    for (let day = 1; day <= 15; day++) {
      const market = createMarketForDay(SEED, day);
      const character = dayCharacter(SEED, day, market);
      for (let i = 0; i < 80; i++) {
        const c = spawnCustomer(SEED + day, i, market, store, character);
        const d = c.customer.demand;
        if (!d) continue;
        expect(demandIsSellable(d.templateId, store.storeTier), d.summary).toBe(true);
        expect(supplierCatalogHas(d.templateId!), d.summary).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('talep havuzu ile tedarik tezgâhı AYNI kümedir', () => {
    for (const tier of [1, 2, 3]) {
      expect(new Set(customerBuyDemandPool(tier))).toEqual(new Set(supplierCounterIds(tier)));
    }
  });
});

describe('3 — kademe kapısı', () => {
  it('kademe 1 oyuncusuna üst kademe SKU sorulmaz', () => {
    const pool = customerBuyDemandPool(1);
    for (const id of pool) {
      expect(getTemplate(id)!.minTier, id).toBeLessThanOrEqual(1);
    }
  });

  it('kademe yükseldikçe havuz daralmaz', () => {
    const t1 = customerBuyDemandPool(1).length;
    const t3 = customerBuyDemandPool(3).length;
    expect(t3).toBeGreaterThanOrEqual(t1);
    expect(t1).toBeGreaterThan(0);
  });

  it('kademe 1 mağazasının müşterisi de yalnız kendi havuzundan ister', () => {
    const store = makeStore(1);
    const allowed = new Set(customerBuyDemandPool(1));
    const market = createMarketForDay(SEED, 3);
    const character = dayCharacter(SEED, 3, market);
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      const c = spawnCustomer(SEED, i, market, store, character);
      const d = c.customer.demand;
      if (!d) continue;
      expect(allowed.has(d.templateId!), d.summary).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('4/5 — kesin SKU eşleşmesi', () => {
  const cases: [string, string[]][] = [
    ['gram_gold_5', ['gram_gold_1', 'gram_gold_10', 'quarter_gold']],
    ['quarter_gold', ['half_gold', 'full_gold', 'gram_gold_1']],
    ['ata_gold', ['full_gold', 'republic_gold']],
  ];

  it('istenen gramaj/SKU dışındaki sarrafiye "exact" sayılmaz', async () => {
    const { matchDemand } = await import('./purchase');
    const { spawnItem } = await import('./item-spawn');
    for (const [wanted, others] of cases) {
      const demand = {
        families: [], wantsBullion: true, templateId: wanted, quantity: 1,
        isBulk: false, acceptsPartial: false, minQuantity: 1,
        summary: wanted, alternativesLabel: '',
      };
      expect(matchDemand(demand, spawnItem(SEED, 1, wanted))).toBe('exact');
      for (const other of others) {
        expect(matchDemand(demand, spawnItem(SEED, 2, other)), `${wanted} ← ${other}`).not.toBe('exact');
      }
    }
  });
});

describe('6 — işçilikli ürünler oyundan SİLİNMEDİ', () => {
  it('takı şablonları hâlâ tanımlı', () => {
    for (const family of CRAFTED_FAMILIES) {
      expect(
        ITEM_TEMPLATES.some((t) => t.family === family),
        `${family} ailesi kaybolmuş`,
      ).toBe(true);
    }
  });

  it('satış / ekspertiz / servis müşterileri hâlâ işçilikli ürün getiriyor', () => {
    const store = makeStore(3);
    const seen: Record<string, number> = { sell: 0, appraisal: 0, service: 0 };
    for (let day = 1; day <= 20; day++) {
      const market = createMarketForDay(SEED, day);
      const character = dayCharacter(SEED, day, market);
      for (let i = 0; i < 100; i++) {
        const c = spawnCustomer(SEED + day, i, market, store, character);
        const intent = c.customer.intent;
        if (intent === 'buy') continue;
        if (c.items.some((it) => !isBullion(it.templateId))) {
          seen[intent] = (seen[intent] ?? 0) + 1;
        }
      }
    }
    expect(seen.sell, 'satış akışında işçilikli ürün kalmamış').toBeGreaterThan(10);
    expect(seen.appraisal, 'ekspertizde işçilikli ürün kalmamış').toBeGreaterThan(0);
    expect(seen.service, 'serviste işçilikli ürün kalmamış').toBeGreaterThan(0);
  });
});

describe('8 — determinizm', () => {
  it('aynı tohum ve sayaç aynı talebi üretir', () => {
    const market = createMarketForDay(SEED, 4);
    const character = dayCharacter(SEED, 4, market);
    for (let i = 0; i < 50; i++) {
      const a = spawnDemand(SEED, i, 'investor', character, 2);
      const b = spawnDemand(SEED, i, 'investor', character, 2);
      expect(b).toEqual(a);
    }
  });

  it('reload benzetimi: aynı müşteri iki kez üretilince aynı talep gelir', () => {
    const store = makeStore();
    const market = createMarketForDay(SEED, 7);
    const character = dayCharacter(SEED, 7, market);
    for (let i = 0; i < 40; i++) {
      const a = spawnCustomer(SEED, i, market, store, character).customer.demand;
      const b = spawnCustomer(SEED, i, market, store, character).customer.demand;
      expect(b?.templateId).toBe(a?.templateId);
      expect(b?.quantity).toBe(a?.quantity);
    }
  });
});

describe('katalog tutarlılığı', () => {
  it('katalogdaki her kimlik gerçek bir şablondur ve sarrafiyedir', () => {
    for (const t of sellableTemplates(3)) {
      expect(getTemplate(t.id), t.id).toBeDefined();
      expect(isBullion(t.id), t.id).toBe(true);
    }
  });

  it('katalog boş değil ve belgede sayılan gramajları taşır', () => {
    const ids = new Set(customerBuyDemandPool(3));
    for (const id of [
      'gram_gold_1', 'gram_gold_2_5', 'gram_gold_5', 'gram_gold_10',
      'gram_gold_20', 'gram_gold_50', 'gram_gold_100',
      'quarter_gold', 'half_gold', 'full_gold', 'republic_gold', 'ata_gold',
    ]) {
      expect(ids.has(id), `${id} katalogda yok`).toBe(true);
    }
  });

  it('işçilikli şablon katalogda YER ALMAZ', () => {
    for (const t of ITEM_TEMPLATES) {
      if (isBullion(t.id)) continue;
      expect(supplierCatalogHas(t.id), `${t.id} katalogda görünüyor`).toBe(false);
      expect(demandIsSellable(t.id, 3), `${t.id} satılabilir görünüyor`).toBe(false);
    }
  });
});

/**
 * TALEP AĞIRLIKLARI — ölçülmüş bir denge hatasının bekçisi.
 *
 * Bulunan hata: talep 22 SKU'ya neredeyse DÜZGÜN dağılıyordu (SKU başına
 * 38–78 istek) ve alıcıların %63'ü eli boş dönüyordu. Düzgün dağılım, küçük
 * bir dükkândan 22 kalemi aynı anda vitrinde tutmasını istiyordu.
 */
describe('talep ağırlıkları', () => {
  it('havuzdaki her kalem bir ağırlık taşır ve hiçbiri sıfır değildir', () => {
    const havuz = weightedBuyDemandPool(1);
    expect(havuz.length).toBe(customerBuyDemandPool(1).length);
    for (const satır of havuz) expect(satır.weight).toBeGreaterThan(0);
  });

  it('çeyrek en sık sorulandır', () => {
    const havuz = weightedBuyDemandPool(1);
    const ceyrek = havuz.find((r) => r.value === 'quarter_gold');
    expect(ceyrek).toBeDefined();
    for (const satır of havuz) {
      if (satır.value !== 'quarter_gold') {
        expect(satır.weight).toBeLessThan(ceyrek!.weight);
      }
    }
  });

  it('ağır bilezik ve büyük külçe seyrek kalır', () => {
    const agirlik = (id: string) =>
      weightedBuyDemandPool(1).find((r) => r.value === id)?.weight ?? 0;
    // Gramaj büyüdükçe alıcı azalır.
    expect(agirlik('investment_bangle_22k_100')).toBeLessThan(agirlik('investment_bangle_22k_10'));
    expect(agirlik('gram_gold_100')).toBeLessThan(agirlik('gram_gold_1'));
  });

  it('birkaç doğru kalem talebin çoğunu karşılar', () => {
    /*
     * ASIL REGRESYON: düzgün dağılımda en iyi 5 kalem talebin ancak
     * %23'ünü (5/22) karşılıyordu — yani doğru stok tutmak imkânsızdı.
     * Ağırlıklardan sonra aynı 5 kalem çoğunluğu karşılamalı.
     */
    const havuz = weightedBuyDemandPool(1);
    const toplam = havuz.reduce((n, r) => n + r.weight, 0);
    const enIyi5 = [...havuz].sort((a, b) => b.weight - a.weight).slice(0, 5);
    const pay = enIyi5.reduce((n, r) => n + r.weight, 0) / toplam;
    expect(pay).toBeGreaterThan(0.5);
  });

  it('bilinmeyen bir SKU havuzdan düşmez, yalnız nadir kalır', () => {
    // Yeni bir ürün eklendiğinde sessizce talep dışı kalmamalı.
    const havuz = weightedBuyDemandPool(1);
    expect(havuz.every((r) => Number.isFinite(r.weight) && r.weight > 0)).toBe(true);
  });
});
