/**
 * MIHENKAYNAK — Oyun oturumu orkestrasyonu
 *
 * Bu katman domain'i UI'ya bağlar. Kural: iş mantığı BURADA YAŞAMAZ.
 * Store yalnız domain fonksiyonlarını doğru sırayla çağırır ve sonucu tutar.
 * Ekonomik yazma işlemi tek kapıdan geçer: settlement.applyTransaction().
 *
 * GDD 28.1 — kayıt sistemi işlem bazlı auto-save + gün sonu checkpoint kullanır;
 * save dosyası versiyonlanır ve migration destekler (bkz. src/state/save.ts).
 */

import { create } from 'zustand';

import { DAY, START, XP, PATIENCE_PER_TEST_SECOND, type SpeedStep } from '@domain/balance';
import { createMarketForDay, stepMarketIntraday } from '@domain/market';
import { nextCustomerDelay, spawnCustomer } from '@domain/customer-spawn';
import { applyMove, createSession, effectiveReservation, isTerminal } from '@domain/negotiation';
import { applyTest, estimateBand, initialKnowledge, trueValue } from '@domain/valuation';
import { effectiveCeiling, thesisFor, type ThesisContext } from '@domain/thesis';
import {
  applyTransaction,
  closeDay,
  createLedger,
  liquidityBand,
  liquidityRatio,
  recordDeal,
  summarizeWealth,
  xpForDeal,
  type EconomyState,
  type Ledger,
} from '@domain/settlement';
import { buildCaseReview, toReviewData, type CaseReview } from '@domain/deal-review';
import { getTool } from '@data/tools';
import { makeId } from '@domain/rng';
import type {
  ActiveDeal,
  Customer,
  DealLine,
  DealRecord,
  ExitChannel,
  InfoField,
  InventoryPosition,
  ItemInstance,
  MarketState,
  Money,
  NegotiationMove,
  SettlementTransaction,
  StoreState,
  WorkbenchStage,
} from '@domain/types';

// ---------------------------------------------------------------------------
// Durum şekli
// ---------------------------------------------------------------------------

export type RootTab = 'shop' | 'stock' | 'workshop' | 'business';

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'info' | 'positive' | 'negative';
}

export interface GameState {
  // --- Determinizm ---
  seed: number;
  /** Artan spawn sayacı — her spawn'ın deterministik anahtarı. */
  spawnCounter: number;

  // --- Dünya ---
  market: MarketState;
  store: StoreState;
  inventory: InventoryPosition[];
  items: Record<string, ItemInstance>;
  ledger: Ledger;

  // --- Oturum ---
  tab: RootTab;
  speed: SpeedStep;
  /** 4x rewarded video ile geçici açılır (GDD 26.2). */
  speed4xUnlocked: boolean;
  customerRushUntilMinutes: number | null;

  /** Kapıda bekleyen müşteriler. */
  queue: { customer: Customer; items: ItemInstance[] }[];
  /** Bir sonraki müşterinin geleceği oyun dakikası. */
  nextCustomerAtMinutes: number;

  activeCustomer: Customer | null;
  activeDeal: ActiveDeal | null;
  /** Müşterinin son mesajı — aynı yüzeyde gösterilir (GDD 23.24). */
  customerMessage: string;
  lastReview: CaseReview | null;

  toasts: ToastMessage[];

  // --- Aksiyonlar ---
  setTab: (tab: RootTab) => void;
  setSpeed: (speed: SpeedStep) => void;
  unlock4x: () => void;
  triggerCustomerRush: () => void;

  tick: (deltaRealSeconds: number) => void;
  greetCustomer: () => void;
  setStage: (stage: WorkbenchStage) => void;
  setActiveLine: (lineId: string) => void;

  runTest: (toolId: string) => void;
  selectThesis: (channel: ExitChannel) => void;
  submitOffer: (amount: Money) => void;
  negotiationMove: (move: NegotiationMove) => void;
  finishDeal: () => void;

