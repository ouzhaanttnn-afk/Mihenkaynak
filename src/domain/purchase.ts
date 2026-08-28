/**
 * MIHENKAYNAK — Müşteri alış akışı (oyuncu müşteriye satar)
 * Kaynak: GDD 23.23 intent matrisi "Stok seçimi → Değer/Paket → Pazarlık",
 *         Ekonomi Ara Düzeltmesi v1.0 · §3 (terminoloji), §4.1 (kısmi
 *         karşılama), §6 (kanal fiyatlaması).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BU AKIŞIN SATIŞ AKIŞINDAN YAPISAL FARKI
 *
 * Satış akışında (müşteri satar) ürünü müşteri getirir; oyuncunun bilmediği
 * şey ÜRÜNÜN GERÇEĞİdir ve testler bu belirsizliği kapatır.
 *
 * Alış akışında ürün oyuncunun kendi stokudur — gerçeği zaten bilinir.
 * Belirsizlik yer değiştirir: bilinmeyen artık MÜŞTERİNİN ÖDEME TAVANIdır.
 * Bu yüzden burada test aşaması yoktur; onun yerine stok seçimi ve paketleme
 * vardır. Oyuncunun kaldıracı bilgi değil, DOĞRU MALI DOĞRU PAKETTE sunmaktır.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * KAPSAM SINIRI (Addendum §10): Paketin adil değeri GDD 6.2'nin çıktısıdır ve
 * valuation.ts'te hesaplanır. Bu dosya o değeri girdi alır, kanal katmanını
 * (channels.ts) uygular ve pazarlığa devreder. Değerleme formülü burada
 * yeniden yazılmaz.
 */

import { PURCHASE } from './balance';
import { costBasisForUnits } from './settlement';
import { bullionMeta, isBullion } from '@data/bullion';
import { getArchetype } from '@data/archetypes';
import { templatesForTier } from './item-spawn';
import { FAMILY_LABEL, getTemplate } from '@data/item-templates';
import { bullionUnitValue, gramsFor, priceForChannel, CHANNEL_LABEL_TR } from './channels';
import { trueValue } from './valuation';
import { Rng, deriveSeed } from './rng';
import type { DayCharacter } from './intent';
import type {
  Customer,
  CustomerDemand,
  InventoryPosition,
  ItemFamily,
  ItemInstance,
  MarketState,
  Money,
  PackageLine,
  PurchaseSession,
  StoreState,
  TradeChannel,
} from './types';

// ---------------------------------------------------------------------------
// Talep üretimi
// ---------------------------------------------------------------------------

/**
 * Müşterinin ne aradığını spawn anında sabitler (GDD 9.3).
 *
 * §4.1: "Toplu müşteri, normal tekil müşterinin sadece yüksek adetli kopyası
 * değildir; ayrı hacim bandı, bütçe, fiyat hassasiyeti, KISMİ KARŞILAMA ve
 * güven davranışı kullanır."
 */
