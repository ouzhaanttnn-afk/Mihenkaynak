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

import {
  DAY,
  PURCHASE,
  SERVICE,
  START,
  XP,
  PATIENCE_PER_TEST_SECOND,
  type SpeedStep,
} from '@domain/balance';
import { spawnItem } from '@domain/item-spawn';
import { createMarketForDay, stepMarketIntraday } from '@domain/market';
import { nextCustomerDelay, spawnCustomer } from '@domain/customer-spawn';
import {
  dayCharacter,
  emptyTelemetry,
  recordIntent,
  type DayCharacter,
  type IntentTelemetry,
} from '@domain/intent';
import {
  createPurchaseSession,
  maxPackageLines,
  packageFitPenalty,
  packageGrams,
  purchaseCeiling,
  repricePackage,
} from '@domain/purchase';
import { CHANNEL_LABEL_TR, gramsFor } from '@domain/channels';
import {
  accrueOverdue,
  financeTerms,
  openInvoice,
  quoteLiquidation,
  repayInvoice,
  supplyLots,
} from '@domain/wholesaler';
import { applyMove, createSession, effectiveReservation, isTerminal } from '@domain/negotiation';
import { applyTest, estimateBand, initialKnowledge, trueValue } from '@domain/valuation';
import {
  effectiveCeiling,
  revalueInventory,
  thesisFor,
  type ThesisContext,
} from '@domain/thesis';
import {
  applyTransaction,
  closeDay,
  createLedger,
  liquidityBand,
  liquidityRatio,
  realizeProfit,
  recordDeal,
  summarizeWealth,
  xpForDeal,
  type EconomyState,
  type Ledger,
} from '@domain/settlement';
import { buildCaseReview, toReviewData, type CaseReview } from '@domain/deal-review';
import {
  advanceJobsOneDay,
  applyServiceToItem,
  buildQuotes,
  createServiceJob,
  createServiceSession,
  diagnose,
  findQuote,
  inHouseLoad,
  resolveDelivery,
  type QuoteContext,
} from '@domain/service';
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
  NegotiationState,
  PackageLine,
  PurchaseSession,
  ServiceJob,
  ServiceVenue,
  SettlementTransaction,
  StoreState,
  TradeSide,
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

  /**
   * Günün karakteri — Addendum §3'ün %24'lük dinamik havuzu.
   * %38/%38 intent tabanını DEĞİŞTİRMEZ; ürün karması, hacim, kalite,
   * aciliyet ve tempo gibi nitelikleri belirler.
   */
  dayCharacter: DayCharacter;
  /** §3 "dağılım ... izlenir" — üretilen intentlerin sayacı. */
  intentTelemetry: IntentTelemetry;

  /** Kapıda bekleyen müşteriler. */
  queue: { customer: Customer; items: ItemInstance[] }[];
  /** Bir sonraki müşterinin geleceği oyun dakikası. */
  nextCustomerAtMinutes: number;

  /** Atölyedeki tüm servis işleri (GDD 28.2 ServiceJob). */
  jobs: ServiceJob[];
  /** Deterministik iş kimliği için artan sayaç. */
  jobCounter: number;

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

  // --- Servis Kabul akışı (GDD 23.14) ---
  selectServiceType: (typeId: string) => void;
  selectServiceVenue: (venue: ServiceVenue) => void;
  setPromiseBuffer: (days: number) => void;
  acceptServiceJob: () => void;
  declineServiceJob: () => void;
  deliverJob: (jobId: string) => void;

  // --- Müşteri alış akışı (GDD 23.23 · Addendum §3, §4.1) ---
  togglePackageItem: (itemId: string) => void;
  /** §4.1 — sarrafiye adetle satılır; paket satırının adedini değiştirir. */
  setPackageQuantity: (itemId: string, quantity: number) => void;
  clearPackage: () => void;

  runTest: (toolId: string) => void;
  selectThesis: (channel: ExitChannel) => void;
  submitOffer: (amount: Money) => void;
  negotiationMove: (move: NegotiationMove) => void;
  finishDeal: () => void;

  // --- Toptancı (Addendum §4.2, §7) ---
  liquidateToWholesaler: (itemId: string, quantity: number, sliceCount: number) => void;
  buyFromWholesaler: (templateId: string, quantity: number) => void;
  repaySupplier: (invoiceId: string) => void;

  advanceDay: () => void;
  notify: (text: string, tone: ToastMessage['tone']) => void;
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

    dayCharacter: dayCharacter(seed, 1, market),
    intentTelemetry: emptyTelemetry(),

    queue: [],
    nextCustomerAtMinutes: DAY.openMinutes + 3,

    jobs: [],
    jobCounter: 0,

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
      let telemetry = s.intentTelemetry;

      if (clock >= nextCustomerAtMinutes && queue.length < 3) {
        const spawned = spawnCustomer(s.seed, spawnCounter, market, s.store, s.dayCharacter);
        queue = [...queue, spawned];
        spawnCounter += 1;
        telemetry = recordIntent(telemetry, spawned.customer.intent, spawned.fromDynamicPool);

        const rushActive =
          s.customerRushUntilMinutes !== null && clock < s.customerRushUntilMinutes;
        // §3: dinamik havuz "gün içi yoğunluk" karakterini belirler.
        nextCustomerAtMinutes =
          clock +
          nextCustomerDelay(s.seed, spawnCounter, DAY.customerIntervalMinutes, rushActive) *
            s.dayCharacter.tempo;
      }

      // GDD 14.3 / 15.1 — stok değeri bugünkü piyasaya göre canlı kalır.
      // Bu YALNIZ currentValue yazar; gerçekleşmiş kâra dokunmaz (GDD 34.5).
      const inventory = revalueInventory(s.inventory, s.items, thesisContext({ ...s, market }));

      set({
        market,
        inventory,
        queue,
        nextCustomerAtMinutes,
        spawnCounter,
        intentTelemetry: telemetry,
      });
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

      // GDD 23.23 intent matrisi — niyet hangi aşama dizisinin kullanılacağını
      // belirler. Servis müşterisi ana ticaret slider'ına ZORLANMAZ (GDD 23.14),
      // alış müşterisi de değerleme akışına zorlanmaz: elinde ürün yoktur,
      // ürünü oyuncu stoktan seçer.
      const intent = head.customer.intent;
      const isService = intent === 'service';
      const isPurchase = intent === 'buy' && !!head.customer.demand;
      const firstItem = head.items[0];

      // Servis akışı tanılamayla açılır; ticaret akışı incelemeyle;
      // alış akışı stok seçimiyle.
      const service = isService && firstItem ? createServiceSession() : null;
      if (service && firstItem) {
        service.diagnosis = diagnose(firstItem, s.store.level);
        service.quotes = buildQuotes(
          firstItem,
          service.diagnosis,
          quoteContext(s),
        );
      }

      const purchase =
        isPurchase && head.customer.demand ? createPurchaseSession(head.customer.demand) : null;

      // Alış akışında pazarlık tek bir "paket satırı" üzerinden yürür;
      // kalem henüz seçilmediği için itemId boştur ve paket kuruldukça dolar.
      const purchaseLines: DealLine[] =
        purchase && lines.length === 0
          ? [
              {
                lineId: `${head.customer.id}_pkg`,
                itemId: '',
                knowledge: [],
                testResults: [],
                band: null,
                thesisOptions: [],
                selectedThesis: null,
                negotiation: createSession(`${head.customer.id}_pkg`, ''),
                status: 'untouched',
              },
            ]
          : lines;

      set({
        items,
        queue: s.queue.slice(1),
        activeCustomer: head.customer,
        activeDeal: {
          dealId,
          customerId: head.customer.id,
          flow: isService ? 'service' : isPurchase ? 'purchase' : 'trade',
          stage: isService ? 'diagnose' : isPurchase ? 'stockPick' : 'inspect',
          activeLineId: purchaseLines[0]?.lineId ?? '',
          lines: purchaseLines,
          service,
          purchase,
          startedAtSec: s.market.clockMinutes * 60,
          settled: false,
        },
        customerMessage: openingLine(head.customer),
        lastReview: null,
        tab: 'shop',
      });
    },

    // -----------------------------------------------------------------------
    // Servis Kabul akışı (GDD 23.14)
    // -----------------------------------------------------------------------

    selectServiceType: (typeId) => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.service) return;
      set({
        activeDeal: {
          ...deal,
          service: { ...deal.service, selectedTypeId: typeId },
        },
      });
    },

    selectServiceVenue: (venue) => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.service) return;
      set({
        activeDeal: { ...deal, service: { ...deal.service, selectedVenue: venue } },
      });
    },

    setPromiseBuffer: (days) => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.service) return;
      const clamped = Math.min(SERVICE.promise.maxBufferDays, Math.max(0, days));
      set({
        activeDeal: {
          ...deal,
          service: { ...deal.service, promiseBufferDays: clamped },
        },
      });
    },

    /**
     * "İşi Kabul Et" — GDD 23.14 "Söz" adımının dock aksiyonu.
     *
     * Parça maliyeti KABUL ANINDA kasadan çıkar; ücret TESLİMDE girer.
     * İkisi de ayrı txId taşır, yani ikisi de idempotenttir (GDD 22.1).
     */
    acceptServiceJob: () => {
      const s = get();
      const deal = s.activeDeal;
      const customer = s.activeCustomer;
      if (!deal?.service || !customer) return;
      if (deal.service.outcome !== 'pending') return;

      const line = activeLine(deal);
      const item = line ? s.items[line.itemId] : undefined;
      if (!item) return;

      const quote = findQuote(
        deal.service.quotes,
        deal.service.selectedTypeId,
        deal.service.selectedVenue,
      );
      if (!quote || quote.blockedReason) return;

      if (quote.partsCost > s.store.cash) {
        pushToast(set, get, 'Parça maliyeti için yeterli nakit yok.', 'negative');
        return;
      }

      const job = createServiceJob({
        rootSeed: s.seed,
        jobIndex: s.jobCounter,
        item,
        customerId: customer.id,
        customerName: customer.displayName,
        quote,
        today: s.market.day,
        promiseBufferDays: deal.service.promiseBufferDays,
      });

      const tx: SettlementTransaction = {
        txId: `service_accept_${job.jobId}`,
        dealId: deal.dealId,
        day: s.market.day,
        cashDelta: -quote.partsCost,
        itemsIn: [],
        itemsOut: [],
        trustDelta: 0,
        reputationDelta: 0,
        xpDelta: SERVICE.xpOnAccept,
        label: `${quote.label} · parça maliyeti`,
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) return;

      // Ürün müşteride değil artık atölyededir.
      const items = { ...outcome.state.items, [item.id]: { ...item, location: 'workshop' as const } };

      set({
        ...economyToState({ ...outcome.state, items }),
        jobs: [...s.jobs, job],
        jobCounter: s.jobCounter + 1,
        activeDeal: {
          ...deal,
          stage: 'jobQueue',
          service: { ...deal.service, createdJobId: job.jobId, outcome: 'accepted' },
        },
        customerMessage: `Anlaştık. ${job.promisedDay}. gün için sözünüzü aldım.`,
      });
    },

    declineServiceJob: () => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.service) return;
      set({
        activeDeal: {
          ...deal,
          stage: 'jobQueue',
          service: { ...deal.service, outcome: 'declined' },
        },
        customerMessage: 'Peki, başka yere bakayım.',
      });
    },

    /**
     * Biten işi müşteriye teslim eder.
     *
     * GDD 22.4 — "Servis net katkısı: Ücret − parça − dış usta − tazmin."
     * GDD EK F — "Servis işi duplicate completion üretmiyor": txId iş kimliğini
     * taşır ve `result: 'delivered'` ikinci teslimi baştan engeller.
     */
    deliverJob: (jobId) => {
      const s = get();
      const job = s.jobs.find((j) => j.jobId === jobId);
      if (!job) return;
      if (job.result === 'pending' || job.result === 'delivered') return;

      const item = s.items[job.itemId];
      if (!item) return;

      const delivery = resolveDelivery(job, item, s.market.day);

      const tx: SettlementTransaction = {
        txId: `service_deliver_${job.jobId}`,
        dealId: job.jobId,
        day: s.market.day,
        cashDelta: delivery.cashDelta,
        itemsIn: [],
        itemsOut: [],
        trustDelta: delivery.trustDelta,
        reputationDelta: delivery.reputationDelta,
        xpDelta: delivery.succeeded ? SERVICE.xpOnDelivery : 0,
        label: `${job.itemName} · servis teslimi`,
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) return;

      // Başarılı serviste ürünün kondisyonu gerçekten iyileşir.
      const servicedItem = applyServiceToItem(item, job);
      const items = {
        ...outcome.state.items,
        [item.id]: { ...servicedItem, location: 'customer' as const },
      };

      // Servis geliri GERÇEKLEŞMİŞ katkıdır — iş tamamlandı ve teslim edildi.
      const ledger = realizeProfit(outcome.state.ledger, delivery.cashDelta, 0);

      set({
        ...economyToState({ ...outcome.state, items, ledger }),
        jobs: s.jobs.map((j) =>
          j.jobId === jobId ? { ...j, result: 'delivered' as const } : j,
        ),
      });

      pushToast(set, get, delivery.message, delivery.succeeded ? 'positive' : 'negative');
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

    // -----------------------------------------------------------------------
    // Müşteri alış akışı — Stok seçimi → Değer/Paket → Pazarlık (GDD 23.23)
    // -----------------------------------------------------------------------
    togglePackageItem: (itemId) => {
      const s = get();
      const deal = s.activeDeal;
      const customer = s.activeCustomer;
      if (!deal || !customer || !deal.purchase) return;
      if (packageLocked(deal)) {
        pushToast(set, get, 'Pazarlık başladı; paket artık değiştirilemez.', 'negative');
        return;
      }

      const lines = deal.purchase.lines;
      const existing = lines.find((l) => l.itemId === itemId);
      const limit = maxPackageLines(s.store);

      if (!existing && lines.length >= limit) {
        pushToast(set, get, `Bu dükkân kademesinde pakete en fazla ${limit} kalem konur.`, 'negative');
        return;
      }

      // §4.1 — yeni satır talebin gerektirdiği kadar adetle açılır; stok
      // yetmiyorsa olan kadarıyla. Oyuncuyu 40 kez dokunmaya zorlamak
      // "toplu müşteri" fikrini ekranda yalanlardı.
      const next = existing
        ? lines.filter((l) => l.itemId !== itemId)
        : [...lines, { itemId, quantity: openingQuantity(s, deal.purchase, itemId) }];

      applyPackage(set, get, next);
    },

    setPackageQuantity: (itemId, quantity) => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.purchase) return;
      if (packageLocked(deal)) return;

      const position = s.inventory.find((p) => p.itemId === itemId);
      if (!position) return;

      // Stokta olmayan adedi satmak stok uydurmaktır (GDD 34.4).
      const capped = Math.max(0, Math.min(position.quantity, Math.round(quantity)));
      const next =
        capped <= 0
          ? deal.purchase.lines.filter((l) => l.itemId !== itemId)
          : deal.purchase.lines.map((l) => (l.itemId === itemId ? { ...l, quantity: capped } : l));

      applyPackage(set, get, next);
    },

    clearPackage: () => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.purchase || packageLocked(deal)) return;
      applyPackage(set, get, []);
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
      const isPurchase = deal.flow === 'purchase' && !!deal.purchase;

      // Addendum §3 terminolojisi: alış akışında YÖN terstir — oyuncu satar,
      // müşteri alır. Aynı durum makinesi, farklı eşik yönü.
      const ctx = {
        customer,
        direction: (isPurchase ? 'shopSells' : 'shopBuys') as TradeSide,
        reputation: s.store.reputation,
        buyCeiling: effectiveCeiling(options, line.selectedThesis),
        purchaseCeiling: isPurchase ? effectivePurchaseCeiling(deal, customer, s) : undefined,
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
        if (isPurchase) settlePurchase(set, get, session.settledPrice ?? 0, session.state);
        else settleLine(set, get, line.lineId);
      }
    },

    // -----------------------------------------------------------------------
    finishDeal: () => {
      set({ activeDeal: null, activeCustomer: null, customerMessage: '', lastReview: null });
    },

    // -----------------------------------------------------------------------
    // Toptancı — §4.2 toplu bozma, §7 finansman
    // -----------------------------------------------------------------------

    /**
     * §4.2 — sarrafiyeyi toptancıya bozar. Ödeme aynı gün; bu kanalın satış
     * gerekçesi zaten hız ve kesinliktir.
     */
    liquidateToWholesaler: (itemId, quantity, sliceCount) => {
      const s = get();
      const quote = quoteLiquidation(
        { itemId, quantity },
        s.items,
        s.inventory,
        s.market,
        s.store,
        sliceCount,
      );
      if (!quote) return;

      const item = s.items[itemId];
      if (!item) return;

      const tx: SettlementTransaction = {
        // Gün + kalem + adet bazlı kimlik: aynı bozmayı çift tap ikinci kez
        // uygulamaz (GDD 22.1).
        txId: `wsale_${s.market.day}_${itemId}_${quote.quantity}_${s.ledger.transactions.length}`,
        dealId: `wsale_${s.market.day}_${itemId}`,
        day: s.market.day,
        cashDelta: quote.gross,
        itemsIn: [],
        itemsOut: [{ itemId, quantity: quote.quantity }],
        trustDelta: 0,
        reputationDelta: 0,
        xpDelta: 0,
        label: `${quote.quantity} adet ${item.displayName} bozma`,
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) return;

      // GDD 34.5 — kâr SATIŞTA doğar; bozma da bir satıştır.
      const ledger = recordDeal(
        realizeProfit(outcome.state.ledger, quote.gross, quote.costBasis),
        {
          dealId: tx.dealId + `_${s.ledger.deals.length}`,
          customerId: 'wholesaler',
          lineIds: [],
          itemIds: [itemId],
          side: 'sell',
          day: s.market.day,
          clockMinutes: s.market.clockMinutes,
          testsUsed: [],
          estimateBand: { min: quote.gross, max: quote.gross },
          confidence: 'high',
          actualValue: quote.gross,
          offerHistory: [],
          finalState: 'ACCEPTED',
          movesUsed: [],
          thesisAtDeal: 'wholesale',
          price: quote.gross,
          costBasis: quote.costBasis,
          realizedProfit: quote.gross - quote.costBasis,
          units: quote.quantity,
          grams: quote.grams,
          channel: 'wholesaler',
          isBulk: quote.quantity >= PURCHASE.bulkChannelThreshold,
          trustDelta: 0,
          reputationDelta: 0,
          reviewData: {
            missedSignals: [],
            keyDecisionPoint: `${quote.slices.length} dilimde bozuldu.`,
            alternativeChannelNote: quote.rationale,
          },
        },
      );

      const revalued = revalueInventory(
        outcome.state.inventory,
        outcome.state.items,
        thesisContext(get()),
      );
      set(economyToState({ ...outcome.state, inventory: revalued, ledger }));

      const profit = quote.gross - quote.costBasis;
      pushToast(
        set,
        get,
        `${quote.quantity} adet bozuldu · ${fmt(quote.gross)} · ${fmt(profit)} kâr`,
        profit >= 0 ? 'positive' : 'negative',
      );
    },

    /**
     * §7 — toptancıdan mal alır. Nakit yetmezse kalanı VADEYE yazılır;
     * koşullar işlem öncesi hesaplanır ve burada aynen uygulanır.
     */
    buyFromWholesaler: (templateId, quantity) => {
      const s = get();
      const probe = spawnItem(s.seed, s.spawnCounter * 100 + 7, templateId);
      const lot = supplyLots(s.market, s.store, [probe])[0];
      if (!lot) return;

      const units = Math.max(1, Math.min(lot.quantity, Math.round(quantity)));
      const amount = lot.unitPrice * units;
      const terms = financeTerms(s.store, amount, s.market.day);

      if (terms.blockedReason) {
        pushToast(set, get, terms.blockedReason, 'negative');
        return;
      }

      const invoiceId = `inv_${s.market.day}_${templateId}_${s.store.supplier.openInvoices.length}`;

      // Her adet ayrı bir kalem olarak girer ve yığın kuralı onları
      // birleştirir (GDD 22.1). Böylece "40 adet" tek pozisyon olur ama
      // maliyet tabanı gerçek birim maliyettir.
      const itemsIn: ItemInstance[] = Array.from({ length: units }, (_, i) => ({
        ...spawnItem(s.seed, s.spawnCounter * 100 + 7, templateId),
        id: `${probe.id}_${s.market.day}_${i}`,
        // Vade farkı maliyet tabanına BİNER: finanse edilmiş malın gerçek
        // maliyeti daha yüksektir ve kâr hesabı bunu görmek zorundadır.
        buyCost: Math.round((amount + terms.financeCost) / units),
        acquiredDay: s.market.day,
        location: 'backStock' as const,
      }));

      const tx: SettlementTransaction = {
        txId: `wbuy_${invoiceId}`,
        dealId: `wbuy_${invoiceId}`,
        day: s.market.day,
        // Vadeye yazılan kısım bugün kasadan ÇIKMAZ.
        cashDelta: -terms.fromCash,
        itemsIn,
        itemsOut: [],
        trustDelta: 0,
        reputationDelta: 0,
        xpDelta: 0,
        label: `${units} adet ${lot.displayName} tedariki`,
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) {
        pushToast(set, get, outcome.reason ?? 'Tedarik uygulanamadı.', 'negative');
        return;
      }

      const supplier =
        terms.totalDue > 0
          ? openInvoice(outcome.state.store.supplier, {
              id: invoiceId,
              amount: terms.totalDue,
              dueDay: terms.dueDay,
            })
          : outcome.state.store.supplier;

      const revalued = revalueInventory(
        outcome.state.inventory,
        outcome.state.items,
        thesisContext(get()),
      );
      set(
        economyToState({
          ...outcome.state,
          store: { ...outcome.state.store, supplier },
          inventory: revalued,
        }),
      );

      pushToast(
        set,
        get,
        terms.financed > 0
          ? `${units} adet alındı · ${fmt(terms.fromCash)} peşin, ${fmt(terms.totalDue)} ${terms.dueDay}. güne vadeli`
          : `${units} adet alındı · ${fmt(amount)} peşin`,
        'info',
      );
    },

    /** §7 "Kullanılan limit, geri ödeme ile serbestleşir." */
    repaySupplier: (invoiceId) => {
      const s = get();
      const invoice = s.store.supplier.openInvoices.find((i) => i.id === invoiceId);
      if (!invoice) return;
      if (invoice.amount > s.store.cash) {
        pushToast(set, get, 'Vadeyi kapatacak nakit yok.', 'negative');
        return;
      }

      const tx: SettlementTransaction = {
        txId: `repay_${invoiceId}`,
        dealId: `repay_${invoiceId}`,
        day: s.market.day,
        cashDelta: -invoice.amount,
        itemsIn: [],
        itemsOut: [],
        trustDelta: 0,
        reputationDelta: 0,
        xpDelta: 0,
        label: 'Toptancı vadesi ödemesi',
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) return;

      const { supplier, onTime } = repayInvoice(
        outcome.state.store.supplier,
        invoiceId,
        s.market.day,
      );
      set(
        economyToState({
          ...outcome.state,
          store: { ...outcome.state.store, supplier },
        }),
      );

      pushToast(
        set,
        get,
        onTime
          ? `Vade kapandı · güven ${supplier.trust}/100`
          : `Vade GECİKMELİ kapandı · güven ${supplier.trust}/100`,
        onTime ? 'positive' : 'negative',
      );
    },

    advanceDay: () => {
      const s = get();
      const { state: closed, report } = closeDay(economyOf(s), s.market.day);
      const nextDay = s.market.day + 1;
      const market = createMarketForDay(s.seed, nextDay, s.market);

      // Stok yaşlanması (GDD 15.3) + yeni günün piyasasına göre yeniden değerleme.
      const aged = closed.inventory.map((p) => ({ ...p, age: p.age + 1 }));
      const inventory = revalueInventory(aged, closed.items, thesisContext({ ...s, market }));

      // GDD 17.3 — her servis işi süre tüketir. Bu ADIM PARA HAREKETİ ÜRETMEZ;
      // gelir yalnız teslimde doğar (GDD 17.4 pasif gelir yasağı).
      const jobs = advanceJobsOneDay(s.jobs);

      // §7 "Gecikme; maliyet, limit, güven veya erişim üzerinde sonuç
      // doğurur." Gecikme yükü borcun kendisine biner ve gün raporunda
      // görünür — geriye dönük veya gizli bir kalem açılmaz.
      const overdue = accrueOverdue(closed.store.supplier, nextDay);
      const store = { ...closed.store, supplier: overdue.supplier };

      set({
        ...economyToState({ ...closed, store, inventory }),
        ledger: { ...closed.ledger, realizedProfitToday: 0 },
        jobs,
        market,
        // §3: her günün kendi karakteri var; havuz gün başında yeniden çekilir.
        dayCharacter: dayCharacter(s.seed, market.day, market),
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

      if (overdue.penalty > 0) {
        pushToast(
          set,
          get,
          `${overdue.overdueIds.length} vade gecikti · ${fmt(overdue.penalty)} gecikme yükü`,
          'negative',
        );
      }

      const ready = jobs.filter((j) => j.result === 'success' || j.result === 'failed').length;
      if (ready > 0) {
        pushToast(set, get, `${ready} servis işi teslime hazır — Atölye'ye bak.`, 'info');
      }
    },

    notify: (text, tone) => pushToast(set, get, text, tone),

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
    // Alış tarafı tek kalemdir; §4.1 telemetrisi satış tarafında iş görür.
    units: 1,
    grams: gramsFor(item, 1),
    channel: null,
    isBulk: false,
    // GDD 34.5 — alışta realize kâr YOKTUR; kâr satışta doğar.
    realizedProfit: null,
    trustDelta: 0,
    reputationDelta: 0,
    reviewData: toReviewData(review),
  };

  economy = { ...economy, ledger: recordDeal(economy.ledger, record) };

  const revalued = revalueInventory(economy.inventory, economy.items, thesisContext(get()));
  set({ ...economyToState({ ...economy, inventory: revalued }), lastReview: review });
}

