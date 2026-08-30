/**
 * "GRAM ALTINA BU KADAR İSTENMESİ MANTIKLI MI?" REGRESYONU.
 *
 * Playtest ekran görüntüsü: piyasa 4.345 ₺/g, piyasa referans alış 4.145 ₺/g,
 * dükkânın alış tavanı 4.097 ₺/g iken müşteri 50 gram gram altını 4.782 ₺/g
 * istiyordu — SPOTUN %10 ÜSTÜ. Gerçek hayatta kimse sarrafa gram altını
 * piyasa fiyatının üstüne satmaz; alış < spot < satış ilişkisi kırılmıştı.
 *
 * İKİ AYRI SEBEP ÖLÇÜLDÜ, İKİSİ DE ÜRÜNE KÖRLÜKTEN GELİYORDU:
 *
 *  1. ÇIPA. `scaleToFair` alış yönünde adil değere sıkıştırıyordu. Sarrafiyede
 *     `haggleRoom` 0,06 olduğu için arketip ne olursa olsun kabul eşiği adil
 *     değere yapışıyordu (ölçüm: eşik/adil ortalaması 0,996 — acil nakit
 *     arayanla fırsatçı arasında fark kalmıyordu). Oysa sarraf spottan almaz,
 *     tabelasındaki makas kadar altından alır.
 *
 *  2. KARŞI TEKLİF MARJI. Müşteri eşiğin %14 üstünden açıyordu. İkinci el
 *     bilezikte doğru; tüm alış-satış farkı %4 olan gram altında değil.
 *     Eşik zaten adil değere yapıştığı için ilk karşı teklif adil değerin
 *     1,09 katına çıkıyordu.
 *
 * SONUÇ (12 çekirdek × 20 gün, ölçülmemiş bilgiyle kapanabilir vaka oranı):
 *     ata_gold %0 → %2,5     full_gold %0 → %3,9     gram_gold_50 %20 → %57
 *   tam ölçülmüş bilgiyle:
 *     ata_gold %5 → %100     full_gold %5 → %100     quarter_gold %53 → %95
 *
 * Ölçmek artık işe yarıyor; ölçmeden almak hâlâ zor. Oyunun öğrettiği şey bu.
 */

import { describe, expect, it } from 'vitest';

import { START } from './balance';
import { isBullion } from '@data/bullion';
import { getTemplate } from '@data/item-templates';
import { rulesFor } from '@data/product-classes';
import { bullionUnitValue, marketReferenceBuy } from './channels';
import { spawnCustomer } from './customer-spawn';
import { dayCharacter } from './intent';
import { spawnItem } from './item-spawn';
import { createMarketForDay } from './market';
import { applyMove, createSession, effectiveReservation } from './negotiation';
import { liquidityRatio } from './settlement';
import { effectiveCeiling, thesisFor } from './thesis';
import { estimateBand, initialKnowledge, trueValue } from './valuation';
import type { FieldKnowledge, ItemInstance, MarketState, StoreState, TradeSide } from './types';

const SEED = 20260830;