export function spawnDemand(
  rootSeed: number,
  spawnIndex: number,
  archetypeId: Customer['archetype'],
  character: DayCharacter,
  /**
   * Mağaza kademesi — işçilikli talep havuzunu sınırlar. Kademe 1
   * dükkânının müşterisi flagship ürünü sormaz (GDD 19).
   */
  storeTier = 1,
): CustomerDemand {
  const rng = new Rng(deriveSeed(rootSeed, 'customer/demand', spawnIndex));
  const archetype = getArchetype(archetypeId);

  // Gün karakteri sarrafiye/işçilikli karmasını eğer (§3 %24 havuzu).
  const wantsBullion = rng.chance(character.bullionBias);

  // §4.1 toplu sipariş — gün karakterinden gelir, niyet payından değil.
  const isBulk = wantsBullion && rng.chance(character.bulkOrderChance);

  let templateId: string | null = null;
  let quantity = 1;

  if (wantsBullion) {
    templateId = rng.pick(PURCHASE.bullionDemandPool);
    const meta = bullionMeta(templateId);
    const band = isBulk ? meta?.bulkVolumeBand : meta?.volumeBand;
    const [lo, hi] = band ?? [1, 2];
    quantity = Math.max(1, Math.round(rng.range(lo, hi) * character.volumeScale));
  }

  // §4.1 kısmi karşılama: toplu müşteri stok yetmezse azıyla da çıkabilir.
  const acceptsPartial = isBulk ? rng.chance(PURCHASE.bulkPartialChance) : quantity > 1;
  const minQuantity = acceptsPartial
    ? Math.max(1, Math.ceil(quantity * PURCHASE.partialFloorShare))
    : quantity;

  /*
   * İŞÇİLİKLİ TALEP DE SOMUT BİR ÜRÜN ADI TAŞIR.
   *
   * Eskiden yalnız sarrafiyede ürün seçiliyordu; işçilikli üründe aile
   * listesi kalıyor ve müşteri ekranda "klasik takı / gümüş arıyor" diyordu.
   * Gerçek müşteri aile adı söylemez, "bilezik bakıyorum" der.
   *
   * `families` YERİNE GEÇMEZ, üstüne biner: eşleşme hâlâ aile düzeyinde
   * çalışır (matchDemand), yani oyuncu tam o ürünü değil YAKININI da
   * sunabilir. Somut ad yalnız müşterinin ağzındaki cümleyi belirler ve
   * `exact` eşleşmeyi mümkün kılar.
   */
  let families = wantsBullion ? [] : archetype.preferredFamilies.slice(0, 2);

  if (!wantsBullion) {
    const available = templatesForTier(storeTier).filter((t) => t.family !== 'bullion');
    let pool = available.filter((t) => families.includes(t.family));

    if (pool.length === 0) {
      /*
       * Bu kademede arketipin tercih ettiği aile HİÇ YOK (kademe 1'de taşlı
       * ürün gibi). Talebi soyut bırakmak yerine dükkânın gerçekten
       * taşıyabileceği bir şeye düşürüyoruz ve `families`i de ona göre
       * daraltıyoruz. İkisini ayrı bırakmak, müşterinin adıyla istediği
       * ürünün eşleşmede 'off' çıkması demekti — kendi istediğini reddeden
       * bir talep.
       */
      pool = available;
      families = [...new Set(available.map((t) => t.family))];
    }

    if (pool.length > 0) templateId = rng.pick(pool).id;
  }

  return {
    families,
    wantsBullion,
    templateId,
    quantity,
    isBulk,
    acceptsPartial,
    minQuantity,
    summary: demandSummary(templateId, families, quantity, isBulk),
    alternativesLabel: wantsBullion
      ? ''
      : families.map((f) => FAMILY_LABEL[f as ItemFamily] ?? f).join(' / '),
  };
}

function demandSummary(
  templateId: string | null,
  families: string[],
  quantity: number,
  isBulk: boolean,
): string {
  if (templateId) {
    const name = getTemplate(templateId)?.displayName ?? templateId;
    const adet = quantity > 1 ? `${quantity} adet ` : '';
    return isBulk ? `Toplu: ${adet}${name}` : `${adet}${name}`;
  }
  // Buraya yalnız hiçbir şablonun eşleşmediği hâlde düşülür; aile listesi
  // son çare olarak kalır ama artık oyuncunun dilinde yazılır.

  if (families.length > 0) {
    // Aileler ekrana İÇ ADIYLA değil, oyuncunun dilinde çıkar (v1.1 §7):
    // "bullion / classic arıyor" değil, "sarrafiye / klasik takı arıyor".
    const labels = families.map((f) => FAMILY_LABEL[f as ItemFamily] ?? f);
    return `${labels.join(' / ')} arıyor`;
  }
  return 'Vitrine bakıyor';
}

// ---------------------------------------------------------------------------
// Stok eşleşmesi
// ---------------------------------------------------------------------------

/**
 * Bir stok kalemi talebi ne kadar karşılıyor.
 *   'exact'   — tam istediği ürün
 *   'family'  — aradığı ailede ama tam ürün değil
 *   'off'     — alakasız; müşteriye sunmak sabır ve ilgi yakar
 */
export type DemandMatch = 'exact' | 'family' | 'off';

export function matchDemand(demand: CustomerDemand, item: ItemInstance): DemandMatch {
  if (demand.templateId && item.templateId === demand.templateId) return 'exact';
  if (demand.wantsBullion) return isBullion(item.templateId) ? 'family' : 'off';

  const template = getTemplate(item.templateId);
  if (!template) return 'off';
  if (demand.families.length === 0) return 'family';
  return demand.families.includes(template.family) ? 'family' : 'off';
}

