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
import { bullionMeta, isBullion } from '@data/bullion';
import { getArchetype } from '@data/archetypes';
import { getTemplate } from '@data/item-templates';
import { bullionUnitValue, priceForChannel, CHANNEL_LABEL_TR } from './channels';
import { trueValue } from './valuation';
import { Rng, deriveSeed } from './rng';
import type { DayCharacter } from './intent';
import type {
  Customer,
  CustomerDemand,
  InventoryPosition,
  ItemInstance,
  MarketState,
  Money,
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

  const families = wantsBullion ? [] : archetype.preferredFamilies.slice(0, 2);

  return {
    families,
    wantsBullion,
    templateId,
    quantity,
    acceptsPartial,
    minQuantity,
    summary: demandSummary(templateId, families, quantity, isBulk),
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
  if (families.length > 0) return `${families.join(' / ')} arıyor`;
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
export function packageFairValue(items: ItemInstance[], market: MarketState): Money {
  return items.reduce(
    (sum, item) => sum + (isBullion(item.templateId) ? bullionUnitValue(item, market) : trueValue(item, market)),
    0,
  );
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
  items: ItemInstance[],
  demand: CustomerDemand,
  customer: Customer,
  market: MarketState,
): { fair: Money; suggested: Money; channel: TradeChannel; rationale: string } {
  const fair = packageFairValue(items, market);
  const channel = channelForDemand(demand);

  if (items.length === 0 || fair <= 0) {
    return { fair: 0, suggested: 0, channel, rationale: 'Pakette ürün yok.' };
  }

  // Kanal motoru BİRİM fiyatlar; paket tek bir birim gibi fiyatlanır ve
  // adet etkisi `quantity` üzerinden makasa girer.
  const quote = priceForChannel({
    item: items[0]!,
    market,
    channel,
    side: 'shopSells',
    quantity: Math.max(items.length, demand.quantity),
    baseUnitValue: fair,
    relationship: customer.trust,
  });

  return {
    fair,
    suggested: quote.unitPrice,
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

/** Paketin defter maliyeti — kâr ve settlement için (GDD 22.1). */
export function packageCost(itemIds: string[], inventory: InventoryPosition[]): Money {
  const byId = new Map(inventory.map((p) => [p.itemId, p]));
  return itemIds.reduce((sum, id) => sum + (byId.get(id)?.costBasis ?? 0), 0);
}

/** Yeni bir alış oturumu. */
export function createPurchaseSession(demand: CustomerDemand): PurchaseSession {
  return {
    demand,
    selectedItemIds: [],
    packageFairValue: 0,
    suggestedPrice: 0,
    channel: channelForDemand(demand),
    packageCost: 0,
    fulfilment: 'none',
    rationale: 'Paket henüz boş.',
  };
}

/** Paket değiştikçe oturumu yeniden türetir — saf fonksiyon. */
export function repricePackage(
  session: PurchaseSession,
  itemIds: string[],
  items: Record<string, ItemInstance>,
  inventory: InventoryPosition[],
  customer: Customer,
  market: MarketState,
): PurchaseSession {
  const picked = itemIds.map((id) => items[id]).filter((it): it is ItemInstance => !!it);
  const quote = quotePackage(picked, session.demand, customer, market);

  return {
    ...session,
    selectedItemIds: itemIds,
    packageFairValue: quote.fair,
    suggestedPrice: quote.suggested,
    channel: quote.channel,
    packageCost: packageCost(itemIds, inventory),
    fulfilment: fulfilmentOf(session.demand, picked.length),
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
  items: ItemInstance[],
): { patienceCost: number; ceilingMultiplier: number } {
  if (items.length === 0) return { patienceCost: 0, ceilingMultiplier: 1 };

  const offCount = items.filter((it) => matchDemand(demand, it) === 'off').length;
  const exactCount = items.filter((it) => matchDemand(demand, it) === 'exact').length;

  const patienceCost = offCount * PURCHASE.offMatchPatienceCost;
  const ceilingMultiplier =
    1 -
    offCount * PURCHASE.offMatchCeilingCut +
    Math.min(exactCount, items.length) * PURCHASE.exactMatchCeilingBonus;

  return { patienceCost, ceilingMultiplier: Math.max(0.7, Math.min(1.12, ceilingMultiplier)) };
}

/** Stok yeterliliği — oyuncuya "kaç adet verebilirsin" göstergesi (§4.1). */
export function availableForDemand(
  demand: CustomerDemand,
  inventory: InventoryPosition[],
  items: Record<string, ItemInstance>,
): number {
  return offerableStock(demand, inventory, items).filter((r) => r.match !== 'off').length;
}

export function storeCanServe(demand: CustomerDemand, available: number): boolean {
  return available >= (demand.acceptsPartial ? demand.minQuantity : demand.quantity);
}

/** Mağaza kademesi paketin üst sınırını belirler (GDD 12). */
export function maxPackageLines(store: StoreState): number {
  return PURCHASE.maxPackageLinesByTier[store.storeTier] ?? 3;
}
