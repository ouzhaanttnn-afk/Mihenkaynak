/**
 * UPDATEv3 — 22 ayar işçiliksiz yatırım bileziği ve dükkân adı.
 *
 * Bu dosyanın işi yalnız "yeni şey çalışıyor" demek değil; UPDATEv3'ün
 * YASAKLARININ da tutulduğunu göstermek. Kabul kriterleri iki yönlüdür:
 * neyin girdiği kadar neyin GİRMEDİĞİ de sınanır.
 */

import { describe, expect, it } from 'vitest';

import {
  ITEM_TEMPLATES,
  PLAIN_BRACELET_GRAMS,
  getTemplate,
  plainBraceletId,
} from '@data/item-templates';
import { bullionMeta, isBullion } from '@data/bullion';
import {
  customerBuyDemandPool,
  sellableToCustomer,
  supplierCounterIds,
} from './sales-catalog';
import { HAS_PURITY, tlToHasGrams } from './channels';
import { hasGold } from '@ui/format';
import {
  DEFAULT_JEWELER_NAME,
  NAME_MAX,
  SHOP_SUFFIX,
  checkJewelerName,
  normalizeProfile,
  shopDisplayName,
  stripShopSuffix,
} from './profile';

const TIER = 1;

// ===========================================================================
// §1 — 22 AYAR İŞÇİLİKSİZ YATIRIM BİLEZİĞİ
// ===========================================================================