/** Talebi karşılayabilecek stok kalemleri — vitrin ve arka stok. */
export function offerableStock(
  demand: CustomerDemand,
  inventory: InventoryPosition[],
  items: Record<string, ItemInstance>,
): { position: InventoryPosition; item: ItemInstance; match: DemandMatch }[] {
  const rank: Record<DemandMatch, number> = { exact: 0, family: 1, off: 2 };
  const rows: { position: InventoryPosition; item: ItemInstance; match: DemandMatch }[] = [];
  for (const position of inventory) {
    if (position.location !== 'display' && position.location !== 'backStock') continue;
    const item = items[position.itemId];
    if (!item) continue;
    rows.push({ position, item, match: matchDemand(demand, item) });
  }
  return rows.sort(
    (a, b) => rank[a.match] - rank[b.match] || b.position.currentValue - a.position.currentValue,
  );
}

// ---------------------------------------------------------------------------
// Paket fiyatlaması
// ---------------------------------------------------------------------------

/**
 * Paketin adil değeri — GDD 6.2'nin çıktısı. Sarrafiyede birim değer ×
 * adet, işçilikli üründe kalemin gerçek değeri. Bu dosya formülü YENİDEN
 * YAZMAZ, yalnız toplar (Addendum §10).
 */
export function packageFairValue(
  lines: PackageLine[],
  items: Record<string, ItemInstance>,
  market: MarketState,
): Money {
  return lines.reduce((sum, line) => {
    const item = items[line.itemId];
    if (!item) return sum;
    const unit = isBullion(item.templateId)
      ? bullionUnitValue(item, market)
      : trueValue(item, market);
    return sum + unit * line.quantity;
  }, 0);
}

/**
 * §4.1: "Toplu müşteri ... ayrı hacim bandı, bütçe, fiyat hassasiyeti ...
 * kullanır." Adet bandın üstüne çıktığında kanal profili de değişir.
 */
export function channelForDemand(demand: CustomerDemand): TradeChannel {
  return demand.quantity >= PURCHASE.bulkChannelThreshold ? 'bulkCustomer' : 'retailCustomer';
}

/**
 * Oyuncuya önerilen satış fiyatı. Addendum §6'nın kanal katmanı burada
 * devreye girer: aynı paket, aynı gün, farklı adet → farklı makas.
 *
 * Öneri bir DAYATMA DEĞİLDİR: oyuncu pazarlıkta istediği rakamı ister.
 * Öneri yalnız kanal makasının nereye düştüğünü gösterir.
 */
export function quotePackage(
  lines: PackageLine[],
  demand: CustomerDemand,
  customer: Customer,
  market: MarketState,
  items: Record<string, ItemInstance>,
): { fair: Money; suggested: Money; channel: TradeChannel; rationale: string } {
  const fair = packageFairValue(lines, items, market);
  const units = packageUnits(lines);
  const channel = channelForDemand(demand);
  const first = lines.length > 0 ? items[lines[0]!.itemId] : undefined;

  if (units === 0 || fair <= 0 || !first) {
    return { fair: 0, suggested: 0, channel, rationale: 'Pakette ürün yok.' };
  }

  // Kanal motoru BİRİM fiyatlar. Paketin birim adil değeri üzerinden
  // fiyatlayıp adetle çarpmak, §6'nın hacim katmanının gerçekten çalışmasını
  // sağlar: 40 adet, 1 adedin 40 katı DEĞİLDİR.
  const unitFair = Math.round(fair / units);
  const quote = priceForChannel({
    item: first,
    market,
    channel,
    side: 'shopSells',
    quantity: units,
    baseUnitValue: unitFair,
    relationship: customer.trust,
  });

  return {
    fair,
    suggested: quote.unitPrice * units,
    channel,
    rationale: `${CHANNEL_LABEL_TR[channel]} · ${quote.rationale}`,
  };
}

/**
 * MÜŞTERİNİN ÖDEME TAVANI — bu akışın gizli gerçeği (GDD 6.6: oyuncuya
 * asla doğrudan gösterilmez).
 *
 * GDD 34.2 "rezervasyon spawn anında sabitlenir" burada ORAN olarak uygulanır:
 * paketi oyuncu seçtiği için tavarın TL karşılığı ancak paket belli olunca
 * hesaplanabilir; ama oranı ve bütçesi spawn anında sabittir. Oyuncu paketi
 * değiştirip tavanı "yeniden zar atarak" yükseltemez.
 */
