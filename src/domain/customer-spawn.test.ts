/**
 * UPDATEv2 — müşteri üretiminde ad tekilliği.
 *
 * §10 esnaf ağı için "benzersiz kişi üretimi" istiyordu; kuyruk ekranda alt
 * alta dizilince aynı sorun MÜŞTERİDE göründü: iki "Elif Hanım" yan yana,
 * farklı portrelerle. Bu dosya iki sözü tutar — ad tekildir VE tekilliği
 * sağlamak müşterinin geri kalanını değiştirmez.
 */

import { describe, expect, it } from 'vitest';

import { START } from './balance';
import { dayCharacter } from './intent';
import { createMarketForDay } from './market';
import { spawnCustomer } from './customer-spawn';
import type { StoreState } from './types';

const SEED = 20260829;

function createStore(): StoreState {
  return {
    name: 'Test',
    cash: START.cash,
    reputation: START.reputation,
    level: 2,
    xp: 0,
    xpToNext: 580,
    storeTier: 1,
    displaySlots: START.displaySlots,
    backStockSlots: START.backStockSlots,
    workshopCapacity: START.workshopCapacity,
    staff: [],
    supplier: {
      trust: START.supplierTrust,
      limit: START.supplierLimit,
      terms: START.supplierTerms,
      openInvoices: [],
      priceBand: 1,
      specialLotEligibility: false,
    },
    payables: [],
    dailyOverhead: START.dailyOverhead,
  };
}

// ===========================================================================

describe('UPDATEv2 — dükkânda aynı ad iki kez çıkmaz', () => {
  /*
    Kuyruk ekranda alt alta duruyor. İki "Elif Hanım" yan yana çıktığında
    portreleri farklı olsa da oyuncu için ayırt edilemez iki kişi oluyordu.
  */
  const ctx = () => {
    const market = createMarketForDay(SEED, 1);
    const store = createStore();
    return { market, store, character: dayCharacter(SEED, 1, market) };
  };

  it('çekilen ad doluysa havuzda bir sonraki BOŞ ada geçer', () => {
    const { market, store, character } = ctx();
    const taken: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const spawned = spawnCustomer(SEED, i, market, store, character, {}, taken);
      expect(taken, `${i}. müşteri kuyruktaki bir adı tekrarladı`).not.toContain(
        spawned.customer.displayName,
      );
      taken.push(spawned.customer.displayName);
    }
  });

  it('ad yürüyüşü RASTGELELİK AKIŞINI bozmaz — müşteri aynı müşteri kalır', () => {
    /*
      Çakışmayı yeni bir `rng.pick` ile çözmek fazladan bir sayı yerdi ve o
      müşterinin bütçesi, sabrı, rezervasyon fiyatı hepsi kayardı (GDD 28.3).
      Adı DEĞİŞEN müşterinin geri kalan her alanı aynı kalmalı.
    */
    const { market, store, character } = ctx();
    const free = spawnCustomer(SEED, 7, market, store, character, {});
    const forced = spawnCustomer(SEED, 7, market, store, character, {}, [
      free.customer.displayName,
    ]);

    expect(forced.customer.displayName).not.toBe(free.customer.displayName);
    expect(forced.customer.id).toBe(free.customer.id);
    expect(forced.customer.archetype).toBe(free.customer.archetype);
    expect(forced.customer.intent).toBe(free.customer.intent);
    expect(forced.customer.budget).toBe(free.customer.budget);
    expect(forced.customer.reservationPrice).toBe(free.customer.reservationPrice);
    expect(forced.customer.patienceMax).toBe(free.customer.patienceMax);
    expect(forced.items.map((i) => i.templateId)).toEqual(free.items.map((i) => i.templateId));
  });

  it('liste boşken davranış eskisiyle birebir aynıdır', () => {
    const { market, store, character } = ctx();
    const a = spawnCustomer(SEED, 3, market, store, character, {});
    const b = spawnCustomer(SEED, 3, market, store, character, {}, []);
    expect(b.customer.displayName).toBe(a.customer.displayName);
  });
});
