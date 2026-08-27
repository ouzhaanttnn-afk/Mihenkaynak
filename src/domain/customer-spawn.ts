/**
 * MIHENKAYNAK — Müşteri üretimi
 * Kaynak: GDD 9 "Müşteri Simülasyonu", 9.3 "Spawn anında sabitlenenler".
 *
 * DEĞİŞMEZ (GDD 34.2): "Müşteri rezervasyon fiyatı spawn anında sabitlenir."
 * Rezervasyon fiyatı ürünün *gerçek* değerinden ve arketipin oranından türer;
 * oyuncunun bilgi durumundan bağımsızdır. Oyuncu çok test yapsa da az yapsa da
 * müşterinin kabul sınırı aynıdır — testler yalnız oyuncunun bilgisini artırır.
 */

import { ARCHETYPES, FIRST_NAMES_F, FIRST_NAMES_M, HONORIFIC_F, HONORIFIC_M, getArchetype } from '@data/archetypes';
import { templatesForTier } from './item-spawn';
import { spawnItem } from './item-spawn';
import { trueValue } from './valuation';
import { Rng, deriveSeed, makeId } from './rng';
import type {
  ArchetypeId,
  Customer,
  CustomerIntent,
  ItemInstance,
  MarketState,
  StoreState,
} from './types';

export interface SpawnedCustomer {
  customer: Customer;
  items: ItemInstance[];
}

/**
 * Bir müşteri ve getirdiği kalemleri deterministik olarak üretir.
 *
 * @param spawnIndex Oyun boyunca artan sayaç. (rootSeed, spawnIndex) ikilisi
 *                   müşteriyi tamamen belirler — reload reroll üretmez.
 */
export function spawnCustomer(
  rootSeed: number,
  spawnIndex: number,
  market: MarketState,
  store: StoreState,
): SpawnedCustomer {
  const rng = new Rng(deriveSeed(rootSeed, 'customer', spawnIndex));

  const archetypeId = pickArchetype(rng, store, market);
  const archetype = getArchetype(archetypeId);

  // --- Kimlik ---
  const isFemale = rng.chance(0.55);
  const firstName = isFemale ? rng.pick(FIRST_NAMES_F) : rng.pick(FIRST_NAMES_M);
  const displayName = `${firstName} ${isFemale ? HONORIFIC_F : HONORIFIC_M}`;

  // --- Niyet ---
  //
  // GDD 23.23 beş ayrı intent akışı tanımlar ve her biri FARKLI bir ekran
  // davranışı ister:
  //   sell      → İncele → Değerle → Tez → Pazarlık          (çekirdek akış)
  //   buy       → Stok seçimi → Değer/Paket → Pazarlık        (henüz yok)
  //   service   → Tanıla → Süre/Risk/Fiyat → Söz → Kuyruk     (henüz yok, 23.14)
  //   appraisal → İncele → Test → Rapor/Ücret → Sonuç         (henüz yok)
  //
  // Bu sürümde yalnız çekirdek "sell" akışı üretimde olduğu için havuz ona
  // sabitlenmiştir. Diğer niyetleri spawn etmek, müşteri şeridinde doğru
  // niyeti yazıp yanlış akışı çalıştırmak anlamına gelirdi. Karşılık gelen
  // akışlar üretime girdiğinde ağırlıklar buradan açılır.
  const intent: CustomerIntent = 'sell';

  // --- Kalem sayısı: çoklu ürün orta oyunda açılır (GDD 12) ---
  const multiChance = store.level >= 3 ? 0.26 : store.level >= 2 ? 0.12 : 0;
  const lineCount = rng.chance(multiChance) ? rng.int(2, 3) : 1;

  // --- Ürünler ---
  const items: ItemInstance[] = [];
  const pool = templatesForTier(store.storeTier).filter(
    (t) =>
      archetype.preferredFamilies.includes(t.family) ||
      // Arketip tercihi dışında da ürün gelebilir; havuz tek renk olmasın.
      rng.chance(0.25),
  );
  const usablePool = pool.length > 0 ? pool : templatesForTier(store.storeTier);

  for (let i = 0; i < lineCount; i++) {
    const template = rng.pick(usablePool);
    items.push(spawnItem(rootSeed, spawnIndex * 10 + i, template.id));
  }

  // --- Davranış parametreleri (GDD 9.1) ---
  const patienceMax = Math.round(rng.band(archetype.patienceBand));
  const knowledge = Math.round(rng.band(archetype.knowledgeBand));
  const urgency = Math.round(rng.band(archetype.urgencyBand));
  const priceSensitivity = Math.round(rng.band(archetype.priceSensitivityBand));
  const status = Math.round(rng.band(archetype.statusBand));

  // --- Rezervasyon fiyatı: SPAWN ANINDA SABİT (GDD 9.3 / 34.2) ---
  // Müşterinin satarken kabul edeceği en düşük fiyat. Ürünün gerçek değerine
  // ve arketipin oranına dayanır; bilgi seviyesi oranı yukarı çeker.
  const fairTotal = items.reduce((sum, item) => sum + trueValue(item, market), 0);
  const baseRatio = rng.band(archetype.reservationRatioBand);
  const knowledgeAdjust = ((knowledge - 50) / 50) * 0.05; // ±5 puan
  const urgencyAdjust = -((urgency - 50) / 50) * 0.04; // Acil müşteri daha düşüğe razı
  const reservationRatio = clamp(baseRatio + knowledgeAdjust + urgencyAdjust, 0.7, 1.08);
  const reservationPrice = Math.round(fairTotal * reservationRatio);

  // --- Bütçe (alıcı müşteride kullanılır) ---
  const budget = Math.round(fairTotal * rng.range(1.05, 1.9) * (1 + status / 200));

  const id = makeId('cust', rootSeed, spawnIndex);
  const lineIds = items.map((_, i) => `${id}_line${i}`);

  return {
    customer: {
      id,
      displayName,
      archetype: archetypeId,
      intent,
      patienceMax,
      knowledge,
      urgency,
      priceSensitivity,
      status,
      budget,
      reservationPrice,
      patience: patienceMax,
      // Yeni müşteride mağaza güveni semt itibarından türer (GDD 10.1).
      trust: clamp(Math.round(store.reputation * 0.6 + rng.range(-8, 12)), 5, 95),
      suspicion: 0,
      visitHistory: [],
      preferences: archetype.preferredFamilies,
      referralSource: null,
      lineIds,
    },
    items,
  };
}

