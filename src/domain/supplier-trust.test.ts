/**
 * TOPTANCI GÜVENİ — kademe ağacını kilitleyen hatanın bekçisi.
 *
 * BULUNAN HATA: güven YALNIZ vadeli borcu zamanında ödeyince büyüyordu.
 * Ama `financeTerms` nakdi ÖNCE harcar: parası olan oyuncu hiç vade açmaz,
 * fatura oluşmaz, `repayInvoice` hiç çalışmaz ve güven başlangıç değeri
 * 50'de sonsuza dek donar. Kademe 2 ise 58 ister.
 *
 * Sonuç tersine dönmüştü: oyuncu ne kadar iyi oynarsa o kadar çok nakdi
 * olur, o kadar hiç borçlanmaz, o kadar KALICI OLARAK kilitli kalırdı.
 * 120 günlük simülasyonda net servet 5,4 milyona çıkıyor, 7 kademe
 * kapısından 6'sı açılıyor ve oyun kademe 1'de kalıyordu — tek sebep buydu.
 *
 * Düzeltmeden sonra aynı simülasyonda kademe 2 gün 3'te açıldı ve kademe 3
 * doğru yerden tıkadı: net servet (ekonomik hedef) ve güven tavanı (kredi
 * ilişkisi kurma zorunluluğu).
 */

import { describe, expect, it } from 'vitest';
import { WHOLESALE } from './balance';
import { tradeTrustAfterPurchase } from './wholesaler';
import { STORE_TIERS } from '@data/store-tiers';
import type { SupplierAccount } from './types';

const hesap = (trust: number): SupplierAccount =>
  ({ trust, limit: 40_000, termDays: 3, openInvoices: [] }) as unknown as SupplierAccount;

const LIMIT = 40_000;
/** Asgari payı geçen, "anlamlı" bir alışveriş. */
const BUYUK = LIMIT * WHOLESALE.tradeTrustMinShare + 1;

describe('düzenli ticaret güveni büyütür', () => {
  it('anlamlı alışveriş güveni artırır', () => {
    // ASIL REGRESYON: bu satır olmadan nakitle çalışan oyuncu hiç ilerleyemez.
    expect(tradeTrustAfterPurchase(hesap(50), BUYUK, LIMIT).trust).toBeGreaterThan(50);
  });

  it('küçük alışverişi tekrarlayarak güven biriktirilemez', () => {
    // 1 gram altını 15 kez almak bir strateji değil, sömürüdür.
    const kucuk = LIMIT * WHOLESALE.tradeTrustMinShare - 1;
    let h = hesap(50);
    for (let i = 0; i < 20; i += 1) h = tradeTrustAfterPurchase(h, kucuk, LIMIT);
    expect(h.trust).toBe(50);
  });

  it('tavanı aşmaz — nakit ilişkisi kredi güveninin yerine geçmez', () => {
    let h = hesap(50);
    for (let i = 0; i < 200; i += 1) h = tradeTrustAfterPurchase(h, BUYUK, LIMIT);
    expect(h.trust).toBe(WHOLESALE.tradeTrustCap);
  });

  it('tavana ulaşmış hesap ticaretle daha ileri gitmez', () => {
    const dolu = hesap(WHOLESALE.tradeTrustCap);
    expect(tradeTrustAfterPurchase(dolu, BUYUK, LIMIT).trust).toBe(WHOLESALE.tradeTrustCap);
  });

  it('girdiyi mutasyona uğratmaz', () => {
    const h = hesap(50);
    tradeTrustAfterPurchase(h, BUYUK, LIMIT);
    expect(h.trust).toBe(50);
  });
});

describe('tavan kademe eşikleriyle tutarlı', () => {
  const esik = (tier: number) =>
    STORE_TIERS.find((t) => t.tier === tier)?.requires?.supplierTrust ?? 0;

  it('nakitle çalışan oyuncu kademe 2 kapısını açabilir', () => {
    // Kilidin açılması bu testin varlık sebebi.
    expect(WHOLESALE.tradeTrustCap).toBeGreaterThanOrEqual(esik(2));
  });

  it('üst kademeler gerçekten vade ilişkisi ister', () => {
    /*
     * Tavan kademe 3'ün eşiğinin ALTINDA olmalı: yoksa kredi mekaniği
     * (vade al, zamanında öde) oyunda hiç gerekmez ve ölü kalır.
     */
    expect(WHOLESALE.tradeTrustCap).toBeLessThan(esik(3));
    expect(WHOLESALE.tradeTrustCap).toBeLessThan(esik(4));
  });

  it('ticaret katkısı kredi ödülünden küçüktür', () => {
    // Kredi daha hızlı yol olmalı; nakit güvenli ama yavaş.
    expect(WHOLESALE.tradeTrustGain).toBeLessThan(WHOLESALE.onTimeTrustGain);
  });
});
