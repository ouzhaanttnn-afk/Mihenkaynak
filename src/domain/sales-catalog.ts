/**
 * SATIŞ KATALOĞU — dükkânın müşteriye SATABİLDİĞİ ürünlerin tek kaynağı.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR (UPDATEv2 §18)
 *
 * Canlı denetimde şu çıktı: satın alma niyetli müşteri "14 Ayar Kolye almak
 * istiyorum" diyordu, ama oyuncunun kolye tedarik edebileceği hiçbir yol
 * yoktu. Talep doğru eşleştirilse bile karşılanamıyordu; oyuncu hatasız
 * oynadığı hâlde sürekli "stokta sunulacak ürün yok" görüyordu.
 *
 * Bu bir stok şansı problemi değil, KAPSAM UYUŞMAZLIĞIYDI: müşterinin
 * isteyebildiği küme, oyuncunun satabildiği kümeden genişti.
 *
 * Sorunun kökü ise üç ayrı elle yazılmış listenin olmasıydı:
 *   · balance.ts        → PURCHASE.bullionDemandPool  (müşteri ne ister)
 *   · StockScreen.tsx   → PLAYTEST_BULLION            (oyuncu ne alabilir)
 *   · item-templates.ts → şablonların kendisi
 * İkisi birbirini tutmuyordu (republic_gold talep havuzunda vardı, tedarik
 * tezgâhında yoktu). İki liste er geç ayrışır; bu dosya onları teke indirir.
 *
 * KURAL: müşteri yalnız oyuncunun GERÇEKTEN tedarik edip satabildiği bir
 * ürünü isteyebilir. İleride kolye satışı açıldığında yapılacak tek şey
 * `sellableToCustomer`ın kapısını genişletmektir; talep havuzu kendiliğinden
 * onu takip eder.
 *
 * KAPSAM SINIRI: bu dosya YALNIZ "müşteri dükkândan satın alıyor" akışını
 * daraltır. İşçilikli takılar oyundan silinmez — müşteri dükkâna SATARKEN,
 * bozdurmada, ekspertizde, serviste, atölyede ve stokta aynen yaşamaya
 * devam eder (bkz. sales-catalog.test.ts).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  ITEM_TEMPLATES,
  PLAIN_BRACELET_GRAMS,
  getTemplate,
  plainBraceletId,
  type ItemTemplate,
} from '@data/item-templates';
import { isBullion } from '@data/bullion';

/**
 * Toptancı tezgâhının taşıdığı standart sarrafiye.
 *
 * Bu, "hangi ŞABLONLAR alınıp satılabilir" sorusunun cevabıdır; fiyat ve
 * limit hâlâ wholesaler.ts'in işidir. Sıra tezgâhta görünen sıradır:
 * gramajlar küçükten büyüğe, sonra ziynet.
 */
const SUPPLIER_CATALOG_IDS = [
  'gram_gold_1',
  'gram_gold_2_5',
  'gram_gold_5',
  'gram_gold_10',
  'gram_gold_20',
  'gram_gold_50',
  'gram_gold_100',
  'quarter_gold',
  'half_gold',
  'full_gold',
  'republic_gold',
  'ata_gold',
  /*
    UPDATEv3 §1 — 22 AYAR İŞÇİLİKSİZ YATIRIM BİLEZİĞİ.

    Kimlikler ELLE YAZILMAZ, `PLAIN_BRACELET_GRAMS`ten türer. §1 "15 g, 25 g
    gibi 10'un katı olmayan gramajları satılabilir kataloğa ekleme" diyor;
    listeyi tek kaynaktan türetmek o kuralı ihlal edilebilir bir yerde
    bırakmaz. Aynı sebeple 8/14/18 ayar ve işçilikli/taşlı 22 ayar bilezikler
    buraya HİÇ girmez: onlar sarrafiye değil (`isBullion` false) ve
    `sellableToCustomer`ın ilk kapısında zaten elenirler.
  */
  ...PLAIN_BRACELET_GRAMS.map(plainBraceletId),
] as const;

export type SupplierCatalogId = (typeof SUPPLIER_CATALOG_IDS)[number];

/** Katalogda mı — hızlı üyelik testi. */
export function supplierCatalogHas(templateId: string): boolean {
  return (SUPPLIER_CATALOG_IDS as readonly string[]).includes(templateId);
}

/**
 * Bu şablon müşteriye satılabilir mi?
 *
 * Üç kapı birden geçilmeli:
 *   1. Sarrafiye olmalı — mevcut sürümde dükkân yalnız sarrafiye satıyor.
 *   2. Mağaza kademesi açmış olmalı (GDD 19) — kademe 1 dükkânının
 *      müşterisine üst kademe ürünü sorulmaz.
 *   3. Tedarik kataloğunda bulunmalı — oyuncunun alamadığı bir ürünü
 *      müşteriye sattırmak, karşılanamaz talebin ta kendisidir.
 */