  advanceDay: () => void;
  dismissToast: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Başlangıç durumu
// ---------------------------------------------------------------------------

function createInitialStore(): StoreState {
  return {
    name: 'MIHENKAYNAK Kuyumculuk',
    cash: START.cash,
    reputation: START.reputation,
    level: 1,
    xp: 0,
    xpToNext: XP.levelCurve(1),
    storeTier: 1,
    displaySlots: START.displaySlots,
    backStockSlots: START.backStockSlots,
    workshopCapacity: START.workshopCapacity,
    staff: [],
    supplier: {
      trust: START.supplierTrust,
      limit: START.supplierLimit,
      terms: START.supplierTerms,
      openInvoices: [],
      priceBand: 1.0,
      specialLotEligibility: false,
    },
    payables: [],
    dailyOverhead: START.dailyOverhead,
  };
}

/** Yeni oyun için deterministik kök seed. */
function freshSeed(): number {
  // Yeni oyun başlatılırken bir kez seçilir ve kaydedilir; oturum boyunca
  // asla değişmez. Save'den yüklenirken dosyadaki seed kullanılır.
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export const useGame = create<GameState>((set, get) => {
  const seed = freshSeed();
  const market = createMarketForDay(seed, 1);

  return {
    seed,
    spawnCounter: 0,
    market,
    store: createInitialStore(),
    inventory: [],
    items: {},
    ledger: createLedger(),

    tab: 'shop',
    speed: 1,
    speed4xUnlocked: false,
    customerRushUntilMinutes: null,

    queue: [],
    nextCustomerAtMinutes: DAY.openMinutes + 3,

    activeCustomer: null,
    activeDeal: null,
    customerMessage: '',
    lastReview: null,
    toasts: [],

    // -----------------------------------------------------------------------
    setTab: (tab) => set({ tab }),

    setSpeed: (speed) => {
      // GDD 26.2 — 1x/2x temel erişim; 4x yalnız rewarded ile geçici açılır.
      if (speed === 4 && !get().speed4xUnlocked) return;
      set({ speed });
    },

    unlock4x: () => {
      set({ speed4xUnlocked: true, speed: 4 });
      pushToast(set, get, '4x hız açıldı.', 'info');
    },

    triggerCustomerRush: () => {
      const { market } = get();
      // GDD 23.10.1 — yalnız müşteri geliş aralığını kısaltır. Müşteri
      // kalitesi, bütçesi, rezervasyon fiyatı veya hidden truth DEĞİŞMEZ.
      set({ customerRushUntilMinutes: market.clockMinutes + 90 });
      pushToast(set, get, 'Müşteri akını başladı — geliş aralığı kısaldı.', 'info');
    },

    // -----------------------------------------------------------------------
    tick: (deltaRealSeconds) => {
      const s = get();
      // Aktif pazarlık sırasında saat ilerlemez: oyuncu düşünürken müşteri
      // sabrı gerçek zamanla erimez (GDD 11 — refleks oyunu değildir).
      if (s.activeDeal && !isDealFinished(s.activeDeal)) return;

      const advance = deltaRealSeconds * DAY.minutesPerRealSecond * s.speed;
      const clock = s.market.clockMinutes + advance;

      if (clock >= DAY.closeMinutes) {
        get().advanceDay();
        return;
      }

      const market = stepMarketIntraday(s.market, clock);
      let { queue, nextCustomerAtMinutes, spawnCounter } = s;

      if (clock >= nextCustomerAtMinutes && queue.length < 3) {
        const spawned = spawnCustomer(s.seed, spawnCounter, market, s.store);
        queue = [...queue, spawned];
        spawnCounter += 1;

        const rushActive =
          s.customerRushUntilMinutes !== null && clock < s.customerRushUntilMinutes;
        nextCustomerAtMinutes =
          clock + nextCustomerDelay(s.seed, spawnCounter, DAY.customerIntervalMinutes, rushActive);
      }

      set({ market, queue, nextCustomerAtMinutes, spawnCounter });
    },

    // -----------------------------------------------------------------------
    greetCustomer: () => {
      const s = get();
      if (s.activeDeal && !isDealFinished(s.activeDeal)) return;

      const head = s.queue[0];
      if (!head) return;

      const items = { ...s.items };
      for (const item of head.items) items[item.id] = item;

      const lines: DealLine[] = head.items.map((item, i) => {
        const lineId = head.customer.lineIds[i] ?? `${head.customer.id}_line${i}`;
        return {
          lineId,
          itemId: item.id,
          knowledge: initialKnowledge(item),
          testResults: [],
          band: null,
          thesisOptions: [],
          selectedThesis: null,
          negotiation: createSession(lineId, item.id),
          status: 'untouched',
        };
      });

      const dealId = makeId('deal', s.seed, s.spawnCounter);

      set({
        items,
        queue: s.queue.slice(1),
        activeCustomer: head.customer,
        activeDeal: {
          dealId,
          customerId: head.customer.id,
          stage: 'inspect',
          activeLineId: lines[0]?.lineId ?? '',
          lines,
          startedAtSec: s.market.clockMinutes * 60,
          settled: false,
        },
        customerMessage: openingLine(head.customer),
        lastReview: null,
        tab: 'shop',
      });
    },

    setStage: (stage) => {
      const s = get();
      if (!s.activeDeal) return;
      if (!canEnterStage(s, stage)) return;

      // Değerle aşamasına girerken band ve tez seçenekleri hesaplanır.
      const deal = s.activeDeal;
      const lines = deal.lines.map((line) =>
        line.lineId === deal.activeLineId ? refreshLine(s, line) : line,
      );

      set({ activeDeal: { ...deal, stage, lines } });
    },

    setActiveLine: (lineId) => {
      const s = get();
      if (!s.activeDeal) return;
      set({ activeDeal: { ...s.activeDeal, activeLineId: lineId } });
    },

    // -----------------------------------------------------------------------
    runTest: (toolId) => {
      const s = get();
      const deal = s.activeDeal;
      const customer = s.activeCustomer;
      if (!deal || !customer) return;

      const line = activeLine(deal);
      if (!line) return;

      const item = s.items[line.itemId];
      if (!item) return;

      const tool = getTool(toolId);
      if (tool.unlockLevel > s.store.level) return;
      if (tool.cost > s.store.cash) {
        pushToast(set, get, 'Bu test için yeterli nakit yok.', 'negative');
        return;
      }

      const { knowledge, result } = applyTest(
        item,
        tool,
        line.knowledge,
        s.market.clockMinutes * 60,
      );

      // GDD 7 — test müşteri sabrına maliyettir.
      const patienceCost = Math.round(tool.durationSec * PATIENCE_PER_TEST_SECOND);
      const nextCustomer: Customer = {
        ...customer,
        patience: Math.max(0, customer.patience - patienceCost),
        // Çelişkili sonuç oyuncunun şüphesini artırır, müşterininkini değil;
        // müşteri şüphesi yalnız yanlış gerekçeden doğar (GDD 11.5).
      };

      const nextLine: DealLine = {
        ...line,
        knowledge,
        testResults: [...line.testResults, { ...result, patienceCost }],
      };

      // Sarf maliyeti kasadan düşer — tek settlement kapısından geçer.
      let economy = economyOf(get());
      if (tool.cost > 0) {
        const tx: SettlementTransaction = {
          txId: `test_${deal.dealId}_${line.lineId}_${line.testResults.length}_${tool.id}`,
          dealId: deal.dealId,
          day: s.market.day,
          cashDelta: -tool.cost,
          itemsIn: [],
          itemsOut: [],
          trustDelta: 0,
          reputationDelta: 0,
          xpDelta: 0,
          label: `${tool.name} sarf maliyeti`,
        };
        const outcome = applyTransaction(economy, tx);
        economy = outcome.state;
      }

      set({
        ...economyToState(economy),
        activeCustomer: nextCustomer,
        activeDeal: {
          ...deal,
          lines: deal.lines.map((l) => (l.lineId === line.lineId ? refreshLine(get(), nextLine) : l)),
        },
        customerMessage: patienceComment(nextCustomer),
      });
    },

    selectThesis: (channel) => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal) return;
      const line = activeLine(deal);
      if (!line) return;

      set({
        activeDeal: {
          ...deal,
          lines: deal.lines.map((l) =>
            l.lineId === line.lineId ? { ...l, selectedThesis: channel } : l,
          ),
        },
      });
    },

    submitOffer: (amount) => {
      get().negotiationMove({ kind: 'offer', amount, atRound: 0 });
    },

    negotiationMove: (move) => {
      const s = get();
      const deal = s.activeDeal;
      const customer = s.activeCustomer;
      if (!deal || !customer) return;

      const line = activeLine(deal);
      if (!line) return;
      if (isTerminal(line.negotiation.state)) return;

      const options = line.thesisOptions;
      const ctx = {
        customer,
        reputation: s.store.reputation,
        buyCeiling: effectiveCeiling(options, line.selectedThesis),
        knowledge: line.knowledge,
      };

      const { session, response } = applyMove(line.negotiation, ctx, move);

      const nextCustomer: Customer = {
        ...customer,
        patience: clamp(customer.patience + response.patienceDelta, 0, customer.patienceMax),
        trust: clamp(customer.trust + response.trustDelta, 0, 100),
        suspicion: clamp(customer.suspicion + response.suspicionDelta, 0, 100),
      };

      const status: DealLine['status'] =
        session.state === 'ACCEPTED'
          ? 'accepted'
          : session.state === 'REJECTED'
            ? 'rejected'
            : 'offered';

      const nextLines = deal.lines.map((l) =>
        l.lineId === line.lineId ? { ...l, negotiation: session, status } : l,
      );

      const nextDeal: ActiveDeal = {
        ...deal,
        lines: nextLines,
        stage: isTerminal(session.state) && allLinesResolved(nextLines) ? 'result' : deal.stage,
      };

      set({
        activeCustomer: nextCustomer,
        activeDeal: nextDeal,
        customerMessage: response.message,
      });

      if (isTerminal(session.state)) {
        settleLine(set, get, line.lineId);
      }
    },

    // -----------------------------------------------------------------------
    finishDeal: () => {
      set({ activeDeal: null, activeCustomer: null, customerMessage: '', lastReview: null });
    },

    advanceDay: () => {
      const s = get();
      const { state: closed, report } = closeDay(economyOf(s), s.market.day);
      const nextDay = s.market.day + 1;
      const market = createMarketForDay(s.seed, nextDay, s.market);

      // Stok yaşlanması (GDD 15.3).
      const inventory = closed.inventory.map((p) => ({ ...p, age: p.age + 1 }));

      set({
        ...economyToState({ ...closed, inventory }),
        ledger: { ...closed.ledger, realizedProfitToday: 0 },
        market,
        queue: [],
        activeCustomer: null,
        activeDeal: null,
        nextCustomerAtMinutes: DAY.openMinutes + 3,
        customerRushUntilMinutes: null,
      });

      pushToast(
        set,
        get,
        `Gün ${report.day} kapandı · Gerçekleşmiş kâr ${fmt(report.realizedTradeProfit)} · Gider ${fmt(report.overhead)}`,
        report.netCashChange >= 0 ? 'positive' : 'negative',
      );
    },

    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  };
});