/** Pazarlık başladıysa paket kilitlidir (GDD 34.2 tavanı yeniden zar atılamaz). */
function packageLocked(deal: ActiveDeal): boolean {
  return deal.lines.some((l) => l.negotiation.offerHistory.length > 0);
}

/**
 * §4.1 — bir satır pakete ilk konduğunda kaç adetle açılır.
 * Talebin eksiği kadar, stokta olanı aşmadan. Toplu müşteriye tek tek adet
 * eklettirmek, "ayrı hacim bandı" fikrini arayüzde geçersiz kılardı.
 */
function openingQuantity(s: GameState, purchase: PurchaseSession, itemId: string): number {
  const position = s.inventory.find((p) => p.itemId === itemId);
  if (!position) return 1;
  const missing = Math.max(1, purchase.demand.quantity - purchase.units);
  return Math.max(1, Math.min(position.quantity, missing));
}

/** Paketi yeniden fiyatlayıp state'e yazar — tek giriş noktası. */
function applyPackage(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
  lines: PackageLine[],
): void {
  const s = get();
  const deal = s.activeDeal;
  const customer = s.activeCustomer;
  if (!deal?.purchase || !customer) return;

  const purchase = repricePackage(deal.purchase, lines, s.items, s.inventory, customer, s.market);
  set({
    activeDeal: {
      ...deal,
      purchase,
      lines: syncPackageLine(deal.lines, purchase.lines.map((l) => l.itemId)),
    },
  });
}