describe('§1 — bilezik satılabilir kataloğa girer', () => {
  it('10 gramın katı olan her gramaj satılabilir', () => {
    for (const g of PLAIN_BRACELET_GRAMS) {
      const template = getTemplate(plainBraceletId(g));
      expect(sellableToCustomer(template, TIER), `${g} g satılabilir değil`).toBe(true);
    }
  });

  it('10 g ile 100 g arası, tam on adet gramaj destekleniyor', () => {
    expect([...PLAIN_BRACELET_GRAMS]).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('tedarik tezgâhında ve talep havuzunda ikisi de görünür', () => {
    const counter = supplierCounterIds(TIER);
    const demand = customerBuyDemandPool(TIER);
    for (const g of PLAIN_BRACELET_GRAMS) {
      expect(counter, `${g} g tezgâhta yok`).toContain(plainBraceletId(g));
      expect(demand, `${g} g talep havuzunda yok`).toContain(plainBraceletId(g));
    }
  });

  it('sarrafiye sayılır — yani mevcut fiyat/kanal motorunu kullanır', () => {
    for (const g of PLAIN_BRACELET_GRAMS) {
      expect(isBullion(plainBraceletId(g))).toBe(true);
    }
  });
});

describe('§1 — kurallar ürünün kendisinde tutuluyor', () => {
  it('yalnız 22 ayar', () => {
    for (const g of PLAIN_BRACELET_GRAMS) {
      expect(getTemplate(plainBraceletId(g)).nominalKarat).toBe('22K');
      expect(bullionMeta(plainBraceletId(g))!.unitPurity).toBeCloseTo(0.916, 3);
    }
  });

  it('işçilik değeri SIFIR ve işçilik primi SIFIR', () => {
    for (const g of PLAIN_BRACELET_GRAMS) {
      expect(getTemplate(plainBraceletId(g)).craftsmanshipRatioBand).toEqual([0, 0]);
      expect(bullionMeta(plainBraceletId(g))!.premiumRatio).toBe(0);
    }
  });

  it('gramaj SABİT — bant açık uçlu değil, tek değer', () => {
    for (const g of PLAIN_BRACELET_GRAMS) {
      const t = getTemplate(plainBraceletId(g));
      expect(t.weightBand).toEqual([g, g]);
      expect(bullionMeta(plainBraceletId(g))!.unitWeightGrams).toBe(g);
      // Net metal = brüt: taş yok, aksesuar yok.
      expect(t.netRatioBand).toEqual([1, 1]);
      expect(t.hasStone).toBe(false);
    }
  });
});

describe('§1 — YASAKLAR', () => {
  it('10un katı olmayan hiçbir gramaj üretilmez', () => {
    for (const g of PLAIN_BRACELET_GRAMS) expect(g % 10).toBe(0);
    // Uydurma gramajlar şablon tablosunda hiç yok.
    for (const bad of [5, 15, 25, 33, 75.5, 110]) {
      expect(
        ITEM_TEMPLATES.some((t) => t.id === plainBraceletId(bad)),
        `${bad} g şablonu var`,
      ).toBe(false);
    }
  });

  it('işçilikli 22 ayar bilezikler satın alma kataloğuna GİRMEZ', () => {
    for (const id of ['bracelet_22k_thin', 'bracelet_22k_burma']) {
      const t = getTemplate(id);
      expect(sellableToCustomer(t, TIER), `${id} satılabilir olmuş`).toBe(false);
      expect(customerBuyDemandPool(TIER)).not.toContain(id);
      // Oyundan silinmediler: müşteri hâlâ bunları GETİREBİLİR.
      expect(ITEM_TEMPLATES.some((x) => x.id === id)).toBe(true);
    }
  });

  it('22 ayar dışındaki hiçbir ayar satılabilir kataloğa girmez', () => {
    for (const id of customerBuyDemandPool(TIER)) {
      const karat = getTemplate(id).nominalKarat;
      expect(['22K', '24K'], `${id} ayarı ${karat}`).toContain(karat);
    }
    // 8/14/18 ayar ürünler tabloda var ama katalogda yok.
    const lowKarat = ITEM_TEMPLATES.filter((t) => ['8K', '14K', '18K'].includes(t.nominalKarat));
    expect(lowKarat.length).toBeGreaterThan(0);
    for (const t of lowKarat) expect(sellableToCustomer(t, TIER)).toBe(false);
  });

  it('katalogdaki hiçbir ürün taşlı değildir', () => {
    for (const id of customerBuyDemandPool(TIER)) {
      expect(getTemplate(id).hasStone, `${id} taşlı`).toBe(false);
    }
  });

  it('katalogdaki her BİLEZİK işçiliksizdir', () => {
    /*
      Sınır bileziğe özgüdür, katalogun tamamına değil: çeyrek altın 0.05
      işçilik oranı taşır ve bu DOĞRUDUR — darphane işçiliği ziynetin
      tanımının parçası. §1'in yasakladığı şey işçilikli BİLEZİĞİN satın
      alma kataloğuna girmesi.
    */
    const bracelets = customerBuyDemandPool(TIER).filter(
      (id) => getTemplate(id).silhouette === 'bracelet',
    );
    expect(bracelets.length, 'katalogda hiç bilezik yok').toBe(PLAIN_BRACELET_GRAMS.length);
    for (const id of bracelets) {
      expect(getTemplate(id).craftsmanshipRatioBand[1], `${id} işçilikli`).toBe(0);
      expect(getTemplate(id).nominalKarat, `${id} 22 ayar değil`).toBe('22K');
    }
  });
});

// ===========================================================================
// §2 — DÜKKÂN ADI
// ===========================================================================

describe('§2 — dükkân adı temel isimden türer', () => {
  it('"Alvera" kaydedilince ekranda "Alvera Kuyumculuk" görünür', () => {
    expect(shopDisplayName('Alvera')).toBe('Alvera Kuyumculuk');
  });

  it('oyuncu eki de yazarsa "Kuyumculuk" İKİ KEZ yazılmaz', () => {
    expect(shopDisplayName('Alvera Kuyumculuk')).toBe('Alvera Kuyumculuk');
    // Büyük/küçük harf ve Türkçe 'i' farkı ek tanımayı bozmaz.
    expect(shopDisplayName('Alvera KUYUMCULUK')).toBe('Alvera Kuyumculuk');
    expect(shopDisplayName('Alvera kuyumculuk')).toBe('Alvera Kuyumculuk');
  });

  it('kaydedilen değer TEMEL isimdir — ek saklanmaz', () => {
    const check = checkJewelerName('Alvera Kuyumculuk');
    expect(check.ok && check.value).toBe('Alvera');
  });

  it('ek doğrulamadan ÖNCE kırpılır — uzun ad ekin ağırlığıyla reddedilmez', () => {
    /*
      "Abdurrahman Kuyumculuk" 22 karakter; temel isim 11. Kırpma sonra
      yapılsaydı sınır ekin uzunluğunu da sayardı.
    */
    const check = checkJewelerName('Abdurrahman Kuyumculuk');
    expect(check.ok).toBe(true);
    expect(check.ok && check.value).toBe('Abdurrahman');
  });

  it('UPDATEv1 doğrulaması korunur: 2-24 karakter, boş kabul edilmez', () => {
    expect(checkJewelerName('   ').ok).toBe(false);
    expect(checkJewelerName('A').ok).toBe(false);
    expect(checkJewelerName('AB').ok).toBe(true);
    expect(checkJewelerName('x'.repeat(NAME_MAX)).ok).toBe(true);
    expect(checkJewelerName('x'.repeat(NAME_MAX + 1)).ok).toBe(false);
    // Baş/son boşluk temizlenir.
    const trimmed = checkJewelerName('  Alvera  ');
    expect(trimmed.ok && trimmed.value).toBe('Alvera');
  });

  it('yalnız ek yazılırsa geriye isim kalmaz ve reddedilir', () => {
    expect(stripShopSuffix(SHOP_SUFFIX)).toBe('');
    expect(checkJewelerName(SHOP_SUFFIX).ok).toBe(false);
  });

  it('varsayılan ad ekranı bugünküyle aynı bırakır', () => {
    expect(shopDisplayName(DEFAULT_JEWELER_NAME)).toBe('MIHENKAYNAK Kuyumculuk');
  });

  it('eski kayıtlar açılır: profil alanı yoksa varsayılana düşer', () => {
    expect(normalizeProfile(undefined).jewelerName).toBe(DEFAULT_JEWELER_NAME);
    expect(normalizeProfile({}).jewelerName).toBe(DEFAULT_JEWELER_NAME);
    // Eski kayıtta ek YAZILI olabilir; yüklerken normalize edilir.
    expect(normalizeProfile({ jewelerName: 'Alvera Kuyumculuk' }).jewelerName).toBe('Alvera');
  });
});

// ===========================================================================
// SERMAYENİN HAS ALTIN KARŞILIĞI
// ===========================================================================

describe('Sermaye HAS altına çevrilir — salt gösterim', () => {
  it('karşılık spot fiyattan TÜREİR; ikinci bir altın fiyatı yoktur', () => {
    // 1 gram HAS = spot / 0.995. O tutar tam olarak 1 gram HAS etmeli.
    const spot = 4000;
    const oneGramHas = spot / HAS_PURITY;
    expect(tlToHasGrams(oneGramHas, spot)).toBeCloseTo(1, 9);
  });

  it('fiyat yükselince aynı para DAHA AZ altın eder', () => {
    const money = 1_000_000;
    const ucuz = tlToHasGrams(money, 4000);
    const pahali = tlToHasGrams(money, 4400);
    expect(pahali).toBeLessThan(ucuz);
    // Oran fiyat oranının tersidir; sürpriz bir katsayı yok.
    expect(ucuz / pahali).toBeCloseTo(4400 / 4000, 9);
  });

  it('geçersiz veya sıfır fiyatta çökmez, sıfır döner', () => {
    expect(tlToHasGrams(1000, 0)).toBe(0);
    expect(tlToHasGrams(1000, -5)).toBe(0);
    expect(tlToHasGrams(1000, Number.NaN)).toBe(0);
  });

  it('birim eşiği 1 kg — altında gram, üstünde kilogram', () => {
    expect(hasGold(0)).toBe('0 g HAS');
    expect(hasGold(250.4)).toContain('g HAS');
    expect(hasGold(250.4)).not.toContain('kg');
    expect(hasGold(1000)).toContain('kg HAS');
    expect(hasGold(2500)).toContain('kg HAS');
  });
});