function makeStore(): StoreState {
  return {
    name: 'Test', cash: START.cash, reputation: START.reputation, level: 3, xp: 0, xpToNext: 900,
    storeTier: 2, displaySlots: START.displaySlots, backStockSlots: START.backStockSlots,
    workshopCapacity: START.workshopCapacity, staff: [],
    supplier: { trust: START.supplierTrust, limit: START.supplierLimit, terms: START.supplierTerms,
      openInvoices: [], priceBand: 1, specialLotEligibility: false },
    payables: [], dailyOverhead: START.dailyOverhead,
  };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/**
 * gameStore · referenceBuyFor ile AYNI formül. Kopya değil, sözleşme:
 * tabelanın makas ORANI kalemin adil değerine uygulanır (kondisyona kör
 * ham tabela fiyatı çıpa yapılamaz — bkz. son test).
 */
function referenceBuyFor(item: ItemInstance, market: MarketState): number | undefined {
  const base = bullionUnitValue(item, market);
  if (base <= 0) return undefined;
  const reference = marketReferenceBuy(item, market, base, 1);
  const fair = trueValue(item, market);
  if (reference <= 0 || fair <= 0) return undefined;
  return Math.round(fair * (reference / base));
}

interface Row {
  templateId: string;
  fair: number;
  ceiling: number;
  threshold: number;
  firstCounter: number;
}

/** Satış niyetli müşterileri gezip alış yönünün sayılarını toplar. */
function sample(measured: boolean): Row[] {
  const store = makeStore();
  const rows: Row[] = [];

  for (let s = 1; s <= 6; s++) {
    const rootSeed = SEED + s * 1000;
    for (let day = 1; day <= 12; day++) {
      const market = createMarketForDay(rootSeed, day);
      const character = dayCharacter(rootSeed, day, market);

      for (let i = 0; i < 30; i++) {
        const c = spawnCustomer(rootSeed + day, i, market, store, character);
        const item = c.items[0];
        if (c.customer.intent !== 'sell' || !item || c.items.length !== 1) continue;
        if (!isBullion(item.templateId)) continue;

        const fair = trueValue(item, market);
        if (fair <= 0) continue;

        const base = initialKnowledge(item);
        const knowledge: FieldKnowledge[] = measured
          ? base.map((f) => ({ ...f, certainty: 1, status: 'verified' as const }))
          : base;

        const options = thesisFor(item, estimateBand(item, market, knowledge), {
          store, market, displayUsed: 0, workshopUsed: 0,
          liquidityRatio: liquidityRatio(store.cash, []),
        });
        const ceiling = effectiveCeiling(options, null);
        if (ceiling <= 0) continue;

        const rules = rulesFor(getTemplate(item.templateId));
        const ctx = {
          customer: c.customer,
          direction: 'shopBuys' as TradeSide,
          reputation: store.reputation,
          buyCeiling: ceiling,
          knowledge: [],
          fairValue: fair,
          haggleRoom: rules.haggleRoom,
          retailSpread: rules.retailSpread,
          referenceBuy: referenceBuyFor(item, market),
        };

        const session = createSession('l', item.id);
        const threshold = effectiveReservation(ctx, session);
        const out = applyMove(session, ctx, {
          kind: 'offer',
          amount: Math.round(ceiling * 0.92),
          atRound: session.round,
        });

        rows.push({
          templateId: item.templateId,
          fair,
          ceiling,
          threshold,
          firstCounter: out.response.counterOffer ?? threshold,
        });
      }
    }
  }
  return rows;
}

describe('Sarrafiyede alış < spot < satış korunur', () => {
  const blind = sample(false);

  it('ölçüm anlamlı bir örneklem üzerinde yapılır', () => {
    expect(blind.length).toBeGreaterThan(300);
  });

  it('müşterinin kabul eşiği adil değerin ALTINDADIR', () => {
    // Eskiden ortalama 0,996 idi: müşteri gram altını spot fiyattan satmak
    // istiyordu. Tabela makası artık eşiğe geçiyor.
    const ratios = blind.map((r) => r.threshold / r.fair);
    expect(mean(ratios), `eşik/adil ${mean(ratios).toFixed(3)}`).toBeLessThan(0.98);
    expect(mean(ratios)).toBeGreaterThan(0.9);
  });

  it('hiçbir sarrafiye müşterisi ilk karşı teklifi adil değerin üstüne koymaz', () => {
    // Ekran görüntüsündeki hata tam olarak buydu: 4.782 ₺/g istenirken
    // piyasa 4.345 ₺/g idi. Eskiden ortalama 1,09 × adil, en kötü ~1,10.
    const over = blind.filter((r) => r.firstCounter > r.fair);
    const worst = Math.max(...blind.map((r) => r.firstCounter / r.fair));
    expect(over.length, `${over.length} vakada karşı teklif adil değeri aştı`).toBe(0);
    expect(worst, `en yüksek karşı teklif ${worst.toFixed(3)} × adil`).toBeLessThanOrEqual(1);
  });

  it('karşı teklif marjı ürünün makasına oturur — %14 değil', () => {
    // Marj `haggleRoom` ile ölçeklenir: sarrafiyede 0,06 × %14 ≈ %0,8.
    const margins = blind.map((r) => r.firstCounter / Math.max(1, r.threshold) - 1);
    expect(mean(margins), `ort. marj %${(mean(margins) * 100).toFixed(2)}`).toBeLessThan(0.02);
  });
});

describe('Ölçmek sarrafiye alışını mümkün kılar', () => {
  it('tam ölçülmüş sarrafiyede vakaların büyük çoğunluğu kapanabilir', () => {
    const rows = sample(true);
    const ok = rows.filter((r) => r.ceiling >= r.threshold).length;
    const share = ok / rows.length;
    // Eskiden ata/tam/yarımda %5 idi — ölçmek işe yaramıyordu.
    expect(share, `kapanabilir %${(share * 100).toFixed(1)}`).toBeGreaterThan(0.9);
  });

  it('ölçmeden almak hâlâ zordur — kolay yol açılmadı', () => {
    const blind = sample(false);
    const measured = sample(true);
    const shareOf = (rows: Row[]) => rows.filter((r) => r.ceiling >= r.threshold).length / rows.length;
    expect(shareOf(measured)).toBeGreaterThan(shareOf(blind) + 0.25);
  });
});

describe('Çıpa tabela fiyatı değil, kalemin gerçek değeridir', () => {
  /*
   * TUZAK: `marketReferenceBuy` KONDİSYONA KÖRDÜR — ölçüm, referans/birim
   * değerinin her kondisyonda sabit (0,951–0,969) olduğunu gösterdi. Ham
   * tabela fiyatı çıpa yapılsaydı, sinyal taşıyan hasarlı bir yarım altınla
   * gelen müşteri gerçek değerinin 1,79 katını isteyebilirdi.
   */
  it('hasarlı sarrafiyede çıpa gerçek değerin üstüne çıkmaz', () => {
    const market = createMarketForDay(SEED, 4);
    let damaged = 0;

    for (const id of ['half_gold', 'ata_gold', 'quarter_gold', 'gram_gold_10']) {
      for (let i = 0; i < 300; i++) {
        const item = spawnItem(SEED, i * 3 + 1, id);
        const flagged =
          item.declared.visibleCondition !== 'pristine' ||
          item.declared.observableSignals.length > 0;
        if (!flagged) continue;
        damaged++;

        const fair = trueValue(item, market);
        const anchor = referenceBuyFor(item, market)!;
        expect(anchor, `${id} hasarlı çıpa ${anchor} > adil ${fair}`).toBeLessThanOrEqual(fair);
      }
    }
    expect(damaged, 'hasarlı örnek bulunamadı').toBeGreaterThan(20);
  });

  it('işçilikli üründe referans yoktur — davranış değişmez', () => {
    const market = createMarketForDay(SEED, 4);
    for (const id of ['ring_18k', 'necklace_14k', 'plated_bangle']) {
      const item = spawnItem(SEED, 11, id);
      expect(referenceBuyFor(item, market), id).toBeUndefined();
    }
  });
});