// ---------------------------------------------------------------------------
// Settlement köprüsü
// ---------------------------------------------------------------------------

/**
 * Bir kalemin terminal sonucunu ekonomiye yazar.
 *
 * GDD 12.3 / 22.1 — settlement KALEM BAZINDADIR ve txId kalem kimliğini taşır.
 * Aynı kalem iki kez settle edilemez; bir kalemin reddi diğerinin cost basis'ini
 * bozmaz.
 */
function settleLine(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
  lineId: string,
): void {
  const s = get();
  const deal = s.activeDeal;
  const customer = s.activeCustomer;
  if (!deal || !customer) return;

  const line = deal.lines.find((l) => l.lineId === lineId);
  if (!line) return;

  const item = s.items[line.itemId];
  const band = line.band;
  if (!item || !band) return;

  const accepted = line.negotiation.state === 'ACCEPTED';
  const price = line.negotiation.settledPrice ?? 0;

  // --- Vaka özeti (GDD 22.3) — işlem kapandıktan SONRA üretilir ---
  const review = buildCaseReview({
    item,
    market: s.market,
    band,
    price,
    accepted,
    testsUsed: line.testResults.map((r) => r.toolId),
    selectedThesis: line.selectedThesis,
    thesisOptions: line.thesisOptions,
  });

  let economy = economyOf(s);

  if (accepted) {
    const stored: ItemInstance = {
      ...item,
      buyCost: price,
      acquiredDay: s.market.day,
      thesis: line.selectedThesis,
      location: 'backStock',
    };

    const actual = trueValue(item, s.market);
    const margin = price > 0 ? (actual - price) / price : 0;

    const tx: SettlementTransaction = {
      // Kalem bazlı benzersiz kimlik → çift tap ve reload koruması.
      txId: `settle_${deal.dealId}_${line.lineId}`,
      dealId: deal.dealId,
      day: s.market.day,
      cashDelta: -price,
      itemsIn: [stored],
      itemsOut: [],
      trustDelta: 0,
      reputationDelta: Math.round(
        (customer.trust - 50) / 50 * 2,
      ),
      xpDelta: xpForDeal({
        testsUsed: line.testResults.length,
        confidence: band.confidence,
        margin,
      }),
      label: `${item.displayName} alımı`,
    };

    const outcome = applyTransaction(economy, tx);
    if (!outcome.applied) {
      // Zaten uygulanmış — sessizce çık. Bu, GDD 22.1'in "çift tap ikinci
      // işlem oluşturmaz" garantisinin çalıştığı yerdir.
      set({ lastReview: review });
      return;
    }
    economy = outcome.state;
  }

  // --- DealRecord (GDD 22.2) ---
  const record: DealRecord = {
    dealId: `${deal.dealId}_${line.lineId}`,
    customerId: customer.id,
    lineIds: [line.lineId],
    itemIds: [item.id],
    side: 'buy',
    day: s.market.day,
    clockMinutes: s.market.clockMinutes,
    testsUsed: line.testResults.map((r) => r.toolId),
    estimateBand: { min: band.min, max: band.max },
    confidence: band.confidence,
    actualValue: trueValue(item, s.market),
    offerHistory: line.negotiation.offerHistory,
    finalState: line.negotiation.state,
    movesUsed: line.negotiation.moveHistory.map((m) => m.kind),
    thesisAtDeal: line.selectedThesis,
    price,
    costBasis: accepted ? price : 0,
    // GDD 34.5 — alışta realize kâr YOKTUR; kâr satışta doğar.
    realizedProfit: null,
    trustDelta: 0,
    reputationDelta: 0,
    reviewData: toReviewData(review),
  };

  economy = { ...economy, ledger: recordDeal(economy.ledger, record) };

  set({ ...economyToState(economy), lastReview: review });
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function economyOf(s: GameState): EconomyState {
  return { store: s.store, inventory: s.inventory, items: s.items, ledger: s.ledger };
}

function economyToState(e: EconomyState): Pick<GameState, 'store' | 'inventory' | 'items' | 'ledger'> {
  return { store: e.store, inventory: e.inventory, items: e.items, ledger: e.ledger };
}

export function activeLine(deal: ActiveDeal): DealLine | undefined {
  return deal.lines.find((l) => l.lineId === deal.activeLineId);
}

/** Bir kalemin band + tez seçeneklerini güncel bilgiye göre tazeler. */
function refreshLine(s: GameState, line: DealLine): DealLine {
  const item = s.items[line.itemId];
  if (!item) return line;

  const band = estimateBand(item, s.market, line.knowledge);
  const ctx: ThesisContext = {
    store: s.store,
    market: s.market,
    displayUsed: s.inventory.filter((p) => p.location === 'display').length,
    workshopUsed: s.inventory.filter((p) => p.location === 'workshop').length,
    liquidityRatio: liquidityRatio(s.store.cash, s.inventory),
  };
  const options = thesisFor(item, band, ctx);

  return {
    ...line,
    band,
    thesisOptions: options,
    selectedThesis: line.selectedThesis ?? null,
    status: line.status === 'untouched' && line.testResults.length > 0 ? 'appraised' : line.status,
  };
}

/**
 * GDD 23.10.3 — "Aşama Şeridi ileri doğru yalnız gerekli minimum koşullar
 * sağlandığında ilerler. Kilitli adım tıklanamaz."
 * Geri dönmek her zaman serbesttir ve hiçbir şeyi yeniden üretmez (GDD 23.10.3).
 */
export function canEnterStage(s: GameState, stage: WorkbenchStage): boolean {
  const deal = s.activeDeal;
  if (!deal) return false;
  const line = activeLine(deal);
  if (!line) return false;

  switch (stage) {
    case 'inspect':
      return true;
    case 'appraise':
      return true;
    case 'thesis':
      // Değerleme yapılmadan tez karşılaştırması anlamsızdır.
      return line.band !== null || line.testResults.length > 0;
    case 'negotiate':
      return line.band !== null || line.testResults.length > 0;
    case 'result':
      return isTerminal(line.negotiation.state);
  }
}

function isDealFinished(deal: ActiveDeal): boolean {
  return deal.stage === 'result' && allLinesResolved(deal.lines);
}

function allLinesResolved(lines: DealLine[]): boolean {
  return lines.every((l) => isTerminal(l.negotiation.state));
}

function openingLine(customer: Customer): string {
  switch (customer.intent) {
    case 'sell':
      return customer.lineIds.length > 1
        ? 'Birkaç parça getirdim, bakar mısınız?'
        : 'Bunu bozdurmak istiyorum.';
    case 'buy':
      return 'Bir şeye bakıyordum.';
    case 'service':
      return 'Bunun tamiri mümkün mü?';
    case 'appraisal':
      return 'Bunun değerini öğrenmek istiyorum.';
  }
}

function patienceComment(customer: Customer): string {
  const ratio = customer.patience / Math.max(1, customer.patienceMax);
  if (ratio < 0.25) return 'Biraz acelem var, uzattık.';
  if (ratio < 0.5) return 'Peki, bakın bakalım.';
  return 'Buyurun, inceleyin.';
}

function pushToast(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
  text: string,
  tone: ToastMessage['tone'],
): void {
  const id = `toast_${get().ledger.transactions.length}_${text.length}_${Date.now()}`;
  set({ toasts: [...get().toasts, { id, text, tone }].slice(-3) });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmt(n: Money): string {
  return `${Math.round(n).toLocaleString('tr-TR')} ₺`;
}

// UI'nin ihtiyaç duyduğu türetilmiş seçiciler.
export const selectors = {
  liquidity: (s: GameState) => liquidityRatio(s.store.cash, s.inventory),
  liquidityBand: (s: GameState) => liquidityBand(liquidityRatio(s.store.cash, s.inventory)),
  wealth: (s: GameState) => summarizeWealth(economyOf(s)),
  reservationDebug: (s: GameState) => {
    // Yalnız QA/geliştirme içindir; UI'da asla gösterilmez (GDD 6.6).
    const deal = s.activeDeal;
    const customer = s.activeCustomer;
    if (!deal || !customer) return null;
    const line = activeLine(deal);
    if (!line) return null;
    return effectiveReservation(
      { customer, reputation: s.store.reputation, buyCeiling: 0, knowledge: line.knowledge },
      line.negotiation,
    );
  },
};

export type { InfoField };
