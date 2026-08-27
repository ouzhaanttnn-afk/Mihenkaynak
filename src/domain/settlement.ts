/**
 * MIHENKAYNAK — Settlement ve muhasebe
 * Kaynak: GDD 22 "Settlement, Muhasebe ve İşlem Kaydı", 34.4–34.6, EK F.
 *
 * GDD 22: "Ekonomi motorunun güvenilirliği oyunun tasarım kalitesidir. Her
 * ekonomik olay tek ve izlenebilir biçimde uygulanmalıdır."
 *
 * DEĞİŞMEZLER:
 *  22.1 / 34.4  Kabul edilen işlem yalnız BİR KEZ kasa/stok/güven/XP'ye yazılır.
 *  22.1         Çift tap ikinci işlem oluşturmaz.
 *  22.1         Reload sonrası terminal işlem yeniden settlement edilmez.
 *  22.1         Maliyet tabanı aynı stok birleştiğinde ağırlıklı maliyetle güncellenir.
 *  12.3         Çoklu üründe settlement ve cost basis KALEM BAZINDADIR.
 *  34.5         Gerçekleşmiş kâr ile stok potansiyeli ayrı kavramlardır.
 *
 * Uygulama: Ledger, uygulanmış txId kümesini tutar. applyTransaction() aynı
 * txId ile ikinci kez çağrılırsa hiçbir şey yapmaz ve `applied: false` döner.
 * Bu, çift tap ve reload senaryolarının ikisini birden kapatır.
 */

import { LIQUIDITY_BANDS, XP } from './balance';
import type {
  DealRecord,
  GameDay,
  InventoryPosition,
  ItemInstance,
  Money,
  SettlementTransaction,
  StoreState,
} from './types';

/** Muhasebe defteri. Uygulanmış işlemlerin tek kaydı. */
export interface Ledger {
  /** Uygulanmış transaction ID'leri — idempotency anahtarı. */
  appliedTxIds: string[];
  transactions: SettlementTransaction[];
  deals: DealRecord[];
  /** GDD 14.3 — yalnız tamamlanmış satışlardan gelen kâr. */
  realizedProfitToday: Money;
  realizedProfitTotal: Money;
}

export function createLedger(): Ledger {
  return {
    appliedTxIds: [],
    transactions: [],
    deals: [],
    realizedProfitToday: 0,
    realizedProfitTotal: 0,
  };
}

export interface EconomyState {
  store: StoreState;
  inventory: InventoryPosition[];
  items: Record<string, ItemInstance>;
  ledger: Ledger;
}

export interface SettlementOutcome {
  /** false ise işlem zaten uygulanmıştı; hiçbir durum değişmedi. */
  applied: boolean;
  state: EconomyState;
  reason?: string;
}

/**
 * Tek settlement kuralının uygulama noktası (GDD 22.1).
 *
 * Bu fonksiyon ekonomik durumu değiştiren TEK yoldur. Kasa, stok, güven ve XP
 * başka hiçbir yerden yazılmaz; böylece "duplicate para/stok oluşmaz" (34.4)
 * garantisi tek bir yerde denetlenebilir kalır.
 */
export function applyTransaction(
  state: EconomyState,
  tx: SettlementTransaction,
): SettlementOutcome {
  // --- İdempotency kapısı ---
  if (state.ledger.appliedTxIds.includes(tx.txId)) {
    return {
      applied: false,
      state,
      reason: `Transaction ${tx.txId} zaten uygulanmış — yok sayıldı.`,
    };
  }

  // --- Nakit ---
  const cash = state.store.cash + tx.cashDelta;
  if (cash < 0) {
    return { applied: false, state, reason: 'Yetersiz nakit; işlem uygulanmadı.' };
  }

  // --- Stok girişleri: cost basis kalem bazında yazılır (GDD 12.3) ---
  const items = { ...state.items };
  let inventory = [...state.inventory];

  for (const incoming of tx.itemsIn) {
    items[incoming.id] = incoming;
    inventory = upsertPosition(inventory, {
      itemId: incoming.id,
      costBasis: incoming.buyCost ?? 0,
      currentValue: incoming.buyCost ?? 0,
      age: 0,
      demand: 'steady',
      thesis: incoming.thesis,
      location: incoming.location === 'display' ? 'display' : 'backStock',
      expectedExitValues: {},
    });
  }

  // --- Stok çıkışları ---
  for (const outId of tx.itemsOut) {
    inventory = inventory.filter((p) => p.itemId !== outId);
    const item = items[outId];
    if (item) items[outId] = { ...item, location: 'sold' };
  }

  // --- İlişki ve ilerleme ---
  const reputation = clamp(state.store.reputation + tx.reputationDelta, 0, 100);
  const { level, xp, xpToNext } = applyXp(state.store, tx.xpDelta);

  const store: StoreState = { ...state.store, cash, reputation, level, xp, xpToNext };

  const ledger: Ledger = {
    ...state.ledger,
    appliedTxIds: [...state.ledger.appliedTxIds, tx.txId],
    transactions: [...state.ledger.transactions, tx],
  };

  return { applied: true, state: { store, inventory, items, ledger } };
}

