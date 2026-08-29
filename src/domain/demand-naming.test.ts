/**
 * MÜŞTERİ NE İSTEDİĞİNİ ADIYLA SÖYLER.
 *
 * Playtest: müşteri şeridinde "klasik takı / gümüş arıyor" yazıyordu.
 * Gerçek müşteri aile adı söylemez — "bilezik bakıyorum" der. Sarrafiyede
 * zaten somuttu ("3 adet Çeyrek Altın"); eksik olan işçilikli taraftı.
 *
 * KRİTİK DENGE: somut ad eklemek TALEBİ DARALTMAMALI. Eşleşme aile
 * düzeyinde çalışmaya devam etmeli, yoksa oyuncu yakın bir ürünü sunamaz
 * ve müşteriyi boşuna geri çevirir. Bu dosya ikisini birden sınar.
 */

import { describe, expect, it } from 'vitest';

import { START } from './balance';
import { getTemplate, ITEM_TEMPLATES } from '@data/item-templates';
import { spawnCustomer } from './customer-spawn';
import { dayCharacter } from './intent';
import { spawnItem } from './item-spawn';
import { isBullion } from '@data/bullion';
import { createMarketForDay } from './market';
import { matchDemand } from './purchase';
import { daDe } from '@ui/format';
import type { StoreState } from './types';

const SEED = 20260828;

function makeStore(tier: StoreState['storeTier']): StoreState {
  return {
    name: 'Test', cash: START.cash, reputation: START.reputation, level: 4, xp: 0, xpToNext: 900,
    storeTier: tier, displaySlots: START.displaySlots, backStockSlots: START.backStockSlots,
    workshopCapacity: START.workshopCapacity, staff: [],
    supplier: { trust: START.supplierTrust, limit: START.supplierLimit, terms: START.supplierTerms,
      openInvoices: [], priceBand: 1, specialLotEligibility: false },
    payables: [], dailyOverhead: START.dailyOverhead,
  };
}

/** Belirli bir kademede üretilen tüm alış taleplerini toplar. */
function demands(tier: StoreState['storeTier'] = 3) {
  const store = makeStore(tier);
  const out = [];
  for (let day = 1; day <= 20; day++) {
    const market = createMarketForDay(SEED, day);
    const character = dayCharacter(SEED, day, market);
    for (let i = 0; i < 60; i++) {
      const c = spawnCustomer(SEED + day, i, market, store, character);
      if (c.customer.intent === 'buy' && c.customer.demand) out.push(c.customer.demand);
    }
  }
  return out;
}

// ===========================================================================