/**
 * Paket satırının itemId'sini seçimle senkron tutar. Pazarlık satırı tek
 * kalırken temsil ettiği kalemler değişebilir; ilk kalem "yüz" olur.
 */
function syncPackageLine(lines: DealLine[], itemIds: string[]): DealLine[] {
  if (lines.length === 0) return lines;
  return lines.map((l, i) => (i === 0 ? { ...l, itemId: itemIds[0] ?? '' } : l));
}

/**
 * Müşterinin bu PAKET için ödeme tavanı (GDD 6.6: asla gösterilmez).
 *
 * Oranı spawn anında sabittir (GDD 34.2); TL karşılığı paketten türer.
 * Yanlış mal sunmak tavanı düşürür — §9'un "her koşulda en iyi sonuç yok"
 * ilkesinin müşteri tarafındaki karşılığı.
 */
function effectivePurchaseCeiling(deal: ActiveDeal, customer: Customer, s: GameState): Money {
  const purchase = deal.purchase;
  if (!purchase) return customer.reservationPrice;

  const base = purchaseCeiling(customer, purchase.packageFairValue);

  // Kısmi karşılama müşteriyi tam memnun etmez: §4.1 "kısmen karşılanabilir"
  // demek "aynı parayı öder" demek değildir.
  const fulfilmentFactor =
    purchase.fulfilment === 'full' ? 1 : purchase.fulfilment === 'partial' ? 0.94 : 0.8;

  // Yanlış mal sunmak tavanı düşürür (§9 — hiçbir seçim her koşulda en iyi
  // sonucu vermez).
  const { ceilingMultiplier } = packageFitPenalty(purchase.demand, purchase.lines, s.items);

  return Math.round(base * fulfilmentFactor * ceilingMultiplier);
}