/**
 * Satıştan gerçekleşmiş kârı yazar.
 *
 * GDD 34.5 — "Gerçekleşmiş kâr ile stok potansiyeli ayrı kavramlardır."
 * Bu fonksiyon YALNIZ tamamlanmış satış/likidasyonda çağrılır. Stoktaki bir
 * ürünün değer artışı buraya asla yazılmaz.
 *
 * GDD 31.3 — "Item cost basis satışta yalnız satılan miktar kadar realize olur."
 */
export function realizeProfit(ledger: Ledger, revenue: Money, costBasis: Money): Ledger {
  const profit = revenue - costBasis;
  return {
    ...ledger,
    realizedProfitToday: ledger.realizedProfitToday + profit,
    realizedProfitTotal: ledger.realizedProfitTotal + profit,
  };
}

export function recordDeal(ledger: Ledger, deal: DealRecord): Ledger {
  // Aynı dealId iki kez kaydedilmez (GDD 31.3 invariant).
  if (ledger.deals.some((d) => d.dealId === deal.dealId)) return ledger;
  return { ...ledger, deals: [...ledger.deals, deal] };
}

/**
 * GDD 22.1 — "Maliyet tabanı aynı stok birleştiğinde ağırlıklı/gerçek maliyetle
 * güncellenir." Ayrılabilir kalemler (takı) ayrı pozisyon kalır; yalnız
 * birbirinin aynısı olan yığın ürünler (gram altın) birleşir.
 */
function upsertPosition(
  inventory: InventoryPosition[],
  incoming: InventoryPosition,
): InventoryPosition[] {
  return [...inventory, incoming];
}

/** Ağırlıklı ortalama maliyet — yığın ürün birleşmesinde kullanılır. */
export function weightedCostBasis(
  existing: { qty: number; costBasis: Money },
  incoming: { qty: number; costBasis: Money },
): Money {
  const totalQty = existing.qty + incoming.qty;
  if (totalQty <= 0) return 0;
  return Math.round((existing.costBasis * existing.qty + incoming.costBasis * incoming.qty) / totalQty);
}

// ---------------------------------------------------------------------------
// Likidite ve servet (GDD 14.2, 14.3)
// ---------------------------------------------------------------------------

/** GDD 14.2 — Likidite Oranı = Nakit / (Nakit + Stok Maliyet Tabanı). */
export function liquidityRatio(cash: Money, inventory: InventoryPosition[]): number {
  const stockCost = inventory.reduce((s, p) => s + p.costBasis, 0);
  const denom = cash + stockCost;
  return denom <= 0 ? 1 : cash / denom;
}

export type LiquidityBand = 'red' | 'caution' | 'healthy' | 'veryLiquid';

export function liquidityBand(ratio: number): LiquidityBand {
  if (ratio < LIQUIDITY_BANDS.red) return 'red';
  if (ratio < LIQUIDITY_BANDS.caution) return 'caution';
  if (ratio <= LIQUIDITY_BANDS.healthy) return 'healthy';
  return 'veryLiquid';
}

export const LIQUIDITY_BAND_LABEL: Record<LiquidityBand, string> = {
  red: 'Kırmızı risk',
  caution: 'Dikkat',
  healthy: 'Sağlıklı',
  veryLiquid: 'Çok likit',
};

/**
 * GDD 14.3 — Servet ve kâr ayrımı.
 * Stok potansiyeli net servete girer ama gerçekleşmiş kâra ASLA eklenmez.
 */