/**
 * Arketip havuzu mağaza kademesine ve itibara göre değişir (GDD 10.1
 * "Semt/Marka İtibarı → müşteri trafiği, premium segment").
 */
function pickArchetype(rng: Rng, store: StoreState, market: MarketState): ArchetypeId {
  const rep = store.reputation;
  const weights = ARCHETYPES.map((a) => {
    let w = 100;

    // Premium arketipler itibar ister.
    if (a.id === 'vip') w = rep >= 60 ? 45 : 4;
    if (a.id === 'collector') w = rep >= 55 && store.storeTier >= 2 ? 40 : 6;
    if (a.id === 'weddingShopper') w = 55;
    if (a.id === 'investor') w = 70;
    if (a.id === 'informedSeller') w = 65;
    if (a.id === 'opportunist') w = 55;
    if (a.id === 'urgentCash') w = 95;
    if (a.id === 'giftBuyer') w = 80;

    // Olaylar müşteri havuzunu değiştirir (GDD 20.2 — en az iki sistem).
    const event = market.activeEvent;
    if (event?.id === 'wedding_season' && a.id === 'weddingShopper') w *= 2.4;
    if (event?.id === 'market_rally' && a.id === 'investor') w *= 2.1;
    if (event?.id === 'fake_wave' && a.id === 'opportunist') w *= 1.8;

    return { value: a.id, weight: w };
  });

  return rng.pickWeighted(weights);
}

/**
 * Müşterinin bir sonraki gelişine kadar geçecek oyun dakikası.
 * "Müşteri Akını" rewarded QoL yalnız bu aralığı kısaltır (GDD 23.10.1 / 26.2);
 * müşteri kalitesini, bütçesini veya hidden truth dağılımını değiştirmez.
 */
export function nextCustomerDelay(
  rootSeed: number,
  spawnIndex: number,
  band: readonly [number, number],
  rushActive: boolean,
): number {
  const rng = new Rng(deriveSeed(rootSeed, 'customer/delay', spawnIndex));
  const base = rng.range(band[0], band[1]);
  return Math.round(rushActive ? base * 0.4 : base);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
