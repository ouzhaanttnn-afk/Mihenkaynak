/**
 * MIHENKAYNAK — İşlem Tezi ve çıkış kanalı sistemi
 * Kaynak: GDD 8 "İşlem Tezi ve Çıkış Kanalı Sistemi", 6.4 "Alış Tavanı", EK E.
 *
 * GDD 8: "Oyuncu bir ürünü yalnız 'ucuz' olduğu için almaz; o ürünün nasıl ve
 * ne zaman paraya döneceğine dair plan kurar."
 *
 * DEĞİŞMEZ (GDD 6.4): "Aynı ürün için tek doğru alış tavanı yoktur." Tavan,
 * seçilen kanalın beklenen net gelirinden türer; oyuncunun nakdi, atölye
 * kapasitesi ve vitrin doluluğu hangi kanalın rasyonel olduğunu değiştirir.
 *
 * DEĞİŞMEZ (GDD 35.1): "Hızlı toptan çıkış normal perakende stratejisini
 * ekonomik olarak geçmemelidir." → assertChannelOrdering() bunu test eder.
 *
 * DEĞİŞMEZ (GDD 8.2): Tez bağlayıcı değildir; ürün alındıktan sonra
 * değiştirilebilir. Sistem oyuncuyu menü seçimine değil gerçek sonuçlara bağlar.
 */

import { BUY_CEILING, CONDITION_DEDUCTION, CONDITION_ORDER, EXIT_CHANNEL } from './balance';
import type {
  ConditionGrade,
  ExitChannel,
  ItemInstance,
  LiquidityLevel,
  MarketState,
  Money,
  RiskLevel,
  StoreState,
  ThesisOption,
  ValuationBand,
} from './types';

export const CHANNEL_LABEL: Record<ExitChannel, string> = {
  wholesale: 'Toptancıya Çıkar',
  retail: 'Vitrine Koy',
  melt: 'Erit / HAS',
  serviceResale: 'Servis + Satış',
  collection: 'Beklet / Koleksiyon',
};

export const CHANNEL_SHORT: Record<ExitChannel, string> = {
  wholesale: 'Toptan',
  retail: 'Vitrin',
  melt: 'Erit',
  serviceResale: 'Servis',
  collection: 'Beklet',
};

/** Bağlam: tezin rasyonelliği oyuncunun durumuna bağlıdır (GDD 6.4). */
export interface ThesisContext {
  store: StoreState;
  market: MarketState;
  /** Dolu vitrin slotu sayısı. */
  displayUsed: number;
  /** Dolu atölye slotu sayısı. */
  workshopUsed: number;
  /** Nakit / (nakit + stok maliyeti) — GDD 14.2. */
  liquidityRatio: number;
}

/**
 * Bir ürün için rasyonel çıkış kanallarını hesaplar.
 *
 * GDD 23.11: "Yalnız ürün için rasyonel 2–4 kanal gösterilir; anlamsız kanal
 * saklanır." Bu filtre burada uygulanır — UI'da değil.
 */
