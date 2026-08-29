/**
 * PERAKENDE MAKASI — ölçülmüş bir ekonomi hatasının bekçisi.
 *
 * Bulunan hata: oyuncu toptancıdan aldığı sarrafiyeyi müşteriye KÂRLA
 * satamıyordu. `scaleToFair` kabul eşiğini adil değere sıkıştırıyordu:
 *
 *     müşteri tavanı        adil × 1,235
 *     kabul eşiği (eski)    adil × 1,014
 *     toptancı alış         adil × 1,017     ← eşiğin ÜSTÜNDE
 *
 * Ölçüldü: adil değerin 1,00 katı istenince %63 kabul (zararına), 1,05
 * katı istenince %0. Yani her satış yapısal olarak zarardı.
 *
 * Sebep iki kavramın tek sayıya bağlanmasıydı: `haggleRoom` (müşteriyle
 * oynanan aralık — sarrafta dar, DOĞRU) ve dükkânın alış/satış makası
 * (yapısal kâr — pazarlık konusu değil, EKSİKTİ).
 */

import { describe, expect, it } from 'vitest';
import { TARGET_MARGIN } from './balance';
import { ITEM_TEMPLATES, getTemplate } from '@data/item-templates';
import { isBullion } from '@data/bullion';
import { rulesFor } from '@data/product-classes';
import { supplierCounterIds } from './sales-catalog';

describe('perakende makası', () => {
  it('her ürün sınıfı bir makas taşır ve hiçbiri sıfır değildir', () => {
    for (const t of ITEM_TEMPLATES) {
      expect(rulesFor(t).retailSpread, `${t.id}`).toBeGreaterThan(0);
    }
  });

  it('makas pazarlık payından AYRIDIR', () => {
    /*
     * Sarrafiyede pazarlık payı dar (0,06) ama makas sıfır değil: çeyreğin
     * fiyatı kamuya açıktır, yine de sarraf alış/satış farkıyla yaşar.
     * İkisinin aynı sayı olması tam olarak düzeltilen hataydı.
     */
    const sarrafiye = rulesFor(getTemplate('quarter_gold'));
    expect(sarrafiye.haggleRoom).toBeLessThan(0.5);
    expect(sarrafiye.retailSpread).not.toBe(sarrafiye.haggleRoom);
  });

  it('sarrafiye makası hedef marj bandına oturur', () => {
    // Sayı uydurulmadı: kod zaten %1,5–4 hedefliyordu, pazarlık katmanı
    // bunu %0'a indiriyordu. Makas o hedefi geri getirir.
    const [alt, ust] = TARGET_MARGIN.bullion;
    for (const id of supplierCounterIds(1)) {
      const spread = rulesFor(getTemplate(id)).retailSpread;
      expect(spread, id).toBeGreaterThanOrEqual(alt);
      expect(spread, id).toBeLessThanOrEqual(ust);
    }
  });

  it('işçilikli üründe makas sarrafiyeden geniştir', () => {
    // İkinci el takının fiyatını kimse tam bilmez; sarrafiyeninkini herkes bilir.
    const takı = ITEM_TEMPLATES.find((t) => !isBullion(t.id));
    expect(takı).toBeDefined();
    expect(rulesFor(takı!).retailSpread).toBeGreaterThan(
      rulesFor(getTemplate('quarter_gold')).retailSpread,
    );
  });

  it('toptancıdan alınan sarrafiye kârla satılabilir', () => {
    /*
     * ASIL REGRESYON. Toptancı adil değerin ~1,017 katına satıyor; kabul
     * eşiğinin çıpası bunun ÜSTÜNDE olmalı, yoksa oyuncu her seferinde
     * zarar eder ve "müşteriyle anlaşamıyorum" duvarına toslar.
     */
    const TOPTANCI_ORANI = 1.017;
    for (const id of supplierCounterIds(1)) {
      const cipa = 1 + rulesFor(getTemplate(id)).retailSpread;
      expect(cipa, `${id}: çıpa maliyetin altında`).toBeGreaterThan(TOPTANCI_ORANI);
    }
  });
});