export function purchaseCeiling(customer: Customer, fair: Money): Money {
  return Math.min(customer.budget, Math.round(fair * customer.purchaseCeilingRatio));
}

/**
 * §4.1 "Toplu talepler stok yetersizliğinde REDDEDİLEBİLİR, KISMEN
 * KARŞILANABİLİR veya uygun ticari kanal üzerinden tedarik edilerek
 * tamamlanabilir."
 */
export function fulfilmentOf(demand: CustomerDemand, count: number): PurchaseSession['fulfilment'] {
  if (count <= 0) return 'none';
  if (count >= demand.quantity) return 'full';
  return count >= demand.minQuantity && demand.acceptsPartial ? 'partial' : 'none';
}

/**
 * Paketin defter maliyeti — kâr ve settlement için (GDD 22.1).
 * GDD 31.3: "cost basis satışta yalnız SATILAN MİKTAR kadar realize olur."
 * Bu yüzden pozisyonun tamamı değil, satılan adedin payı sayılır.
 */
export function packageCost(lines: PackageLine[], inventory: InventoryPosition[]): Money {
  const byId = new Map(inventory.map((p) => [p.itemId, p]));
  return lines.reduce((sum, line) => {
    const position = byId.get(line.itemId);
    return sum + (position ? costBasisForUnits(position, line.quantity) : 0);
  }, 0);
}

