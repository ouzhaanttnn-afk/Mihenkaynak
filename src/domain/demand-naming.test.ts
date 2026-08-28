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

  it('işçilikli talepte de somut ad var ve kaç çeşit ürün adı geçtiği bir sabit değil', () => {
    const crafted = all.filter((d) => !d.wantsBullion);
    expect(crafted.length).toBeGreaterThan(5);
    const distinct = new Set(crafted.map((d) => d.templateId));
    // Tek bir ürüne saplanmış olsaydı "somut" değil "sabit" olurdu.
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('Somut ad talebi DARALTMAZ', () => {
  it('istenen ürünün ailesinden başka bir ürün de talebi karşılar', () => {
    const crafted = demands().filter((d) => !d.wantsBullion && d.families.length > 0);
    expect(crafted.length).toBeGreaterThan(5);

    let checked = 0;
    for (const d of crafted) {
      // Aynı aileden AMA farklı bir şablon bul.
      const sibling = ITEM_TEMPLATES.find(
        (t) => d.families.includes(t.family) && t.id !== d.templateId,
      );
      if (!sibling) continue;
      const item = spawnItem(SEED, 1, sibling.id);
      // 'off' olsaydı oyuncu yakın ürünü sunamazdı.
      expect(matchDemand(d, item), `${d.summary} ← ${sibling.displayName}`).toBe('family');
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

  it('sarrafiye talebinde her sarrafiye kabul edilir', () => {
    const bullion = demands().filter((d) => d.wantsBullion);
    expect(bullion.length).toBeGreaterThan(5);
    const other = spawnItem(SEED, 3, 'gram_gold_5');
    for (const d of bullion) {
      expect(['exact', 'family']).toContain(matchDemand(d, other));
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
