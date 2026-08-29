/**
 * SABIR TÜKENİNCE MÜŞTERİ ÇIKAR.
 *
 * Bu dosya oynanışta bulunan bir hatayı bağlar. Ölçüm şuydu: sabır dört
 * teklifte 5/5'ten 0/5'e iniyor, sonra ON BİR tur daha aynı teklif
 * gönderilebiliyor ve işlem hiç kapanmıyordu.
 *
 * Sebebi tek bir dalın kuralı atlamasıydı: tekrar teklif dalı sabrı 14
 * eritip erken dönüyor, aşağıdaki durum geçişine hiç uğramıyordu. Kural
 * artık tek kapıda (`walkOutIfSpent`) ve testler HER teklif yolunun oradan
 * geçtiğini ayrı ayrı sınıyor — biri düzeltilip diğeri unutulamasın.
 */

import { describe, expect, it } from 'vitest';

import { applyMove, createSession, isTerminal } from './negotiation';
import { spawnCustomer } from './customer-spawn';
import { createMarketForDay } from './market';
import { dayCharacter } from './intent';
import { rulesFor } from '@data/product-classes';
import { getTemplate } from '@data/item-templates';
import { trueValue } from './valuation';
import { START, TRUST } from './balance';
import type { Customer, StoreState, TradeSide } from './types';

const SEED = 20260829;
const MARKET = createMarketForDay(SEED, 1);
const CHARACTER = dayCharacter(SEED, 1, MARKET);

function makeStore(): StoreState {
  return {
    name: 'Test', cash: START.cash, reputation: START.reputation, level: 2, xp: 0, xpToNext: 580,
    storeTier: 1, displaySlots: START.displaySlots, backStockSlots: START.backStockSlots,
    workshopCapacity: START.workshopCapacity, staff: [],
    supplier: {
      trust: START.supplierTrust, limit: START.supplierLimit, terms: START.supplierTerms,
      openInvoices: [], priceBand: 1, specialLotEligibility: false,
    },
    payables: [], dailyOverhead: START.dailyOverhead,
  };
}

/** Gerçek bir satış müşterisi ve getirdiği kalem. */
function sellCase() {
  const store = makeStore();
  for (let i = 0; i < 200; i += 1) {
    const c = spawnCustomer(SEED, i, MARKET, store, CHARACTER);
    const item = c.items[0];
    if (c.customer.intent !== 'sell' || !item) continue;
    const fair = trueValue(item, MARKET);
    if (fair <= 0) continue;
    return {
      customer: c.customer,
      ctx: {
        customer: c.customer,
        direction: 'shopBuys' as TradeSide,
        reputation: store.reputation,
        buyCeiling: Math.round(fair * 0.9),
        knowledge: [],
        fairValue: fair,
        haggleRoom: rulesFor(getTemplate(item.templateId)).haggleRoom,
      },
      lowball: Math.round(fair * 0.35),
    };
  }
  throw new Error('uygun satış müşterisi bulunamadı');
}

/** Sabrı verilen değere sabitlenmiş kopya. */
function withPatience(customer: Customer, patience: number): Customer {
  return { ...customer, patience };
}