export function sellableToCustomer(template: ItemTemplate, storeTier: number): boolean {
  return (
    isBullion(template.id) &&
    template.minTier <= storeTier &&
    supplierCatalogHas(template.id)
  );
}

/**
 * Oyuncunun BU KADEMEDE tedarik edip satabildiği şablonlar.
 * Hem tedarik tezgâhı hem müşteri talep havuzu bunu tüketir.
 */
export function sellableTemplates(storeTier: number): ItemTemplate[] {
  return ITEM_TEMPLATES.filter((t) => sellableToCustomer(t, storeTier));
}

/** Talep havuzu — satılabilir şablonların kimlikleri. */
export function customerBuyDemandPool(storeTier: number): string[] {
  return sellableTemplates(storeTier).map((t) => t.id);
}

/**
 * TALEP AĞIRLIKLARI — hangi sarrafiye ne sıklıkta sorulur.
 *
 * NEDEN VAR: ölçüldü — talep 22 SKU'ya neredeyse DÜZGÜN dağılıyordu (SKU
 * başına 38–78 istek) ve satın almaya gelenlerin %63'ü eli boş dönüyordu.
 * Düzgün dağılım hem gerçek dışıydı hem de dükkânı imkânsız bir göreve
 * sokuyordu: 22 kalemin hepsini aynı anda vitrinde tutmak.
 *
 * Gerçek bir semt sarrafında talep çeyrekte yığılır; 100 g külçe ya da 90 g
 * bilezik ayda bir sorulur. Ağırlıklar bunu yansıtır. Dükkânın taşıyabileceği
 * kalem sayısı değişmedi — DEĞİŞEN, o kalemlerin doğru olanları tutunca
 * talebin çoğunu karşılayabilmesi.
 *
 * Listede olmayan bir kimlik `DEFAULT_DEMAND_WEIGHT` alır: yeni bir SKU
 * eklendiğinde talep havuzundan sessizce düşmez, yalnız nadir kalır.
 */
const DEMAND_WEIGHTS: Record<string, number> = {
  // Semtin ekmeği: çeyrek. Düğün, doğum, bayram — hepsi buradan döner.
  quarter_gold: 30,
  half_gold: 12,
  full_gold: 8,

  // Küçük gramaj tasarruf alışkanlığı; çeyrekten sonraki en sık istek.
  gram_gold_1: 10,
  gram_gold_2_5: 9,
  gram_gold_5: 7,
  gram_gold_10: 5,
  gram_gold_20: 3,
  // Büyük külçe yatırımcı işidir, vitrin müşterisi değil.
  gram_gold_50: 1.5,
  gram_gold_100: 1,

  // Ziynet/koleksiyon: hediye amaçlı, düzenli ama seyrek.
  republic_gold: 3,
  ata_gold: 2.5,

  // 22 ayar işçiliksiz yatırım bileziği (UPDATEv3 §1). Gramaj büyüdükçe
  // alıcı azalır: 10–30 g takılır ve hediye edilir, 90–100 g yatırımdır.
  bracelet_22k_plain_10: 6,
  bracelet_22k_plain_20: 5,
  bracelet_22k_plain_30: 4,
  bracelet_22k_plain_40: 2.5,
  bracelet_22k_plain_50: 2,
  bracelet_22k_plain_60: 1.5,
  bracelet_22k_plain_70: 1,
  bracelet_22k_plain_80: 0.8,
  bracelet_22k_plain_90: 0.6,
  bracelet_22k_plain_100: 0.5,
};

const DEFAULT_DEMAND_WEIGHT = 1;

/**
 * Talep havuzu, ağırlıklarıyla. `Rng.pickWeighted` tek çekiliş harcar —
 * `pick` ile aynı — yani determinizm akışı (GDD 28.3) kaymaz.
 */
export function weightedBuyDemandPool(
  storeTier: number,
): { value: string; weight: number }[] {
  return customerBuyDemandPool(storeTier).map((id) => ({
    value: id,
    weight: DEMAND_WEIGHTS[id] ?? DEFAULT_DEMAND_WEIGHT,
  }));
}

/**
 * Tedarik tezgâhında gösterilecek sıra. Katalog sırası korunur ki tezgâh
 * her açılışta aynı düzende görünsün.
 */
export function supplierCounterIds(storeTier: number): string[] {
  return SUPPLIER_CATALOG_IDS.filter((id) => {
    const template = getTemplate(id);
    return template ? sellableToCustomer(template, storeTier) : false;
  });
}

/**
 * Bir satın alma talebi bu dükkânda hâlâ karşılanabilir mi?
 *
 * Eski kayıt güvenliği için: talep havuzu daraldığında kayıtta duran bir
 * talep artık geçersiz olabilir. Çağıran taraf bunu görüp talebi güvenle
 * kapatır — oyunu çökertmek yerine.
 */
export function demandIsSellable(
  templateId: string | null | undefined,
  storeTier: number,
): boolean {
  if (!templateId) return false;
  const template = getTemplate(templateId);
  return template ? sellableToCustomer(template, storeTier) : false;
}