/** Pakete konan toplam adet. */
export function packageUnits(lines: PackageLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * Paketin gram karşılığı — §4.1 "adet, GRAM KARŞILIĞI, ciro, brüt marj ...
 * ayrıca ölçülmelidir."
 */
export function packageGrams(lines: PackageLine[], items: Record<string, ItemInstance>): number {
  const total = lines.reduce((sum, line) => {
    const item = items[line.itemId];
    if (!item) return sum;
    return sum + gramsFor(item, line.quantity);
  }, 0);
  return Math.round(total * 1000) / 1000;
}

/** Yeni bir alış oturumu. */
export function createPurchaseSession(demand: CustomerDemand): PurchaseSession {
  return {
    demand,
    lines: [],
    packageFairValue: 0,
    suggestedPrice: 0,
    channel: channelForDemand(demand),
    packageCost: 0,
    units: 0,
    fulfilment: 'none',
    rationale: 'Paket henüz boş.',
  };
}

/**
 * Paket değiştikçe oturumu yeniden türetir — saf fonksiyon.
 *
 * §4.1 "Hacim büyüdükçe fiyat etkisi ve makas doğrusal olmak zorunda
 * değildir." Fiyat her seferinde ADET üzerinden yeniden hesaplanır; paketi
 * büyütmek fiyatı çarpmaz, kanal makasını yeniden çalıştırır.
 */
export function repricePackage(
  session: PurchaseSession,
  lines: PackageLine[],
  items: Record<string, ItemInstance>,
  inventory: InventoryPosition[],
  customer: Customer,
  market: MarketState,
): PurchaseSession {
  const clean = lines.filter((l) => l.quantity > 0 && !!items[l.itemId]);
  const units = packageUnits(clean);
  const quote = quotePackage(clean, session.demand, customer, market, items);

  return {
    ...session,
    lines: clean,
    packageFairValue: quote.fair,
    suggestedPrice: quote.suggested,
    channel: quote.channel,
    packageCost: packageCost(clean, inventory),
    units,
    fulfilment: fulfilmentOf(session.demand, units),
    rationale: quote.rationale,
  };
}

/**
 * Talebe uymayan mal sunmanın bedeli. §9 "hiçbir kanal her koşulda en iyi
 * sonucu vermez" ilkesinin müşteri tarafındaki karşılığı: yanlış paket
 * sabır yakar ve tavanı düşürür.
 */
export function packageFitPenalty(
  demand: CustomerDemand,
  lines: PackageLine[],
  items: Record<string, ItemInstance>,
): { patienceCost: number; ceilingMultiplier: number } {
  if (lines.length === 0) return { patienceCost: 0, ceilingMultiplier: 1 };

  let offUnits = 0;
  let exactUnits = 0;
  for (const line of lines) {
    const item = items[line.itemId];
    if (!item) continue;
    const match = matchDemand(demand, item);
    if (match === 'off') offUnits += line.quantity;
    if (match === 'exact') exactUnits += line.quantity;
  }

  const patienceCost = offUnits * PURCHASE.offMatchPatienceCost;
  const ceilingMultiplier =
    1 - offUnits * PURCHASE.offMatchCeilingCut + exactUnits * PURCHASE.exactMatchCeilingBonus;

  return { patienceCost, ceilingMultiplier: Math.max(0.7, Math.min(1.12, ceilingMultiplier)) };
}

/**
 * §4.1 "Toplu talepler STOK YETERSİZLİĞİNDE reddedilebilir, kısmen
 * karşılanabilir veya uygun ticari kanal üzerinden tedarik edilerek
 * tamamlanabilir."
 *
 * Kaç ADET verilebilir — pozisyon sayısı değil. Sarrafiye yığıldığı için
 * tek pozisyon 40 adet taşıyabilir; pozisyon saymak stoğu yok saymaktı.
 */
export function availableUnits(
  demand: CustomerDemand,
  inventory: InventoryPosition[],
  items: Record<string, ItemInstance>,
): number {
  return offerableStock(demand, inventory, items)
    .filter((r) => r.match !== 'off')
    .reduce((sum, r) => sum + r.position.quantity, 0);
}

/** §4.1 üç sonuçtan hangisi mümkün. */
export type DemandOutcome = 'full' | 'partial' | 'sourceNeeded' | 'reject';

/**
 * §4.1'in üç yolunu ayırt eder. `sourceNeeded`, stok yetmediği ama müşterinin
 * eksiğe razı OLMADIĞI durumdur: talep ancak ticari kanaldan tedarikle
 * tamamlanabilir (§4.2 toptancı). O tedarik akışı ayrı bir sistemdir; burada
 * yalnız durum teşhis edilir, sessizce "reddedildi"ye çevrilmez.
 */
export function demandOutcome(demand: CustomerDemand, available: number): DemandOutcome {
  if (available >= demand.quantity) return 'full';
  if (available <= 0) return 'reject';
  if (demand.acceptsPartial && available >= demand.minQuantity) return 'partial';
  return 'sourceNeeded';
}

export function storeCanServe(demand: CustomerDemand, available: number): boolean {
  const outcome = demandOutcome(demand, available);
  return outcome === 'full' || outcome === 'partial';
}

/** Mağaza kademesi paketin üst sınırını belirler (GDD 12). */
export function maxPackageLines(store: StoreState): number {
  return PURCHASE.maxPackageLinesByTier[store.storeTier] ?? 3;
}

// ---------------------------------------------------------------------------
// §4.1 — TOPLU MÜŞTERİ AYRI BİR MÜŞTERİDİR
// ---------------------------------------------------------------------------

/**
 * §4.1 DEĞİŞMEZ: "Toplu müşteri, normal tekil müşterinin sadece YÜKSEK ADETLİ
 * KOPYASI DEĞİLDİR; ayrı hacim bandı, bütçe, fiyat hassasiyeti, kısmi
 * karşılama ve GÜVEN DAVRANIŞI kullanır."
 *
 * Bu fonksiyon spawn edilmiş bir müşteriyi toplu profiline çevirir. Adedi
 * büyütüp bırakmak, addendum'un açıkça yasakladığı şeydi.
 *
 * Toplu müşterinin karakteri:
 *   · Fiyata çok daha duyarlı — birim farkı adetle çarpılıyor.
 *   · Daha sabırlı — büyük iş pazarlık ister, kapıdan dönmez.
 *   · Jeste değil rakama bakar — ilişki primi tekil müşterininkinden düşük.
 *   · Ödeme tavanı DAR — piyasayı biliyor, perakende primini ödemez.
 */
export function applyBulkProfile(customer: Customer): Customer {
  if (!customer.demand?.isBulk) return customer;
  const b = PURCHASE.bulk;

  return {
    ...customer,
    priceSensitivity: clamp(Math.round(customer.priceSensitivity * b.priceSensitivityFactor), 0, 100),
    patienceMax: Math.round(customer.patienceMax * b.patienceFactor),
    patience: Math.round(customer.patienceMax * b.patienceFactor),
    // Toplu alıcı dükkâna güvenmekten çok fiyatına bakar: yeni ilişkiye
    // tekil müşteriden daha temkinli başlar ve jestle hızlı ısınmaz.
    trust: clamp(Math.round(customer.trust * b.trustFactor), 0, 100),
    purchaseCeilingRatio: clamp(
      1 + (customer.purchaseCeilingRatio - 1) * b.ceilingCompression,
      0.95,
      1.45,
    ),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