describe('Talep somut bir ürün adı taşır', () => {
  const all = demands();

  it('örneklem gerçekten üretildi', () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it('hiçbir talep ürün adı olmadan gelmez', () => {
    for (const d of all) {
      expect(d.templateId, JSON.stringify(d.summary)).not.toBeNull();
    }
  });

  it('özet metninde iç aile adı GEÇMEZ', () => {
    // "bullion", "classic", "stoneSet", "silver", "collectible"
    const leak = /bullion|classic|stoneSet|silver|collectible/;
    for (const d of all) {
      expect(leak.test(d.summary), d.summary).toBe(false);
      expect(leak.test(d.alternativesLabel), d.alternativesLabel).toBe(false);
    }
  });

  it('özet, gerçek bir ürünün görünen adını içerir', () => {
    const names = new Set(ITEM_TEMPLATES.map((t) => t.displayName));
    for (const d of all) {
      const name = getTemplate(d.templateId!)?.displayName;
      expect(names.has(name!), d.summary).toBe(true);
      expect(d.summary).toContain(name!);
    }
  });

  /*
   * UPDATEv2 §18 — BU TEST TERSİNE ÇEVRİLDİ.
   *
   * Eskiden "işçilikli talepte de somut ad var" diye bağlanıyordu ve
   * doğruydu: satın alma müşterisi kolye/bilezik isteyebiliyordu. Ama o
   * talep hiçbir zaman karşılanamıyordu — dükkânın kolye tedarik yolu yok.
   * Artık talep havuzu satış kataloğundan türüyor, dolayısıyla satın alma
   * niyetinde işçilikli talep HİÇ üretilmemeli.
   *
   * Testin koruduğu asıl şey değişmedi: talep somut bir üründür ve tek bir
   * ürüne saplanmaz. Yalnız hangi küme üzerinde ölçüldüğü değişti.
   */
  it('satın alma talebi işçilikli ürün İSTEMEZ', () => {
    const crafted = all.filter((d) => !d.wantsBullion);
    expect(crafted.length, `karşılanamaz talep üretildi: ${crafted.map((d) => d.summary).join(', ')}`).toBe(0);
  });

  it('sarrafiye talebi tek ürüne saplanmaz', () => {
    const distinct = new Set(all.map((d) => d.templateId));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('Somut ad talebi İKAMEYE İZİN VERMEZ', () => {
  /*
   * UPDATEv1 §2 — BU BLOK TERSİNE ÇEVRİLDİ.
   *
   * Eski adı "Somut ad talebi DARALTMAZ" idi ve istenen ürün yerine aynı
   * aileden başkasının sunulabilmesini ('family') koruyordu. §2 bunu açıkça
   * kapatıyor (`allowSubstitution: false`) ve kabul kriteri olarak yazıyor:
   * "5 gram altın talebinde 1 g ve 10 g ürünler görünmüyor."
   *
   * Yani korunan şey artık tersi: müşteri somut bir ürün istediyse BAŞKA
   * hiçbir ürün o talebi karşılamaz.
   */
  it('istenen sarrafiye dışındaki sarrafiye talebi KARŞILAMAZ', () => {
    const bullionDemands = demands().filter((d) => d.wantsBullion);
    expect(bullionDemands.length).toBeGreaterThan(5);

    let checked = 0;
    for (const d of bullionDemands) {
      const sibling = ITEM_TEMPLATES.find((t) => isBullion(t.id) && t.id !== d.templateId);
      if (!sibling) continue;
      const item = spawnItem(SEED, 1, sibling.id);
      expect(matchDemand(d, item), `${d.summary} ← ${sibling.displayName}`).toBe('off');
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('tam istenen ürün hâlâ en iyi eşleşmedir', () => {
    for (const d of demands()) {
      const item = spawnItem(SEED, 2, d.templateId!);
      expect(matchDemand(d, item)).toBe('exact');
    }
  });

  it('yalnız TAM istenen ürün kabul edilir', () => {
    const bullion = demands().filter((d) => d.wantsBullion);
    expect(bullion.length).toBeGreaterThan(5);
    const gram5 = spawnItem(SEED, 3, 'gram_gold_5');
    for (const d of bullion) {
      const expected = d.templateId === 'gram_gold_5' ? 'exact' : 'off';
      expect(matchDemand(d, gram5), `${d.summary} ← 5 g`).toBe(expected);
    }
  });
});

describe('Kademe sınırı korunur', () => {
  it('kademe 1 dükkânının müşterisi üst kademe ürünü sormaz', () => {
    for (const d of demands(1)) {
      const t = getTemplate(d.templateId!);
      expect(t.minTier, `${t.displayName} minTier=${t.minTier}`).toBeLessThanOrEqual(1);
    }
  });
});

// ===========================================================================
// Dil
// ===========================================================================

describe('Türkçe ünlü uyumu', () => {
  it('"da / de" son ünlüye göre seçilir', () => {
    // Kalın ünlüyle biten
    expect(daDe('klasik takı')).toBe('da');
    expect(daDe('koleksiyon')).toBe('da');
    expect(daDe('altın')).toBe('da');
    // İnce ünlüyle biten
    expect(daDe('sarrafiye')).toBe('de');
    expect(daDe('gümüş')).toBe('de');
    expect(daDe('taşlı ürün')).toBe('de');
  });

  it('birden çok aile listelendiğinde SON kelimeye uyar', () => {
    expect(daDe('klasik takı / sarrafiye')).toBe('de');
    expect(daDe('sarrafiye / klasik takı')).toBe('da');
  });

  it('ünlü yoksa çökmez', () => {
    expect(['da', 'de']).toContain(daDe(''));
    expect(['da', 'de']).toContain(daDe('—'));
  });

  it('üretilen her alternatif etiketi için ek seçilebilir', () => {
    for (const d of demands()) {
      if (!d.alternativesLabel) continue;
      expect(['da', 'de']).toContain(daDe(d.alternativesLabel));
    }
  });
});