export function buildThesisOptions(
  item: ItemInstance,
  band: ValuationBand,
  ctx: ThesisContext,
): ThesisOption[] {
  const options: ThesisOption[] = [];

  // Tahmin bandının orta noktası, oyuncunun bildiği kadarıyla "adil değer".
  // Beklenen gelir hesabı gerçek değere değil bu tahmine dayanır — oyuncu
  // bilmediği bir şeyden kâr planlayamaz (GDD 6.6).
  const est = band.mid;
  const estMetal = band.breakdown.metal;
  const estStone = band.breakdown.stone;
  const estCraft = band.breakdown.craftsmanship;

  // --- Erit / HAS ---
  // GDD 8.1: metal odaklı, işçilik/taş kaybı. Her metal üründe geçerlidir.
  {
    const c = EXIT_CHANNEL.melt;
    const expectedNet = Math.round(estMetal * c.metalRecovery - c.refiningFee);
    options.push(
      finish({
        channel: 'melt',
        expectedNet,
        daysToCash: c.daysToCash,
        marketRisk: ctx.market.volatility > 0.018 ? 'medium' : 'low',
        demandRisk: 'low',
        capacityCost: { display: 0, workshop: 0 },
        liquidity: 'high',
        rationale:
          estCraft + estStone > estMetal * 0.15
            ? 'İşçilik ve taş değeri kaybolur.'
            : 'Yeniden satış değeri düşük; metal en güvenli çıkış.',
        ctx,
      }),
    );
  }

  // --- Toptan Likidite ---
  {
    const c = EXIT_CHANNEL.wholesale;
    const recovered =
      estMetal + estCraft * c.craftsmanshipRecovery + estStone * c.stoneRecovery;
    const expectedNet = Math.round(recovered * c.payoutRatio);
    options.push(
      finish({
        channel: 'wholesale',
        expectedNet,
        daysToCash: c.daysToCash,
        marketRisk: 'low',
        demandRisk: 'low',
        capacityCost: { display: 0, workshop: 0 },
        liquidity: 'high',
        rationale:
          ctx.liquidityRatio < 0.3
            ? 'Nakit sıkışıkken hızlı çıkış rasyonel.'
            : 'Düşük marj karşılığında anlık nakit.',
        ctx,
      }),
    );
  }

  // --- Vitrin / Perakende ---
  // Kondisyonu kabul edilebilir ve vitrin slotu varsa rasyonel.
  const displayFree = ctx.store.displaySlots - ctx.displayUsed;
  const retailViable =
    conditionRank(item.declared.visibleCondition) >= conditionRank('worn') && displayFree > 0;
  if (retailViable) {
    const c = EXIT_CHANNEL.retail;
    const days = c.daysToCash;
    const avgDays = (days[0] + days[1]) / 2;
    const demand = demandLevel(item, ctx);
    const gross = est * c.markup * c.realizationRatio;
    const expectedNet = Math.round(gross - c.holdingCostPerDay * avgDays);
    options.push(
      finish({
        channel: 'retail',
        expectedNet,
        daysToCash: days,
        marketRisk: ctx.market.volatility > 0.015 ? 'medium' : 'low',
        demandRisk: demand === 'hot' ? 'low' : demand === 'steady' ? 'medium' : 'high',
        capacityCost: { display: 1, workshop: 0 },
        liquidity: 'medium',
        rationale:
          demand === 'hot'
            ? 'Talep etiketi güçlü; vitrin dönüşü hızlı olabilir.'
            : 'Sermaye bağlanır; doğru müşteri beklenir.',
        ctx,
      }),
    );
  }

  // --- Servis + Satış ---
  // Yalnız düzeltilebilir bir kondisyon problemi varsa anlamlıdır (GDD 8.1).
  const repairable =
    item.declared.visibleCondition === 'worn' ||
    item.declared.visibleCondition === 'damaged' ||
    item.declared.visibleCondition === 'broken';
  const workshopFree = ctx.store.workshopCapacity - ctx.workshopUsed;
  if (repairable && displayFree > 0) {
    const c = EXIT_CHANNEL.serviceResale;
    // Servis, kondisyon kesintisinin bir kısmını geri kazandırır.
    const conditionCut = CONDITION_DEDUCTION[item.declared.visibleCondition];
    const restoredValue = est / Math.max(0.08, 1 - conditionCut);
    const recovered = est + (restoredValue - est) * c.conditionRecovery;
    const serviceCost = (restoredValue - est) * c.serviceCostRatio;
    // Atölye doluysa hata riski ve dolayısıyla beklenen maliyet artar (GDD 17.3).
    const errorRisk = c.baseErrorRisk * (workshopFree <= 0 ? 2.4 : 1);
    const gross = recovered * c.markup * c.realizationRatio;
    const expectedNet = Math.round(gross - serviceCost - gross * errorRisk);
    const days = workshopFree <= 0 ? ([c.daysToCash[0] + 2, c.daysToCash[1] + 3] as [number, number]) : c.daysToCash;

    options.push(
      finish({
        channel: 'serviceResale',
        expectedNet,
        daysToCash: days,
        marketRisk: 'medium',
        demandRisk: 'medium',
        capacityCost: { display: 1, workshop: 1 },
        liquidity: 'low',
        rationale:
          workshopFree <= 0
            ? 'Atölye dolu: süre uzar, hata riski yükselir.'
            : 'Kondisyon düzeltilebilir; yeniden satış değeri artar.',
        ctx,
      }),
    );
  }

  // --- Koleksiyon Bekletme ---
  // GDD 8.1: yalnız vintage/nadir üründe ve güçlü likidite varken rasyonel.
  const looksRare =
    item.family === 'collectible' || item.truth.rarity >= EXIT_CHANNEL.collection.minRarity;
  if (looksRare && ctx.liquidityRatio > 0.3) {
    const c = EXIT_CHANNEL.collection;
    const days = c.holdDays;
    const avgDays = (days[0] + days[1]) / 2;
    const expectedNet = Math.round(est * (1 + c.appreciationPerDay * avgDays) * c.realizationRatio);
    options.push(
      finish({
        channel: 'collection',
        expectedNet,
        daysToCash: days,
        marketRisk: 'medium',
        demandRisk: 'high',
        capacityCost: { display: 0, workshop: 0 },
        liquidity: 'low',
        rationale: 'Doğru koleksiyoner gelene kadar değer korunabilir; sermaye uzun bağlanır.',
        ctx,
      }),
    );
  }

  // GDD 23.11 — en fazla 4 kanal; en yüksek tavandan sırala ki oyuncu
  // karşılaştırmayı tek bakışta yapabilsin.
  return options.sort((a, b) => b.buyCeiling - a.buyCeiling).slice(0, 4);
}