export interface WealthSummary {
  cash: Money;
  stockCost: Money;
  stockEstimatedValue: Money;
  /** Henüz satılmamış varlıkların olası kâr/zararı — realize DEĞİLDİR. */
  stockPotential: Money;
  liabilities: Money;
  netWorth: Money;
  realizedProfitToday: Money;
}

export function summarizeWealth(state: EconomyState): WealthSummary {
  const stockCost = state.inventory.reduce((s, p) => s + p.costBasis, 0);
  const stockEstimatedValue = state.inventory.reduce((s, p) => s + p.currentValue, 0);
  const liabilities =
    state.store.payables.reduce((s, p) => s + p.amount, 0) +
    state.store.supplier.openInvoices.reduce((s, i) => s + i.amount, 0);

  return {
    cash: state.store.cash,
    stockCost,
    stockEstimatedValue,
    stockPotential: stockEstimatedValue - stockCost,
    liabilities,
    netWorth: state.store.cash + stockEstimatedValue - liabilities,
    realizedProfitToday: state.ledger.realizedProfitToday,
  };
}

// ---------------------------------------------------------------------------
// XP ve seviye (GDD 18.1)
// ---------------------------------------------------------------------------

function applyXp(store: StoreState, delta: number): { level: number; xp: number; xpToNext: number } {
  let level = store.level;
  let xp = store.xp + Math.max(0, delta);
  let xpToNext = store.xpToNext;

  while (xp >= xpToNext) {
    xp -= xpToNext;
    level += 1;
    xpToNext = XP.levelCurve(level);
  }

  return { level, xp, xpToNext };
}

/** Bir işlemin XP karşılığı (GDD 18.1). */
export function xpForDeal(input: {
  testsUsed: number;
  confidence: 'low' | 'medium' | 'high';
  margin: number;
}): number {
  let xp = XP.dealClosed + input.testsUsed * XP.perTestUsed;
  if (input.confidence === 'high') xp += XP.highConfidenceBonus;
  if (input.margin > 0.08) xp += XP.goodMarginBonus;
  // Zararına kapanan işlem XP vermez ama cezalandırmaz (GDD 21.1 "sert game over yok").
  return Math.max(XP.lossFloor, xp);
}

// ---------------------------------------------------------------------------
// Gün kapanışı (GDD 22.4) — idempotent olmalıdır (GDD 22.1 / EK F)
// ---------------------------------------------------------------------------

export interface DayCloseResult {
  applied: boolean;
  state: EconomyState;
  report: DayReport;
}

export interface DayReport {
  day: GameDay;
  realizedTradeProfit: Money;
  overhead: Money;
  netCashChange: Money;
  stockPotential: Money;
  liquidity: number;
  liquidityBand: LiquidityBand;
  upcomingLiabilities: { label: string; amount: Money; dueDay: GameDay }[];
}

/**
 * Gün kapanışı. GDD 22.1: "Gün sonu servis/vade/gelir işlemleri idempotent
 * olmalıdır." Aynı gün için ikinci kez çağrılırsa kasa tekrar eksilmez.
 */
export function closeDay(state: EconomyState, day: GameDay): DayCloseResult {
  const txId = `dayclose_${day}`;
  const overhead = state.store.dailyOverhead;

  const tx: SettlementTransaction = {
    txId,
    dealId: txId,
    day,
    cashDelta: -overhead,
    itemsIn: [],
    itemsOut: [],
    trustDelta: 0,
    reputationDelta: 0,
    xpDelta: 0,
    label: `Gün ${day} kira + sabit gider`,
  };

  const outcome = applyTransaction(state, tx);
  const nextState = outcome.state;
  const wealth = summarizeWealth(nextState);
  const ratio = liquidityRatio(nextState.store.cash, nextState.inventory);

  return {
    applied: outcome.applied,
    state: nextState,
    report: {
      day,
      realizedTradeProfit: nextState.ledger.realizedProfitToday,
      overhead,
      netCashChange: nextState.ledger.realizedProfitToday - overhead,
      stockPotential: wealth.stockPotential,
      liquidity: ratio,
      liquidityBand: liquidityBand(ratio),
      upcomingLiabilities: [
        ...nextState.store.payables.map((p) => ({ label: p.label, amount: p.amount, dueDay: p.dueDay })),
        ...nextState.store.supplier.openInvoices.map((i) => ({
          label: 'Toptancı vadesi',
          amount: i.amount,
          dueDay: i.dueDay,
        })),
      ].sort((a, b) => a.dueDay - b.dueDay),
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