/**
 * Müşteri alış işleminin settlement'i — GDD 22.1'in TEK yazma yolu.
 *
 * GDD 34.5: kâr SATIŞTA doğar. Alışta realize kâr yoktu; burada vardır ve
 * paketin maliyet tabanına göre hesaplanır.
 */
function settlePurchase(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
  price: Money,
  state: NegotiationState,
): void {
  const s = get();
  const deal = s.activeDeal;
  const customer = s.activeCustomer;
  if (!deal || !customer || !deal.purchase) return;

  const purchase = deal.purchase;
  const accepted = state === 'ACCEPTED' && price > 0;

  let economy = economyOf(s);

  if (accepted) {
    const soldItems = purchase.lines
      .map((l) => s.items[l.itemId])
      .filter((it): it is ItemInstance => !!it);

    const tx: SettlementTransaction = {
      // Paket bazlı benzersiz kimlik → çift tap ve reload koruması (GDD 22.1).
      txId: `sale_${deal.dealId}`,
      dealId: deal.dealId,
      day: s.market.day,
      cashDelta: price,
      itemsIn: [],
      itemsOut: purchase.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      trustDelta: 0,
      reputationDelta: Math.round(((customer.trust - 50) / 50) * 2),
      xpDelta: xpForDeal({
        testsUsed: 0,
        confidence: 'high',
        margin: purchase.packageCost > 0 ? (price - purchase.packageCost) / purchase.packageCost : 0,
      }),
      label:
        purchase.units > soldItems.length
          ? `${purchase.units} adet sarrafiye satışı`
          : `${soldItems.length} kalem satışı`,
    };

    const outcome = applyTransaction(economy, tx);
    if (!outcome.applied) return;

    economy = {
      ...outcome.state,
      // GDD 34.5 — gerçekleşmiş kâr TAM BURADA doğar, başka hiçbir yerde.
      ledger: realizeProfit(outcome.state.ledger, price, purchase.packageCost),
    };
  }

  const record: DealRecord = {
    dealId: `${deal.dealId}_pkg`,
    customerId: customer.id,
    lineIds: deal.lines.map((l) => l.lineId),
    itemIds: purchase.lines.map((l) => l.itemId),
    side: 'sell',
    day: s.market.day,
    clockMinutes: s.market.clockMinutes,
    testsUsed: [],
    estimateBand: { min: purchase.packageFairValue, max: purchase.packageFairValue },
    // Alış akışında ürün oyuncunun kendi stoğudur; gerçeği zaten bilinir.
    confidence: 'high',
    actualValue: purchase.packageFairValue,
    offerHistory: deal.lines[0]?.negotiation.offerHistory ?? [],
    finalState: state,
    movesUsed: deal.lines[0]?.negotiation.moveHistory.map((m) => m.kind) ?? [],
    thesisAtDeal: null,
    price: accepted ? price : 0,
    costBasis: accepted ? purchase.packageCost : 0,
    realizedProfit: accepted ? price - purchase.packageCost : null,
    // §4.1 — adet, gram ve kanal ayrı ölçülür ki toplu işlem tekil müşteri
    // ortalamasını şişirmesin.
    units: purchase.units,
    grams: packageGrams(purchase.lines, s.items),
    channel: purchase.channel,
    isBulk: purchase.demand.isBulk,
    trustDelta: 0,
    reputationDelta: 0,
    reviewData: {
      missedSignals: [],
      keyDecisionPoint:
        purchase.fulfilment === 'partial'
          ? 'Talep kısmen karşılandı; müşteri eksik adede razı oldu.'
          : 'Paket talebi tam karşıladı.',
      alternativeChannelNote: `${CHANNEL_LABEL_TR[purchase.channel]} makasıyla fiyatlandı.`,
    },
  };

  economy = { ...economy, ledger: recordDeal(economy.ledger, record) };

  const revalued = revalueInventory(economy.inventory, economy.items, thesisContext(get()));
  set({
    ...economyToState({ ...economy, inventory: revalued }),
    activeDeal: { ...deal, settled: true },
  });
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

/**
 * Tez bağlamı — oyuncunun kapasitesi ve likiditesi hangi kanalın rasyonel
 * olduğunu değiştirir (GDD 6.4). Tek yerde üretilir ki değerleme ile stok
 * yeniden değerlemesi aynı varsayımları kullansın.
 */
function thesisContext(s: Pick<GameState, 'store' | 'market' | 'inventory'>): ThesisContext {
  return {
    store: s.store,
    market: s.market,
    displayUsed: s.inventory.filter((p) => p.location === 'display').length,
    workshopUsed: s.inventory.filter((p) => p.location === 'workshop').length,
    liquidityRatio: liquidityRatio(s.store.cash, s.inventory),
  };
}

/** Bir kalemin band + tez seçeneklerini güncel bilgiye göre tazeler. */
function refreshLine(s: GameState, line: DealLine): DealLine {
  const item = s.items[line.itemId];
  if (!item) return line;

  const band = estimateBand(item, s.market, line.knowledge);
  const ctx = thesisContext(s);
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

  // --- Servis Kabul akışı (GDD 23.14) ---
  // Adımlar sırayla açılır: teklif için tanı, söz için seçilmiş bir teklif,
  // kuyruk için verilmiş bir karar gerekir.
  if (deal.flow === 'service') {
    const service = deal.service;
    if (!service) return false;

    switch (stage) {
      case 'diagnose':
        return true;
      case 'quote':
        return service.diagnosis !== null;
      case 'promise':
        return (
          findQuote(service.quotes, service.selectedTypeId, service.selectedVenue) !== null
        );
      case 'jobQueue':
        return service.outcome !== 'pending';
      default:
        // Ticaret aşamaları servis akışında kilitlidir.
        return false;
    }
  }

  // --- Müşteri alış akışı (GDD 23.23) ---
  // Stok seçimi her zaman açık; paket ekranı en az bir kalem ister;
  // pazarlık, talebin karşılanabilir bir paketle karşılanmasını ister.
  if (deal.flow === 'purchase') {
    const purchase = deal.purchase;
    if (!purchase) return false;

    switch (stage) {
      case 'stockPick':
        return true;
      case 'package':
        return purchase.lines.length > 0;
      case 'negotiate':
        // §4.1: kısmi karşılamayı kabul etmeyen müşteriye eksik paket sunulmaz.
        return purchase.fulfilment !== 'none';
      case 'result':
        return isTerminal(line.negotiation.state);
      default:
        return false;
    }
  }

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
    default:
      // Servis aşamaları ticaret akışında kilitlidir.
      return false;
  }
}

/** Tez/teklif bağlamı — kapasite ve likidite kararı değiştirir (GDD 6.4 / 17.3). */
export function quoteContext(
  s: Pick<GameState, 'store' | 'market' | 'jobs'>,
): QuoteContext {
  return {
    store: s.store,
    market: s.market,
    workshopLoad: inHouseLoad(s.jobs),
    day: s.market.day,
  };
}

function isDealFinished(deal: ActiveDeal): boolean {
  if (deal.flow === 'service') {
    return deal.stage === 'jobQueue' && deal.service?.outcome !== 'pending';
  }
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
      // Talep spawn anında sabittir; müşteri ne aradığını ilk cümlede söyler
      // ki oyuncu stok seçimine bilgiyle girsin (GDD 23.23).
      return customer.demand
        ? `${customer.demand.summary} için geldim.`
        : 'Bir şeye bakıyordum.';
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