/**
 * GDD 6.4 — Alış Tavanı =
 *   Seçilen Çıkış Kanalının Beklenen Net Geliri
 *   − Hedef Marj − Risk Rezervi − Operasyon / Zaman Maliyeti.
 */
function finish(input: {
  channel: ExitChannel;
  expectedNet: Money;
  daysToCash: [number, number];
  marketRisk: RiskLevel;
  demandRisk: RiskLevel;
  capacityCost: { display: number; workshop: number };
  liquidity: LiquidityLevel;
  rationale: string;
  ctx: ThesisContext;
}): ThesisOption {
  const combinedRisk = worstRisk(input.marketRisk, input.demandRisk);
  const targetMargin = BUY_CEILING.targetMarginByRisk[combinedRisk];
  const avgDays = (input.daysToCash[0] + input.daysToCash[1]) / 2;
  const opCost = BUY_CEILING.opCostPerDay * avgDays;

  // Risk rezervi bandın genişliğinden gelir; çağıran taraf bandı bilir, ancak
  // burada kanal riskiyle birleştirilir. Band genişliği thesisFor() tarafından
  // enjekte edilir; burada kanal payını uygularız.
  const riskReserveRatio = riskReserveFor(combinedRisk);

  const buyCeiling = Math.max(
    0,
    Math.round(input.expectedNet * (1 - targetMargin - riskReserveRatio - opCost)),
  );

  return {
    channel: input.channel,
    label: CHANNEL_LABEL[input.channel],
    expectedNet: input.expectedNet,
    daysToCash: input.daysToCash,
    marketRisk: input.marketRisk,
    demandRisk: input.demandRisk,
    capacityCost: input.capacityCost,
    liquidity: input.liquidity,
    buyCeiling,
    rationale: input.rationale,
  };
}

function riskReserveFor(risk: RiskLevel): number {
  return risk === 'low' ? 0.02 : risk === 'medium' ? 0.05 : 0.09;
}

/**
 * Bilgi riskini alış tavanına uygular (GDD 6.4 "Risk Rezervi", 6.3 "Düşük güven
 * → risk rezervi yüksek olmalı"). Geniş band = daha düşük tavan.
 */
export function applyBandRisk(options: ThesisOption[], band: ValuationBand): ThesisOption[] {
  const bandPenalty = band.relativeWidth * BUY_CEILING.riskReservePerBandWidth;
  return options.map((o) => ({
    ...o,
    buyCeiling: Math.max(0, Math.round(o.buyCeiling * (1 - Math.min(0.6, bandPenalty)))),
  }));
}

/** Ürün + tez + bağlam → tam seçenek listesi (band riski uygulanmış). */
export function thesisFor(
  item: ItemInstance,
  band: ValuationBand,
  ctx: ThesisContext,
): ThesisOption[] {
  return applyBandRisk(buildThesisOptions(item, band, ctx), band);
}

/**
 * Sistem varsayılan en makul kanalı önerir fakat kilitlemez (GDD 23.7 "Tez").
 * En yüksek alış tavanını veren kanal önerilir — oyuncunun en fazla ödeyebileceği
 * planı gösterir.
 */
export function suggestedChannel(options: ThesisOption[]): ExitChannel | null {
  return options[0]?.channel ?? null;
}

/** Seçili tez yoksa oyuncu yine teklif verebilir (GDD 23.7). Referans tavan: en iyisi. */
export function effectiveCeiling(options: ThesisOption[], selected: ExitChannel | null): Money {
  if (selected) {
    const found = options.find((o) => o.channel === selected);
    if (found) return found.buyCeiling;
  }
  return options[0]?.buyCeiling ?? 0;
}

function demandLevel(item: ItemInstance, ctx: ThesisContext): 'cold' | 'steady' | 'hot' {
  const event = ctx.market.activeEvent;
  if (event) {
    const tags = item.truth.demandTags;
    if (event.id === 'wedding_season' && tags.includes('düğün')) return 'hot';
    if (event.id === 'market_rally' && tags.includes('yatırım')) return 'hot';
    if (event.id === 'fx_calm' && tags.includes('perakende')) return 'hot';
  }
  if (item.truth.demandTags.includes('likit')) return 'hot';
  if (item.truth.demandTags.includes('yavaş') || item.truth.demandTags.includes('koleksiyon')) {
    return 'cold';
  }
  return 'steady';
}

function worstRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function conditionRank(c: ConditionGrade): number {
  return CONDITION_ORDER.indexOf(c);
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
};

export const LIQUIDITY_LABEL: Record<LiquidityLevel, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
};