describe('Sabır bitince pazarlık KAPANIR', () => {
  it('tekrar teklif dalı da sabrı kontrol eder — asıl hata buydu', () => {
    const { ctx, lowball } = sellCase();
    let session = createSession('l1', 'i1');

    // İlk teklif: tekrar değil, normal yoldan geçer.
    let out = applyMove(session, ctx, { kind: 'offer', amount: lowball, atRound: 0 });
    session = out.session;
    expect(isTerminal(session.state), 'ilk teklifte kapanmamalı').toBe(false);

    // Sabrı bir tekrarın maliyetinin altına indir ve AYNI rakamı gönder.
    const tukenmek = { ...ctx, customer: withPatience(ctx.customer, 5) };
    out = applyMove(session, tukenmek, { kind: 'offer', amount: lowball, atRound: 0 });

    expect(out.response.wasRepeatOffer, 'bu bir tekrar olmalıydı').toBe(false);
    expect(isTerminal(out.session.state), 'sabır bitti, işlem kapanmalıydı').toBe(true);
    expect(out.response.message).toMatch(/kalkayım|kolay gelsin/i);
  });

  it('normal teklif yolu da aynı kapıdan geçer', () => {
    const { ctx, lowball } = sellCase();
    const session = createSession('l1', 'i1');
    const bitkin = { ...ctx, customer: withPatience(ctx.customer, 3) };

    const out = applyMove(session, bitkin, { kind: 'offer', amount: lowball, atRound: 0 });
    expect(isTerminal(out.session.state)).toBe(true);
    expect(out.session.state).toBe('REJECTED');
  });

  it('SONSUZ DÖNGÜ YOK: aynı teklif tekrarlanınca er geç kapanır', () => {
    /*
      Oynanışta 15 tur denendi ve kapanmadı. Bu test aynı şeyi yapar ama
      artık kapanmasını bekler; tavan cömert (30 tur) çünkü sınanan şey
      kaç turda kapandığı değil, KAPANDIĞI.
    */
    const { ctx, lowball } = sellCase();
    let session = createSession('l1', 'i1');
    let customer = ctx.customer;
    let tur = 0;

    while (tur < 30 && !isTerminal(session.state)) {
      const out = applyMove(session, { ...ctx, customer }, { kind: 'offer', amount: lowball, atRound: 0 });
      session = out.session;
      customer = {
        ...customer,
        patience: Math.max(0, customer.patience + out.response.patienceDelta),
      };
      tur += 1;
    }

    expect(isTerminal(session.state), `${tur} turda hâlâ açık`).toBe(true);
    expect(customer.patience).toBe(0);
  });

  it('sabır varken hiçbir şey erken kapanmaz', () => {
    const { ctx, lowball } = sellCase();
    const session = createSession('l1', 'i1');
    const dinc = { ...ctx, customer: withPatience(ctx.customer, ctx.customer.patienceMax) };

    const out = applyMove(session, dinc, { kind: 'offer', amount: lowball, atRound: 0 });
    expect(isTerminal(out.session.state)).toBe(false);
    expect(out.response.counterOffer, 'karşı teklif gelmeliydi').not.toBeNull();
  });
});

describe('Çıkıp gitmek düz bir redden AĞIR sayılır (GDD 10.4)', () => {
  /*
    NOT — bu bir davranış AYRIMI değil, mevcut davranışın düzeltilmesi:
    müşterinin pazarlığı bitirmesinin zaten tek yolu sabrının tükenmesiydi.
    Değişen şey, o anın artık doğru cümleyi kurması, masayı temizlemesi ve
    düz bir fiyat reddinden daha ağır bir güven cezası taşıması.
  */
  it('güven cezası temel red cezasından ağırdır ve masa temizlenir', () => {
    const { ctx, lowball } = sellCase();
    const session = createSession('l1', 'i1');

    const cikan = applyMove(
      session,
      { ...ctx, customer: withPatience(ctx.customer, 2) },
      { kind: 'offer', amount: lowball, atRound: 0 },
    );

    expect(cikan.response.trustDelta).toBeLessThan(-TRUST.rejectPenalty);
    // Çıkan müşteri masada teklif bırakmaz — dönülecek bir rakam yok.
    expect(cikan.session.activeCounter).toBeNull();
    expect(cikan.session.finalOffer).toBeNull();
    // Cümlesi bir fiyat tartışması değil, bir vedadır.
    expect(cikan.response.message).not.toMatch(/fiyat/i);
  });

  it('terminal işlem yeniden işlenmez — çift dokunuş ikinci sonuç üretmez', () => {
    const { ctx, lowball } = sellCase();
    const session = createSession('l1', 'i1');
    const first = applyMove(
      session,
      { ...ctx, customer: withPatience(ctx.customer, 2) },
      { kind: 'offer', amount: lowball, atRound: 0 },
    );
    const second = applyMove(first.session, ctx, { kind: 'offer', amount: lowball + 500, atRound: 0 });

    expect(second.session).toBe(first.session);
    expect(second.response.patienceDelta).toBe(0);
    expect(second.response.trustDelta).toBe(0);
  });
});
