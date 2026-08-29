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

import { ITEM_TEMPLATES, getTemplate, type ItemTemplate } from '@data/item-templates';
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
