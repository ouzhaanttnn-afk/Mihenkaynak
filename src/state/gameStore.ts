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
  isProductCompatible,
  maxPackageLines,
  minSaleOffer,
  offerableStock,
  packageFitPenalty,
  packageGrams,
  purchaseCeiling,
  repricePackage,
} from '@domain/purchase';
import { CHANNEL_LABEL_TR, gramsFor } from '@domain/channels';
import {
  measurePosition,
  resolveOvernight,
  type OvernightOutcome,
  type OvernightPosition,
} from '@domain/overnight';
import {
  accrueNetworkOverdue,
  applyLiquidation,
  networkLiquidationOffer,
  networkLoanOffer,
  openLoan,
  repayLoan,
  replenishNetwork,
  spawnNetwork,
} from '@domain/trade-network';
import {
  accrueOverdue,
  creditLimit,
  financeTerms,
  openInvoice,
  quoteLiquidation,
  repayInvoice,
  supplyOffer,
  tradeTrustAfterPurchase,
} from '@domain/wholesaler';
import { applyMove, createSession, effectiveReservation, isTerminal } from '@domain/negotiation';
import { applyTest, estimateBand, initialKnowledge, trueValue } from '@domain/valuation';
import {
  CHANNEL_SHORT,
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
  stackKey,
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
import {
  createRecord,
  dealReputationDelta,
  recordVisit,
  visitReputationDelta as visitReputation,
  type CustomerRegistry,
} from '@domain/customer-memory';
import {
  createDemandLog,
  missedToday,
  recordMissedDemand,
  rolloverDemandLog,
  topMissedDemand,
  type DemandLog,
  type MissedDemandRow,
} from '@domain/demand-log';
import { flowPolicy, stageUnlocked, transactionClass } from '@domain/transaction-class';
import {
  nextLesson,
  skipAll,
  type CoachContext,
  type ProductKind,
} from '@domain/onboarding';
import { isBullion } from '@data/bullion';
import {
  checkJewelerName,
  defaultProfile,
  normalizeAvatarId,
  type PlayerProfile,
} from '@domain/profile';
import { getTemplate } from '@data/item-templates';
import { rulesFor } from '@data/product-classes';
import {
  appraisalTransaction,
  feeBounds,
  resolveAppraisal,
  suggestedFee,
} from '@domain/appraisal';
import { applyTierGrants, evaluateUpgrade, growthSnapshot } from '@domain/store-growth';
import { demandIsSellable } from '@domain/sales-catalog';
import { normalizeSettings, type GameSettings } from '@domain/settings';

/**
 * Stok ekranından açılabilen İşletme alt rotaları (§8) ve Ayarlar.
 * Ayarlar buraya eklendi çünkü giriş noktası Dükkan ana ekranında: gezinme
 * işaretini taşıyan mekanizma zaten vardı, ikincisini kurmak gereksizdi.
 */
export type BusinessRoute = 'wholesaler' | 'network' | 'settings';

/** Gün kapanışının oyuncuya gösterilecek özeti (§B4). */
export interface DayCloseSummary {
  day: number;
  realizedProfit: Money;
  overhead: Money;
  netCashChange: Money;
  cashAfter: Money;
  stockPotential: Money;
  liquidity: number;
  /** Gecelik pozisyonun sonucu — GDD 34.5: gerçekleşmiş kâra YAZILMAZ. */
  overnight: string | null;
  /** Vade ve esnaf gecikmeleri gibi, düşerse kaybolacak satırlar. */
  warnings: string[];
  upcoming: { label: string; amount: Money; dueDay: number }[];
  /**
   * Bugün stok yokluğundan geri çevrilen talepler (en çok üçü). Gün raporu,
   * oyuncunun yarınki stok kararını verdiği yerdir; kaçan talebi burada
   * görmezse karar körlemesine kalır.
   */
  missedDemand: MissedDemandRow[];
  /** Bugün toplam kaç talep karşılanamadı. */
  missedDemandTotal: number;
}

/**
 * AYARLAR MAĞAZADAN ÖNCE OKUNUR VE DİL HEMEN UYGULANIR.
 *
 * `setLocale`i React efektine bırakmak DENENDİ ve tarayıcıda kırık çıktı:
 * efekt ilk çizimden SONRA çalışıyor, dil ise React durumu değil modül
 * durumu olduğu için sonrasında hiçbir şey yeniden çizilmiyordu. Sonuç:
 * oyuncu İngilizceyi seçip sayfayı yeniliyor, tercih kayıtta duruyor ama
 * ekran Türkçe açılıyordu.
 *
 * Modül değerlendirmesi ilk çizimden önce biter; dil burada uygulanınca
 * ilk kare zaten doğru dilde çizilir. Sonraki değişiklikler mağazadaki
 * `settings` üzerinden yeniden çizim tetiklediği için sorun çıkarmaz.
 *
 * SES BURADA BAŞLATILMAZ: tarayıcı kullanıcı dokunmadan ses bağlamı
 * açtırmaz; o iş ilk dokunuşa bağlı (App.tsx · unlockAudio).
 */
const INITIAL_SETTINGS = loadSettings();
setLocale(INITIAL_SETTINGS.locale);
import { loadSettings, persistSettings } from './settings-store';
import { playSfx, syncAudioSettings } from '@ui/audio';
import { vibrate } from '@ui/haptics';
import { setLocale } from '@ui/i18n';
import { getServiceType } from '@data/service-types';
import { customerRequestLine } from '@ui/intent-line';
import { clearSave, persistProfile, readSave, writeSave } from './save';
import type {
  ActiveDeal,
  AppraisalSession,
  AppraisalStance,
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
  TradeNetworkMember,
  VisitRecord,
  TradeSide,
  WorkbenchStage,
} from '@domain/types';

// ---------------------------------------------------------------------------
// Durum şekli
// ---------------------------------------------------------------------------

/**
 * UPDATEv1 §13 — 'market' EKLENDİ.
 * Sıra alt navigasyondaki sıradır: Dükkan / Stok / Atölye / Market / İşletme.
 * Bu sürümde Market yalnız boş bir rota; katalog, ürün modeli ve satın alma
 * sistemi BİLEREK yok (§13 "kesinlikle yapılmayacaklar").
 */
export type RootTab = 'shop' | 'stock' | 'workshop' | 'market' | 'business';

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

  /**
   * GDD 25 — görülmüş öğretim dersleri. Kayıtla taşınır; taşınmasaydı her
   * yüklemede oyuncuya bildiği şey yeniden anlatılırdı.
   */
  seenLessons: string[];

  /**
   * Oyuncu profili — yalnız görünüm (bkz. @domain/profile).
   * Hiçbir ilerleme, ekonomi veya karar değeri taşımaz.
   */
  profile: PlayerProfile;
  /**
   * UPDATEv1 §9 — SON TESLİM SONUCU (kalıcı özet).
   *
   * Teslim sonucu yalnız 4 saniyelik bir toast'la gösteriliyordu; oyuncu
   * ücreti mi aldığını, tazmin mi ödediğini okuyamadan kayboluyordu.
   * Burada tutulur ve oyuncu "Devam Et" diyene kadar ekranda kalır.
   * Kaydedilmez: bir bildirimdir, oyun durumu değil.
   */
  lastDelivery: {
    jobId: string;
    itemName: string;
    typeLabel: string;
    succeeded: boolean;
    fee: Money;
    compensation: Money;
    cashDelta: Money;
    netContribution: Money;
    trustDelta: number;
    reputationDelta: number;
    errorRisk: number;
    lateDays: number;
  } | null;

  /** Profil düzenleme penceresi açık mı (yalnız arayüz durumu). */
  profileOpen: boolean;

  /**
   * UPDATEv1 §4 — YÖNETİM MODALI SAYACI (ortak pause mekanizması).
   *
   * Sıfırdan büyükken oyun zamanı tamamen durur: saat ilerlemez, gün
   * değişmez, gider kesilmez, sabır erimez, müşteri/olay üretilmez.
   *
   * Neden boolean değil SAYAÇ: iki modal üst üste açılıp biri kapandığında
   * boolean "devam et" derdi ve altındaki modal açıkken zaman akmaya
   * başlardı. Sayaç, açan her modalın kendi kapanışını dengelemesini şart
   * koşar; en dıştaki kapanana kadar oyun durur.
   */
  pauseDepth: number;
  customerRushUntilMinutes: number | null;

  /**
   * Günün karakteri — Addendum §3'ün %24'lük dinamik havuzu.
   * %38/%38 intent tabanını DEĞİŞTİRMEZ; ürün karması, hacim, kalite,
   * aciliyet ve tempo gibi nitelikleri belirler.
   */
  dayCharacter: DayCharacter;
  /** §3 "dağılım ... izlenir" — üretilen intentlerin sayacı. */
  intentTelemetry: IntentTelemetry;

  /**
   * GDD 10 — müşteri hafızası. Müşteri gidince silinmez; geri döndüğünde
   * ilişkisi ve geçmişiyle birlikte gelir. Güvenin "ekonomik varlık"
   * olmasının tek koşulu bu defterin kalıcı olmasıdır.
   */
  customers: CustomerRegistry;

  /** Kapıda bekleyen müşteriler. */
  queue: { customer: Customer; items: ItemInstance[] }[];
  /** Bir sonraki müşterinin geleceği oyun dakikası. */
  nextCustomerAtMinutes: number;

  /**
   * Addendum §8 — esnaf ağı üyeleri. Tek hesap değil, her biri kendi kasası
   * ve ilişkisi olan esnaflar; §8 "sınırsız ikinci banka değildir".
   */
  network: TradeNetworkMember[];

  /**
   * Addendum §5 — gün kapanışında alınan pozisyon (nakit / altın dağılımı).
   * Ertesi sabah sonucu hesaplanır; ikisi de §5'in iki yarısını taşır.
   */
  overnight: OvernightPosition | null;
  /** Dün gecenin sonucu — sabah gösterilir, sonra bir sonraki geceye devreder. */
  lastOvernight: OvernightOutcome | null;

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

  /** GDD 25 — dersi kapat; bir daha gösterilmez. */
  dismissLesson: (id: string) => void;
  /** GDD 25 — öğretimin tamamını atla. */
  skipOnboarding: () => void;

  /**
   * Kuyumcu adını ve avatarı birlikte kaydeder.
   * @returns ad geçerliyse true; geçersizse hiçbir şey yazılmaz ve false.
   */
  updateProfile: (next: { jewelerName: string; avatarId: string }) => boolean;
  openProfile: () => void;
  closeProfile: () => void;
  /** §9 — teslim sonucu panelini kapatır. */
  dismissDelivery: () => void;
  /** §4 — yönetim modalı açılırken/kapanırken zamanı durdurur/sürdürür. */
  pushPause: () => void;
  popPause: () => void;
  triggerCustomerRush: () => void;

  tick: (deltaRealSeconds: number) => void;
  /**
   * Karşılanamayan talep defteri (ölçüm, ekonomi değil). Satın almaya gelen
   * müşterinin talebine uyan stok yoksa buraya yazılır; oyuncu "ne istediler
   * de bende yoktu" sorusunu ancak böyle sorabiliyor.
   */
  missedDemand: DemandLog;

  greetCustomer: () => void;
  setStage: (stage: WorkbenchStage) => void;
  setActiveLine: (lineId: string) => void;

  // --- Servis Kabul akışı (GDD 23.14) ---
  selectServiceType: (typeId: string) => void;
  selectServiceVenue: (venue: ServiceVenue) => void;
  setPromiseBuffer: (days: number) => void;
  acceptServiceJob: () => void;
  declineServiceJob: () => void;

  // --- Ekspertiz / danışma akışı (GDD 23.23 beşinci akış) ---
  selectStance: (stance: AppraisalStance) => void;
  setAppraisalFee: (fee: Money) => void;
  issueReport: () => void;
  declineAppraisal: () => void;
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

  /*
   * UPDATEv2 §8 — STOK KALEMİ EYLEMLERİ.
   *
   * İKİSİ DE EKONOMİK DEĞİLDİR ve bilerek öyledir. §8: "Bu işlemler mevcut
   * mekanikte yoksa YENİ EKONOMİ SİSTEMİ OLUŞTURMA." Buradaki iki eylem
   * zaten var olan iki alanı (`location`, `thesis`) oyuncuya açar:
   *
   *   moveStock      — kalemi vitrin ile arka stok arasında taşır. Nakde,
   *                    maliyet tabanına, defterlere DOKUNMAZ; `applyTransaction`
   *                    çağrılmaz çünkü ortada işlem yoktur.
   *   setStockThesis — kalemin çıkış planını değiştirir. Planı değiştirmek
   *                    yalnız MARK'ı (bugünkü değer) değiştirir; gerçekleşmiş
   *                    kâr GDD 34.5 gereği satışta doğar ve buradan
   *                    etkilenmez.
   *
   * Atölye ('workshop') hedefi YOKTUR: kendi stoğunu servise vermek gerçek
   * bir iş kaydı, süre ve maliyet ister — o yeni bir ekonomi olurdu.
   */
  moveStock: (itemId: string, to: 'display' | 'backStock') => void;
  setStockThesis: (itemId: string, channel: ExitChannel) => void;

  /** §8 — Stok'tan satış rotasına geçiş; yalnız gezinme durumu. */
  pendingBusinessRoute: BusinessRoute | null;
  openBusinessRoute: (route: BusinessRoute) => void;
  consumeBusinessRoute: () => void;

  /*
   * OYUNCU AYARLARI — ses, titreşim, dil.
   *
   * Oyun durumunun parçası GİBİ durur ama DEĞİLDİR: kayıt dosyasına
   * yazılmaz, `resetGame` sıfırlamaz, seed'e ve determinizme dokunmaz.
   * Mağazada durmasının tek sebebi arayüzün tek bir yerden okuyabilmesi;
   * kalıcılığı kendi deposunda (settings-store.ts).
   */
  settings: GameSettings;
  updateSettings: (patch: Partial<GameSettings>) => void;

  // --- Esnaf ağı (Addendum §8) ---
  liquidateToNetwork: (memberId: string, itemId: string, quantity: number) => void;
  borrowFromNetwork: (memberId: string, amount: Money) => void;
  repayNetworkLoan: (memberId: string) => void;

  advanceDay: () => void;

  /*
   * GÜN KAPANIŞININ KALICI KAYDI.
   *
   * Kapanış eskiden yalnız toast'la anlatılıyordu ve toast dört saniyede
   * kayboluyordu; üstelik gün sonunda DÖRDE KADAR toast gönderiliyor ama
   * ekranda en fazla ikisi duruyor — gecikmiş vade ya da esnaf borcu
   * sessizce düşebiliyordu. Bir işletme oyununda günün kapanışı en çok
   * okunan ekrandır; burada en kısa ömürlü olanıydı.
   *
   * Panel oyuncu kapatana kadar durur. Kaydedilmez: bir sonraki gün devri
   * onu zaten tazeler, kayda yazmak türetilebilir veriyi ikinci kez
   * saklamak olurdu.
   */
  lastDayClose: DayCloseSummary | null;
  dismissDayClose: () => void;

  /**
   * Gün kapatma onayı bekliyor mu (§B3).
   * Kazara kapatmayı önler; modal açıkken oyun zamanı durur.
   */
  dayCloseAsk: boolean;
  askDayClose: () => void;
  cancelDayClose: () => void;

  /** GDD 19.2 — mağaza kademesini yükseltir. */
  upgradeStore: () => void;

  // --- Kayıt (GDD 28.1 · Addendum §11) ---
  saveGame: () => boolean;
  loadGame: () => boolean;
  resetGame: () => void;
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

/**
 * AÇILIŞ VİTRİNİ — dükkân boş açılmaz (saha defteri B9).
 *
 * Oynanışta ölçüldü: oyun sıfır stokla başlıyor ve ilk müşteri bir ALIŞ
 * müşterisi olabiliyor. On yeni oyun denendi, ikisinde ilk müşteri
 * "10 gram altın almak istiyorum" dedi. Oyuncunun oyundaki ilk eylemi
 * müşteriyi geri çevirmek oluyordu.
 *
 * SERVET DEĞİŞMEZ: mal bedava verilmez, başlangıç nakdinden DÜŞÜLÜR.
 * Oyuncu aynı sermayeyle başlar, yalnız bir kısmı vitrinde durur — gerçek
 * bir kuyumcunun kepenk açtığı hâl. Ekonomiye eklenen tek şey bu değil,
 * sadece o sermayenin biçimi.
 *
 * Ürünler satış kataloğundan gelir, elle yazılmaz: katalog değişirse vitrin
 * de değişir ve satılamayacak bir mal stoğa düşmez.
 */
function openingStock(
  restored: ReturnType<typeof readSave>,
  seed: number,
  market: MarketState,
): Pick<GameState, 'store' | 'inventory' | 'items'> {
  const store = createInitialStore();
  // Kayıttan gelen oyun kendi stoğunu taşır; açılış vitrini yalnız YENİ oyuna.
  if (restored) return { store, inventory: [], items: {} };

  const plan: { templateId: string; quantity: number }[] = [
    { templateId: 'quarter_gold', quantity: 4 },
    { templateId: 'half_gold', quantity: 2 },
    { templateId: 'gram_gold_5', quantity: 2 },
  ];

  const items: Record<string, ItemInstance> = {};
  const inventory: InventoryPosition[] = [];
  let spent = 0;

  plan.forEach((row, i) => {
    const probe = spawnItem(seed, 900_100 + i, row.templateId);
    // Maliyet piyasadan türer; uydurma bir alış fiyatı yazılmaz.
    const unit = Math.round(trueValue(probe, market));
    if (unit <= 0) return;

    const total = unit * row.quantity;
    spent += total;
    items[probe.id] = { ...probe, buyCost: total, location: 'display' };
    inventory.push({
      itemId: probe.id,
      quantity: row.quantity,
      costBasis: total,
      currentValue: total,
      age: 0,
      demand: 'steady',
      thesis: null,
      location: 'display',
      expectedExitValues: {},
    });
  });

  return {
    store: { ...store, cash: Math.max(0, store.cash - spent) },
    inventory,
    items,
  };
}

/** Yeni oyun için deterministik kök seed. */
function freshSeed(): number {
  // Yeni oyun başlatılırken bir kez seçilir ve kaydedilir; oturum boyunca
  // asla değişmez. Save'den yüklenirken dosyadaki seed kullanılır.
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export const useGame = create<GameState>((set, get) => {
  // GDD 28.1 — açılışta kayıt varsa oradan devam edilir. Kayıt bozuksa
  // readSave() null döner ve yeni oyun başlar; çökme yok (§11).
  const restored = readSave();
  const seed = restored?.seed ?? freshSeed();
  const market = restored?.market ?? createMarketForDay(seed, 1);

  return {
    seed,
    spawnCounter: 0,
    market,
    ...openingStock(restored, seed, market),
    ledger: createLedger(),

    tab: 'shop',
    speed: 1,
    speed4xUnlocked: false,
    customerRushUntilMinutes: null,
    seenLessons: [],
    profile: defaultProfile(),
    lastDelivery: null,
    lastDayClose: null,
    dayCloseAsk: false,
    profileOpen: false,
    pauseDepth: 0,
    pendingBusinessRoute: null,
    settings: INITIAL_SETTINGS,

    dayCharacter: dayCharacter(seed, 1, market),
    intentTelemetry: emptyTelemetry(),
    customers: {},
    missedDemand: createDemandLog(),
    network: spawnNetwork(seed, START.reputation),
    overnight: null,
    lastOvernight: null,

    queue: [],
    nextCustomerAtMinutes: DAY.openMinutes + 3,

    jobs: [],
    jobCounter: 0,

    activeCustomer: null,
    activeDeal: null,
    customerMessage: '',
    lastReview: null,
    toasts: [],

    // Kayıt varsa VARSAYILANLARIN ÜSTÜNE yazar. Sıra kritik: varsayılanları
    // sonra koymak, yüklenen oyunu sessizce yeni oyuna çevirirdi.
    ...(restored ?? {}),

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

    // --- GDD 25 · öğretim ---
    // Ders KAPATMAK oyunu hiç değiştirmez; yalnız o dersin bir daha
    // gösterilmemesini kaydeder. Bu yüzden atlamak da hiçbir şeyi eksik
    // bırakmaz.
    dismissLesson: (id) => {
      const seen = get().seenLessons;
      if (seen.includes(id)) return;
      set({ seenLessons: [...seen, id] });
    },

    skipOnboarding: () => set({ seenLessons: skipAll(get().seenLessons) }),

    /**
     * Profili günceller — ad ve avatar BİRLİKTE.
     *
     * Bilerek yapmadığı şey: başka hiçbir alana dokunmaz. Nakit, seviye,
     * XP, güven, stok ve defter aynı kalır; profil değiştirmek yeni oyun
     * başlatmaz. Bu yüzden burada `set` yalnız `profile` yazar.
     *
     * Geçersiz ad sessizce yutulmaz: çağıran taraf zaten doğrulamış olmalı,
     * yine de burada son bir kez süzülür ki bozuk bir ad kayda giremesin.
     */
    dismissDelivery: () => set({ lastDelivery: null }),
    dismissDayClose: () => set({ lastDayClose: null }),

    /*
      §B3 — GÜNÜ KAPATMAK ONAY İSTER.
      Ölçüldü: sekiz saniyede altı gün geçirilip 7.200 ₺ gider yazdırılabildi,
      hiçbir uyarı olmadan. Onay penceresi açıkken oyun zamanı durur; pause
      sayacı modal kalıbının kendisi.
    */
    askDayClose: () => {
      get().pushPause();
      set({ dayCloseAsk: true });
    },
    cancelDayClose: () => {
      set({ dayCloseAsk: false });
      get().popPause();
    },

    openProfile: () => set({ profileOpen: true }),
    closeProfile: () => set({ profileOpen: false }),

    pushPause: () => set({ pauseDepth: get().pauseDepth + 1 }),
    popPause: () => set({ pauseDepth: Math.max(0, get().pauseDepth - 1) }),

    updateProfile: (next) => {
      const check = checkJewelerName(next.jewelerName);
      if (!check.ok) return false;
      set({
        profile: { jewelerName: check.value, avatarId: normalizeAvatarId(next.avatarId) },
        lastDelivery: null,
    profileOpen: false,
    pauseDepth: 0,
      });
      // Tercih ANINDA kalıcı olur; oyunun gün sonu checkpoint'ini beklemez.
      // Yalnız `profile` alanı yamalanır (bkz. persistProfile).
      persistProfile(get());
      pushToast(set, get, 'Profil güncellendi.', 'positive');
      return true;
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

      /*
       * §4 — YÖNETİM MODALI AÇIKKEN ZAMAN DURUR.
       *
       * Kapı `tick`in EN BAŞINDA: buradan sonraki her şey (saat, piyasa
       * adımı, müşteri spawn'ı, stok yeniden değerleme, gün devri) tek bir
       * `return` ile durur. Tek tek durdurmaya çalışmak, birini unutmaya
       * açık olurdu — profil düzenlerken gün dönmesi tam olarak öyle bir
       * hataydı.
       *
       * Hız DEĞİŞTİRİLMEZ, yalnız ilerleme durur; modal kapanınca oyuncunun
       * seçtiği hız kendiliğinden kaldığı yerden devam eder.
       */
      if (s.pauseDepth > 0) return;

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
        const spawned = spawnCustomer(
          s.seed,
          spawnCounter,
          market,
          s.store,
          s.dayCharacter,
          s.customers,
          /*
            Dükkânda o an bulunan adlar: kuyrukta bekleyenler + tezgâhtaki.
            Kuyruk ekranda alt alta durduğu için iki aynı ad ayırt edilemez
            iki kişi demekti (ölçüldü: "Elif Hanım" hem 1. hem 2. sırada).
          */
          [
            ...queue.map((q) => q.customer.displayName),
            ...(s.activeCustomer ? [s.activeCustomer.displayName] : []),
          ],
          /*
            GDD 10.1 — itibar yükseldikçe talep dükkânın ELİNDEKİ mala kayar.
            Ölçüldü: günlük müşterinin %26'sı "istediğim mal burada yok" diye
            dönüyordu; trafiği itibara bağlarken bu kovayı da küçültmezsek
            oyun uzamaz, yorulur.
          */
          stockedTemplateIds(s),
        );
        queue = [...queue, spawned];
        spawnCounter += 1;
        telemetry = recordIntent(telemetry, spawned.customer.intent, spawned.fromDynamicPool);

        const rushActive =
          s.customerRushUntilMinutes !== null && clock < s.customerRushUntilMinutes;
        // §3: dinamik havuz "gün içi yoğunluk" karakterini belirler.
        nextCustomerAtMinutes =
          clock +
          nextCustomerDelay(
            s.seed,
            spawnCounter,
            DAY.customerIntervalMinutes,
            rushActive,
            // GDD 10.1 — itibar müşteri TRAFİĞİNİ de belirler, yalnız
            // premium segmenti değil.
            s.store.reputation,
          ) *
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

      /*
       * UPDATEv2 §18 — KARŞILANAMAZ TALEP GÜVENLİ KAPANIR.
       *
       * Satış kataloğu daraldığında (ya da ileride bir SKU kapandığında)
       * kuyrukta duran bir satın alma talebi artık karşılanamaz olabilir.
       * Oyuncuyu "stokta sunulacak ürün yok" duvarına toslatmak yerine
       * talebi burada kapatıyoruz.
       *
       * EKONOMİK YAN ETKİ YOK: yalnız kuyruktan çıkarılır. Para, stok, XP,
       * güven ve itibar bu yolda hiç yazılmaz — settlement'a hiç girilmez.
       *
       * NOT: kayıt dosyası kuyruğu ve aktif işlemi zaten taşımıyor, yani
       * pratikte bu duruma eski kayıt üzerinden düşülmez. Kapı yine de
       * burada duruyor çünkü talebin aktif işleme DÖNÜŞTÜĞÜ tek yer burası;
       * kaynağı ne olursa olsun geçersiz bir talep buradan geçemez.
       */
      if (head.customer.intent === 'buy') {
        const demand = head.customer.demand;
        if (!demand || !demandIsSellable(demand.templateId, s.store.storeTier)) {
          set({ queue: s.queue.slice(1), activeCustomer: null });
          pushToast(
            set,
            get,
            'Bu müşteri artık satış kataloğunda olmayan bir ürün istiyordu; talep kapatıldı.',
            'info',
          );
          return;
        }
      }

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

      // GDD 10 — ilk karşılaşmada kalıcı kayıt açılır. Kayıt açmadan güven
      // yazacak yer olmaz ve müşteri yine yabancı kalırdı.
      const customers = s.customers[head.customer.id]
        ? s.customers
        : {
            ...s.customers,
            [head.customer.id]: createRecord(head.customer, s.market.day, s.spawnCounter),
          };

      // GDD 23.23 intent matrisi — niyet hangi aşama dizisinin kullanılacağını
      // belirler. Servis müşterisi ana ticaret slider'ına ZORLANMAZ (GDD 23.14),
      // alış müşterisi de değerleme akışına zorlanmaz: elinde ürün yoktur,
      // ürünü oyuncu stoktan seçer.
      const intent = head.customer.intent;
      const isService = intent === 'service';
      const isPurchase = intent === 'buy' && !!head.customer.demand;

      /*
       * KAÇAN TALEP ÖLÇÜMÜ — müşteri karşılanırken, talebine uyan stok var mı?
       *
       * Burada ölçülür çünkü talebin AKTİF İŞLEME dönüştüğü tek yer burası;
       * ve tam bu anda envanter neyse odur. Sonra ölçmek, oyuncunun pazarlık
       * sırasında sattığı malı "vardı" saymak olurdu.
       *
       * Yalnız SAYAR: ne para, ne stok, ne güven, ne itibar, ne XP.
       */
      let missedDemand = s.missedDemand;
      if (isPurchase && head.customer.demand) {
        const uyan = offerableStock(head.customer.demand, s.inventory, items);
        if (uyan.length === 0) {
          // Şablonsuz (aile bazlı) talepte aile adı anahtardır; ikisi de
          // yoksa yazacak bir şey yok demektir ve `recordMissedDemand` eler.
          const anahtar =
            head.customer.demand.templateId ?? head.customer.demand.families[0] ?? '';
          missedDemand = recordMissedDemand(missedDemand, anahtar);
        }
      }
      // GDD 23.23 beşinci akış — ekspertiz. Müşteri ürününü satmaya değil,
      // ne ettiğini öğrenmeye gelir; ürün hiçbir an dükkânın olmaz.
      const isAppraisal = intent === 'appraisal';
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

      const appraisal: AppraisalSession | null =
        isAppraisal && firstItem
          ? { stance: null, fee: 0, verdict: null, outcome: 'pending' }
          : null;

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
        customers,
        missedDemand,
        queue: s.queue.slice(1),
        activeCustomer: head.customer,
        activeDeal: {
          dealId,
          customerId: head.customer.id,
          flow: isService
            ? 'service'
            : isPurchase
              ? 'purchase'
              : isAppraisal
                ? 'appraisal'
                : 'trade',
          // Ekspertiz de incelemeyle açılır — akışın ilk adımı "İncele".
          stage: isService ? 'diagnose' : isPurchase ? 'stockPick' : 'inspect',
          activeLineId: purchaseLines[0]?.lineId ?? '',
          lines: purchaseLines,
          service,
          purchase,
          appraisal,
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
        /*
          §9 — KALICI SONUÇ ÖZETİ.
          Toast korunuyor (anlık geri bildirim) ama tek başına yeterli
          değildi: ücret/tazmin rakamları 4 saniyede kayboluyordu. Panel
          oyuncu kapatana kadar durur.

          ÇİFT UYGULAMA RİSKİ YOK: bu satıra ancak `applyTransaction`
          `applied: true` döndükten sonra gelinir ve iş `delivered`
          işaretlenir; ikinci çağrı en baştaki kapıdan döner.
        */
        lastDelivery: {
          jobId: job.jobId,
          itemName: job.itemName,
          typeLabel: getServiceType(job.type).label,
          succeeded: delivery.succeeded,
          fee: job.fee,
          compensation: job.compensation,
          cashDelta: delivery.cashDelta,
          netContribution: delivery.netContribution,
          trustDelta: delivery.trustDelta,
          reputationDelta: delivery.reputationDelta,
          errorRisk: job.risk,
          lateDays: Math.max(0, s.market.day - job.promisedDay),
        },
      });

      pushToast(set, get, delivery.message, delivery.succeeded ? 'positive' : 'negative');
    },

    // -----------------------------------------------------------------------
    // Ekspertiz / danışma akışı (GDD 23.23 · İncele → Test → Rapor/Ücret → Sonuç)
    // -----------------------------------------------------------------------

    /**
     * Rapor duruşunu seçer ve ücreti o duruşun önerisine çeker.
     *
     * Ücret duruşa BAĞLI olduğu için duruş değişince öneri de değişmelidir;
     * aksi hâlde oyuncu "Temkinli"nin ücretiyle "Kesin"in itibar kazancını
     * alırdı. Oyuncu isterse öneriyi sonra elle değiştirir.
     */
    selectStance: (stance) => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.appraisal || deal.appraisal.outcome !== 'pending') return;

      const line = activeLine(deal);
      const band = line?.band;
      if (!band) return;

      set({
        activeDeal: {
          ...deal,
          appraisal: { ...deal.appraisal, stance, fee: suggestedFee(band, stance) },
        },
      });
    },

    setAppraisalFee: (fee) => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.appraisal || deal.appraisal.outcome !== 'pending') return;
      const { stance } = deal.appraisal;
      if (!stance) return;

      const line = activeLine(deal);
      const band = line?.band;
      if (!band) return;

      const bounds = feeBounds(band, stance);
      const clamped = Math.round(clamp(fee, bounds.min, bounds.max));
      set({ activeDeal: { ...deal, appraisal: { ...deal.appraisal, fee: clamped } } });
    },

    /**
     * Raporu verir ve sonucu bağlar (GDD 23.23 "Sonuç").
     *
     * GDD 22.1 — ücret tek settlement kapısından geçer. GDD 34.3 — sonuç
     * belirlenimlidir: aynı rapor ve aynı ücret her zaman aynı cevabı alır,
     * bu yüzden reddedilen bir ücreti tekrar denemek diye bir şey yoktur.
     * `outcome !== 'pending'` kapısı çift dokunuşu da baştan keser.
     */
    issueReport: () => {
      const s = get();
      const deal = s.activeDeal;
      const customer = s.activeCustomer;
      if (!deal?.appraisal || !customer) return;
      if (deal.appraisal.outcome !== 'pending') return;

      const { stance, fee } = deal.appraisal;
      if (!stance) return;

      const line = activeLine(deal);
      const item = line ? s.items[line.itemId] : undefined;
      if (!line || !item || !line.band) return;

      const verdict = resolveAppraisal({
        item,
        market: s.market,
        customer,
        band: line.band,
        stance,
        fee,
        testsUsed: line.testResults.length,
      });

      const tx = appraisalTransaction({
        dealId: deal.dealId,
        day: s.market.day,
        verdict,
        // Ekspertizde XP emeğin ve doğruluğun karşılığıdır; marj yoktur çünkü
        // alınıp satılan bir mal yoktur.
        xpDelta: xpForDeal({
          testsUsed: line.testResults.length,
          confidence: line.band.confidence,
          margin: verdict.accurate ? 0.1 : 0,
        }),
      });

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) return;

      // Ücret gerçekleşmiş katkıdır: iş bitti, rapor teslim edildi.
      const ledger = verdict.paid
        ? realizeProfit(outcome.state.ledger, verdict.fee, 0)
        : outcome.state.ledger;

      // GDD 6.6 — ürün müşteriyle gider. Stoğa hiçbir an girmez.
      set({
        ...economyToState({ ...outcome.state, ledger }),
        activeCustomer: { ...customer, trust: clamp(customer.trust + verdict.trustDelta, 0, 100) },
        activeDeal: {
          ...deal,
          stage: 'result',
          settled: true,
          appraisal: { ...deal.appraisal, verdict, outcome: 'reported' },
        },
        customerMessage: verdict.summary,
      });

      pushToast(
        set,
        get,
        verdict.paid ? `Ekspertiz ücreti ${fmt(verdict.fee)} alındı.` : 'Müşteri ücreti ödemedi.',
        verdict.paid && verdict.accurate ? 'positive' : verdict.accurate ? 'info' : 'negative',
      );
    },

    /** Oyuncu işi almaz — rapor verilmez, ücret alınmaz, itibar oynamaz. */
    declineAppraisal: () => {
      const s = get();
      const deal = s.activeDeal;
      if (!deal?.appraisal || deal.appraisal.outcome !== 'pending') return;
      set({
        activeDeal: {
          ...deal,
          stage: 'result',
          appraisal: { ...deal.appraisal, outcome: 'declined' },
        },
        customerMessage: 'Anlıyorum, başka bir yere sorayım.',
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

      /*
       * KATMAN 2 (§2) — UYUMSUZ ÜRÜN PAKETE GİREMEZ.
       *
       * Liste zaten uyumsuzu göstermiyor (katman 1), ama arayüz filtresine
       * güvenmek yetmez: eski bir kayıt, çift tıklama yarışı ya da doğrudan
       * çağrı bu fonksiyona uyumsuz bir kalem sokabilir. §2 "yalnızca
       * kullanıcı arayüzünde filtre uygulama" diyor; kapı burada da var.
       */
      const candidate = s.items[itemId];
      if (candidate && !isProductCompatible(deal.purchase.demand, candidate)) {
        pushToast(set, get, 'Müşterinin istediği ürün bu değil.', 'negative');
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

      // Adet değiştirmek de bir pakete-ekleme yoludur; aynı kapı burada da.
      const qtyItem = s.items[itemId];
      if (qtyItem && !isProductCompatible(deal.purchase.demand, qtyItem)) return;

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
      // Pazarlık payı ürün sınıfından gelir (product-classes.ts · haggleRoom):
      // sarrafiyede eşik kanal makasına sıkışır, işçilikli üründe band aynen
      // kalır. Çapa, pazarlığın döndüğü kalemin adil değeridir.
      const haggle = haggleContext(deal, line, s);

      const ctx = {
        customer,
        direction: (isPurchase ? 'shopSells' : 'shopBuys') as TradeSide,
        reputation: s.store.reputation,
        buyCeiling: effectiveCeiling(options, line.selectedThesis),
        purchaseCeiling: isPurchase ? effectivePurchaseCeiling(deal, customer, s) : undefined,
        knowledge: line.knowledge,
        fairValue: haggle.fairValue,
        haggleRoom: haggle.room,
        retailSpread: haggle.retailSpread,
      };

      /*
       * KATMAN 2 (§2) — SATIŞ TEKLİFİNİN TABANI DOMAIN'DE DE VAR.
       *
       * Arayüzdeki slider zaten bu tabanın altına inmiyor; ama §2'nin kuralı
       * "yalnız arayüzde filtre uygulama"dır. Ölçüldü: `submitOffer` doğrudan
       * çağrıldığında hiçbir kapı yoktu ve 768.000 ₺'lik bir pozisyon 3 ₺'ye
       * tertemiz settle oldu — ne uyarı, ne invariant.
       *
       * Oyuncunun ZARARINA satma hakkı durur: taban maliyetin ALTINDADIR.
       * Kapatılan, kaza ve bozuk çağrı yolu.
       */
      if (isPurchase && move.kind === 'offer' && deal.purchase && move.amount !== undefined) {
        const taban = minSaleOffer(deal.purchase.packageCost, deal.purchase.packageFairValue);
        if (move.amount < taban) {
          pushToast(set, get, `Bu fiyat çok düşük; taban ${fmt(taban)}.`, 'negative');
          return;
        }
      }

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
      const s = get();
      // GDD 10.2 — ziyaret KAPANIRKEN deftere yazılır. İşlem içinde oynayan
      // güveni kaydetmeden müşteriyi göndermek, güveni ekonomik varlık değil
      // geçici bir sayı yapardı (GDD 10).
      const customers = commitVisit(s);
      const repDelta = visitReputationDelta(s);
      set({
        customers,
        store: repDelta
          ? { ...s.store, reputation: clamp(s.store.reputation + repDelta, 0, 100) }
          : s.store,
        activeDeal: null,
        activeCustomer: null,
        customerMessage: '',
        lastReview: null,
      });
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

    /*
     * ═══════════════════════════════════════════════════════════════════
     * UPDATEv2 §8 — STOK KALEMİ EYLEMLERİ
     *
     * İkisi de `applyTransaction`'a UĞRAMAZ ve uğramamalıdır: ortada bir
     * işlem yok. Nakit, defter, borç, itibar, güven ve gerçekleşmiş kâr
     * bu iki eylemden ETKİLENMEZ.
     * ═══════════════════════════════════════════════════════════════════
     */

    /**
     * Kalemi vitrin ile arka stok arasında taşır.
     *
     * BİRLEŞTİRME ZORUNLU: yığın kimliği (`stackKey`) konumu da içerir, yani
     * hedefte aynı üründen bir yığın varsa iki pozisyon aynı anahtara sahip
     * olur. Birleştirmeden taşımak, `upsertPosition`'ın tek-yığın kuralını
     * arkadan delen ikinci bir satır bırakırdı; toplamlar toplanarak
     * birleştirilir ve birim maliyet kendiliğinden ağırlıklı ortalama kalır
     * (GDD 22.1).
     *
     * Kapasite dolu ise hiçbir şey yapılmaz — sebep zaten arayüzde yazılı.
     */
    moveStock: (itemId, to) => {
      const s = get();
      const position = s.inventory.find((p) => p.itemId === itemId);
      if (!position || position.location === to) return;
      // Atölyedeki kalem oyuncunun elinde değil; iş bitene kadar taşınmaz.
      if (position.location === 'workshop') return;

      const used = s.inventory.filter((p) => p.location === to).length;
      const cap = to === 'display' ? s.store.displaySlots : s.store.backStockSlots;
      if (used >= cap) {
        pushToast(
          set,
          get,
          to === 'display' ? 'Vitrin dolu.' : 'Arka stok dolu.',
          'negative',
        );
        return;
      }

      const item = s.items[itemId];
      const key = item ? stackKey(item, to) : null;
      const twin = key
        ? s.inventory.find((p) => {
            const other = s.items[p.itemId];
            return p.itemId !== itemId && !!other && stackKey(other, to) === key;
          })
        : undefined;

      let inventory: InventoryPosition[];
      if (twin) {
        inventory = s.inventory
          .filter((p) => p.itemId !== itemId)
          .map((p) =>
            p.itemId === twin.itemId
              ? {
                  ...p,
                  quantity: p.quantity + position.quantity,
                  costBasis: p.costBasis + position.costBasis,
                  currentValue: p.currentValue + position.currentValue,
                  // Yaşta ESKİ olan kazanır: ölü stok uyarısı taşınmayla silinmez.
                  age: Math.max(p.age, position.age),
                }
              : p,
          );
      } else {
        inventory = s.inventory.map((p) => (p.itemId === itemId ? { ...p, location: to } : p));
      }

      set({ inventory });
      pushToast(set, get, to === 'display' ? 'Vitrine taşındı.' : 'Arka stoğa taşındı.', 'info');
    },

    /**
     * Kalemin çıkış planını değiştirir (GDD 8.3 "plan etiketi").
     *
     * Plan MARK'ı belirler: `revalueInventory` seçili kanalın beklenen
     * netini bugünkü değer olarak yazar. Bu yüzden değişiklikten sonra
     * yeniden değerleme çağrılır — aksi hâlde etiket bir şey, ekrandaki
     * rakam başka şey söylerdi. Gerçekleşmiş kâr GDD 34.5 gereği yalnız
     * satışta doğar; buradan hiçbir kuruş gerçekleşmez.
     */
    setStockThesis: (itemId, channel) => {
      const s = get();
      const position = s.inventory.find((p) => p.itemId === itemId);
      if (!position || position.thesis === channel) return;

      const tagged = s.inventory.map((p) =>
        p.itemId === itemId ? { ...p, thesis: channel } : p,
      );
      set({ inventory: revalueInventory(tagged, s.items, thesisContext(get())) });
      pushToast(set, get, `Çıkış planı: ${CHANNEL_SHORT[channel]}`, 'info');
    },

    /** §8 — "uygun satış rotasına git"; yalnız sekme ve alt rota seçer. */
    openBusinessRoute: (route) => set({ tab: 'business', pendingBusinessRoute: route }),
    consumeBusinessRoute: () => set({ pendingBusinessRoute: null }),

    /**
     * Ayarı değiştirir, diske yazar ve yan sistemlere bildirir.
     *
     * ÜÇÜ AYNI YERDE: durum, kalıcılık ve etki. Ayrı ayrı çağrılsalardı,
     * birini unutmak "kapattım ama ses geliyor" ya da "kapattım, geri
     * geldi" hâlini doğururdu.
     *
     * Ekonomiye DOKUNMAZ: `applyTransaction` çağrılmaz, çağrılmamalı.
     */
    updateSettings: (patch) => {
      const next = normalizeSettings({ ...get().settings, ...patch });
      set({ settings: next });
      persistSettings(next);
      syncAudioSettings(next);
      setLocale(next.locale);
    },

    /**
     * §7 — toptancıdan mal alır. Nakit yetmezse kalanı VADEYE yazılır;
     * koşullar işlem öncesi hesaplanır ve burada aynen uygulanır.
     */
    buyFromWholesaler: (templateId, quantity) => {
      const s = get();
      const probe = spawnItem(s.seed, s.spawnCounter * 100 + 7, templateId);
      // Fiyat İSTENEN adetle hesaplanır. supplyLots() kendi "bugün sığan"
      // adedini kullandığı için ekranda gösterilen tutarla tahsil edilen
      // tutar ayrışıyordu — hacim makasa girdiği için birim fiyat adede
      // bağlıdır ve iki farklı adet iki farklı fiyat verir.
      const lot = supplyOffer(probe, Math.max(1, Math.round(quantity)), s.market, s.store);
      if (!lot) return;

      const units = lot.quantity;
      const amount = lot.total;
      const terms = financeTerms(s.store, amount, s.market.day);

      if (terms.blockedReason) {
        pushToast(set, get, terms.blockedReason, 'negative');
        return;
      }

      /*
       * SIRA NUMARASI — aynı ürünü iki kez almanın kilitlenmesini önler.
       *
       * Fatura kimliği eskiden `inv_<gün>_<ürün>_<açık fatura sayısı>` idi.
       * Peşin ödemede fatura AÇILMADIĞI için o sayaç kıpırdamıyordu: aynı
       * gün aynı üründen ikinci kez alındığında kimlik birebir aynı çıkıyor
       * ve settlement'in idempotency kapısı işlemi HAKLI OLARAK reddediyordu
       * (oyuncuya "Transaction wbuy_inv_2_gram_gold_1_0 zaten uygulanmış"
       * diye düşüyordu). Kapı doğru çalışıyordu; kusurlu olan kimlikti.
       *
       * Defterdeki uygulanmış işlem sayısı her işlemde artar, kaydedilir ve
       * geri yüklenir — bu yüzden hem tekildir hem determinizmi bozmaz
       * (GDD 28.3 rastgelelik akışıyla ilgilidir, kimliklerle değil).
       */
      const seq = s.ledger.appliedTxIds.length;
      const invoiceId = `inv_${s.market.day}_${templateId}_${seq}`;

      // Her adet ayrı bir kalem olarak girer ve yığın kuralı onları
      // birleştirir (GDD 22.1). Böylece "40 adet" tek pozisyon olur ama
      // maliyet tabanı gerçek birim maliyettir.
      //
      // Kalem kimliği de sıraya bağlıdır: `probe.id` (seed, spawnCounter,
      // ürün) ile sabit olduğu için eski hâlde ikinci alım BİRİNCİNİN
      // kalemlerini ezerdi — applyTransaction gelen kalemi kimliğiyle
      // yazar, aynı kimlik iki kez gelirse ikincisi birincinin üstüne biner.
      const itemsIn: ItemInstance[] = Array.from({ length: units }, (_, i) => ({
        ...spawnItem(s.seed, s.spawnCounter * 100 + 7, templateId),
        id: `${probe.id}_${seq}_${i}`,
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
        // `outcome.reason` işlem kimliğini taşıyan GELİŞTİRİCİ metnidir;
        // oyuncuya gösterilmez (v1.1 §7 — iç isimler ekrana çıkmaz).
        pushToast(set, get, 'Tedarik uygulanamadı.', 'negative');
        return;
      }

      const withInvoice =
        terms.totalDue > 0
          ? openInvoice(outcome.state.store.supplier, {
              id: invoiceId,
              amount: terms.totalDue,
              dueDay: terms.dueDay,
            })
          : outcome.state.store.supplier;

      /*
        §7 — DÜZENLİ TİCARET DE İLİŞKİ KURAR.

        Ölçüldü: güven yalnız vadeli borcun ödenmesiyle büyüdüğü ve
        `financeTerms` nakdi önce harcadığı için, parası olan oyuncunun
        toptancı güveni başlangıç değerinde SONSUZA DEK donuyordu — 120
        günde 7 kademe kapısından 6'sı açılıp yalnız bu kapalı kaldı.
        Katkı küçük ve tavanlıdır; kredi ilişkisinin yerine geçmez.
      */
      const supplier = tradeTrustAfterPurchase(withInvoice, amount, creditLimit(s.store));

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

    // -----------------------------------------------------------------------
    // Esnaf ağı — §8
    // -----------------------------------------------------------------------

    /** §8 "Altın bozdurma: oyuncu uygun esnafta sarrafiyeyi nakde çevirebilir." */
    liquidateToNetwork: (memberId, itemId, quantity) => {
      const s = get();
      const member = s.network.find((m) => m.id === memberId);
      if (!member) return;

      const offer = networkLiquidationOffer(
        member,
        itemId,
        quantity,
        s.items,
        s.inventory,
        s.market,
      );
      if (!offer || offer.quantity <= 0) {
        pushToast(set, get, offer?.shortfallReason ?? 'Bu esnaf bu işi alamıyor.', 'negative');
        return;
      }

      const item = s.items[itemId];
      if (!item) return;

      const tx: SettlementTransaction = {
        txId: `nsale_${s.market.day}_${memberId}_${itemId}_${s.ledger.transactions.length}`,
        dealId: `nsale_${s.market.day}_${memberId}_${itemId}`,
        day: s.market.day,
        cashDelta: offer.total,
        itemsIn: [],
        itemsOut: [{ itemId, quantity: offer.quantity }],
        trustDelta: 0,
        reputationDelta: 0,
        xpDelta: 0,
        label: `${offer.quantity} adet ${item.displayName} · ${member.displayName}`,
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) return;

      const ledger = recordDeal(
        realizeProfit(outcome.state.ledger, offer.total, offer.costBasis),
        {
          dealId: `${tx.dealId}_${s.ledger.deals.length}`,
          customerId: memberId,
          lineIds: [],
          itemIds: [itemId],
          side: 'sell',
          day: s.market.day,
          clockMinutes: s.market.clockMinutes,
          testsUsed: [],
          estimateBand: { min: offer.total, max: offer.total },
          confidence: 'high',
          actualValue: offer.total,
          offerHistory: [],
          finalState: 'ACCEPTED',
          movesUsed: [],
          thesisAtDeal: null,
          price: offer.total,
          costBasis: offer.costBasis,
          realizedProfit: offer.total - offer.costBasis,
          units: offer.quantity,
          grams: offer.grams,
          channel: 'tradeNetwork',
          isBulk: false,
          trustDelta: 0,
          reputationDelta: 0,
          reviewData: {
            missedSignals: [],
            keyDecisionPoint: `${member.displayName} ile bozuldu.`,
            alternativeChannelNote: offer.shortfallReason ?? 'Ağ kapasitesi yetti.',
          },
        },
      );

      const revalued = revalueInventory(
        outcome.state.inventory,
        outcome.state.items,
        thesisContext(get()),
      );

      set({
        ...economyToState({ ...outcome.state, inventory: revalued, ledger }),
        // §8 "Ağ kapasitesi sonludur" — kullanılan kapasite gerçekten azalır.
        network: s.network.map((m) =>
          m.id === memberId ? applyLiquidation(m, offer.total) : m,
        ),
      });

      const profit = offer.total - offer.costBasis;
      pushToast(
        set,
        get,
        `${offer.quantity} adet bozuldu · ${fmt(offer.total)} · ${fmt(profit)} kâr`,
        profit >= 0 ? 'positive' : 'negative',
      );
    },

    /** §8 "Kısa vadeli ticari borç: güven, geçmiş davranış, açık borç ve vade sınırıyla." */
    borrowFromNetwork: (memberId, amount) => {
      const s = get();
      const member = s.network.find((m) => m.id === memberId);
      if (!member) return;

      const offer = networkLoanOffer(member, s.network, amount, s.market.day);
      if (offer.blockedReason) {
        pushToast(set, get, offer.blockedReason, 'negative');
        return;
      }

      // Sıra numarası: aynı gün borç alıp kapatıp yeniden almak kimlik
      // çakıştırıyordu (bkz. buyFromWholesaler'daki aynı sınıf hata).
      const loanId = `nloan_${memberId}_${s.market.day}_${s.ledger.appliedTxIds.length}`;

      const tx: SettlementTransaction = {
        txId: loanId,
        dealId: loanId,
        day: s.market.day,
        cashDelta: offer.amount,
        itemsIn: [],
        itemsOut: [],
        trustDelta: 0,
        reputationDelta: 0,
        xpDelta: 0,
        label: `${member.displayName} · kısa vadeli borç`,
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) return;

      set({
        ...economyToState(outcome.state),
        network: s.network.map((m) =>
          m.id === memberId ? openLoan(m, offer, s.market.day, loanId) : m,
        ),
      });

      pushToast(
        set,
        get,
        `${fmt(offer.amount)} alındı · ${fmt(offer.totalDue)} ${offer.dueDay}. güne`,
        'info',
      );
    },

    repayNetworkLoan: (memberId) => {
      const s = get();
      const member = s.network.find((m) => m.id === memberId);
      if (!member?.loan) return;
      if (member.loan.totalDue > s.store.cash) {
        pushToast(set, get, 'Borcu kapatacak nakit yok.', 'negative');
        return;
      }

      const tx: SettlementTransaction = {
        txId: `nrepay_${member.loan.id}`,
        dealId: `nrepay_${member.loan.id}`,
        day: s.market.day,
        cashDelta: -member.loan.totalDue,
        itemsIn: [],
        itemsOut: [],
        trustDelta: 0,
        reputationDelta: 0,
        xpDelta: 0,
        label: `${member.displayName} · borç ödemesi`,
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) return;

      const { member: next, onTime } = repayLoan(member, s.market.day);
      set({
        ...economyToState(outcome.state),
        network: s.network.map((m) => (m.id === memberId ? next : m)),
      });

      pushToast(
        set,
        get,
        onTime
          ? `${member.displayName} kapandı · ilişki ${next.trust}/100`
          : `${member.displayName} GECİKMELİ kapandı · ilişki ${next.trust}/100`,
        onTime ? 'positive' : 'negative',
      );
    },

    advanceDay: () => {
      const s = get();

      /*
        Onay penceresi açıksa duraklatmayı BURADA bırak. Sayacı yalnız
        pencerenin kendi kapanışına bırakmak, "onayla" yolunun sayacı asılı
        bırakmasına yol açıyordu — oyun kapanış panelinin arkasında donuk
        kalırdı.
      */
      if (s.dayCloseAsk) s.popPause();

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

      // §8 aynı kural ağda da işler; ayrıca esnafın kasası kısmen tazelenir
      // ki ağ kalıcı olarak kurumasın.
      const networkOverdue = accrueNetworkOverdue(s.network, nextDay);
      const network = replenishNetwork(networkOverdue.members);

      // §5 — kapanış pozisyonu ÖNCE ölçülür (gün kapanışı fiyatıyla), sonra
      // ertesi günün fiyatıyla sonucu çözülür. Sıra önemli: pozisyonu yeni
      // fiyatla ölçmek, geceyi hiç yaşamamış gibi göstermek olurdu.
      const position = measurePosition(
        s.market.day,
        closed.store.cash,
        inventory,
        closed.items,
        s.market,
      );
      const overnightOutcome = resolveOvernight(position, market);

      set({
        ...economyToState({ ...closed, store, inventory }),
        ledger: { ...closed.ledger, realizedProfitToday: 0 },
        jobs,
        market,
        // §3: her günün kendi karakteri var; havuz gün başında yeniden çekilir.
        dayCharacter: dayCharacter(s.seed, market.day, market),
        network,
        overnight: position,
        lastOvernight: overnightOutcome,
        queue: [],
        activeCustomer: null,
        activeDeal: null,
        nextCustomerAtMinutes: DAY.openMinutes + 3,
        customerRushUntilMinutes: null,
        // "Bugün" penceresi kapanır, toplam korunur; gün raporu aşağıda
        // kapanmadan ÖNCEKİ defteri (`s.missedDemand`) okur.
        missedDemand: rolloverDemandLog(s.missedDemand),
      });

      /*
        §B4 — KAPANIŞ ARTIK TOAST DEĞİL, PANEL.

        Burada eskiden DÖRDE KADAR toast gönderiliyordu ama ekranda en fazla
        ikisi durur (`pushToast` son üçü tutar, arayüz ikisini çizer). Yani
        gecikmiş bir vade ya da esnaf borcu — oyuncunun en çok bilmesi
        gereken iki şey — sessizce düşebiliyordu. Hepsi tek panelde toplandı
        ve panel oyuncu kapatana kadar duruyor.

        Tek toast kalıyor: paneli kaçırmayan kısa bir bildirim.
      */
      const warnings: string[] = [];
      if (networkOverdue.penalty > 0) {
        warnings.push(
          `${networkOverdue.lateMembers.length} esnaf borcu gecikti · ${fmt(networkOverdue.penalty)} yük`,
        );
      }
      if (overdue.penalty > 0) {
        warnings.push(
          `${overdue.overdueIds.length} vade gecikti · ${fmt(overdue.penalty)} gecikme yükü`,
        );
      }

      set({
        dayCloseAsk: false,
        lastDayClose: {
          day: report.day,
          realizedProfit: report.realizedTradeProfit,
          overhead: report.overhead,
          netCashChange: report.netCashChange,
          cashAfter: store.cash,
          stockPotential: report.stockPotential,
          liquidity: report.liquidity,
          // §5 · GDD 34.5 — bu sayı gerçekleşmiş kâra YAZILMAZ; mal hâlâ
          // stokta, fırsat maliyeti ise hiç var olmamış bir para.
          overnight:
            Math.abs(overnightOutcome.spotChange) >= 0.0005 ? overnightOutcome.summary : null,
          warnings,
          upcoming: report.upcomingLiabilities,
          missedDemand: topMissedDemand(s.missedDemand, 3).filter((r) => r.today > 0),
          missedDemandTotal: missedToday(s.missedDemand),
        },
      });

      pushToast(
        set,
        get,
        `Gün ${report.day} kapandı`,
        report.netCashChange >= 0 ? 'positive' : 'negative',
      );

      // GDD 28.1 — gün sonu checkpoint. Kaydın §11'e göre taşıdığı şeyler:
      // rejim (seed'den yeniden türetilir), açık borçlar, vadeler, limitler
      // ve pozisyonlar.
      writeSave(get());

      const ready = jobs.filter((j) => j.result === 'success' || j.result === 'failed').length;
      if (ready > 0) {
        pushToast(set, get, `${ready} servis işi teslime hazır — Atölye'ye bak.`, 'info');
      }
    },

    // -----------------------------------------------------------------------
    // Mağaza büyümesi (GDD 19)
    // -----------------------------------------------------------------------
    upgradeStore: () => {
      const s = get();
      const evaluation = evaluateUpgrade(
        s.store,
        growthSnapshot(economyOf(s), Object.keys(s.customers).length),
      );

      if (!evaluation.next || !evaluation.ready) {
        pushToast(set, get, evaluation.blockedReason ?? 'Mağaza yükseltmeye hazır değil.', 'negative');
        return;
      }

      const next = evaluation.next;

      // GDD 22.1 — kasa hareketi TEK yoldan geçer. Yükseltme de bir işlemdir;
      // doğrudan cash'e yazmak settlement garantisini delerdi.
      const tx: SettlementTransaction = {
        txId: `upgrade_tier_${next.tier}`,
        dealId: `upgrade_tier_${next.tier}`,
        day: s.market.day,
        cashDelta: -next.investment,
        itemsIn: [],
        itemsOut: [],
        trustDelta: 0,
        reputationDelta: 0,
        xpDelta: 0,
        label: `${next.name} yatırımı`,
      };

      const outcome = applyTransaction(economyOf(s), tx);
      if (!outcome.applied) {
        // Teknik gerekçe oyuncuya gösterilmez; bkz. buyFromWholesaler.
        pushToast(set, get, 'Yükseltme uygulanamadı.', 'negative');
        return;
      }

      set(economyToState({ ...outcome.state, store: applyTierGrants(outcome.state.store, next) }));

      pushToast(
        set,
        get,
        `${next.name} açıldı · günlük gider ${fmt(next.grants.dailyOverhead)}`,
        'positive',
      );
    },

    // -----------------------------------------------------------------------
    // Kayıt (GDD 28.1 · Addendum §11)
    // -----------------------------------------------------------------------
    saveGame: () => writeSave(get()),

    loadGame: () => {
      const loaded = readSave();
      if (!loaded) return false;
      set(loaded);
      pushToast(set, get, `Kayıt yüklendi · Gün ${loaded.market.day}`, 'info');
      return true;
    },

    resetGame: () => {
      clearSave();
      pushToast(set, get, 'Kayıt silindi. Yeni oyun bir sonraki açılışta başlar.', 'info');
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
      reputationDelta: dealReputationDelta(customer.trust),
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

/**
 * Dükkânda o an satılabilir durumda bulunan şablon kimlikleri — benzersiz.
 * Yalnız vitrin ve arka stok sayılır; satılmış kalem stokta değildir.
 */
function stockedTemplateIds(s: GameState): string[] {
  const ids = new Set<string>();
  for (const p of s.inventory) {
    if (p.location !== 'display' && p.location !== 'backStock') continue;
    const item = s.items[p.itemId];
    if (item) ids.add(item.templateId);
  }
  return [...ids];
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

    /*
     * KATMAN 5 (§2) — SON KAPI: UYUMSUZ SATIŞ TRANSACTION'I REDDEDİLİR.
     *
     * §2: "Uyumsuz ürün kod veya eski kayıt nedeniyle işlem fonksiyonuna
     * ulaşırsa transaction reddedilmeli; para, stok, XP ve müşteri ilişkisi
     * DEĞİŞMEMELİ."
     *
     * Bu yüzden kontrol `applyTransaction`tan ÖNCE: tek yazma noktasına hiç
     * girilmez, dolayısıyla yarım uygulanmış bir işlem de oluşamaz.
     */
    const incompatible = soldItems.filter((it) => !isProductCompatible(purchase.demand, it));
    if (incompatible.length > 0) {
      pushToast(
        set,
        get,
        'Pakette müşterinin istemediği bir ürün var; satış tamamlanmadı.',
        'negative',
      );
      return;
    }

    const tx: SettlementTransaction = {
      // Paket bazlı benzersiz kimlik → çift tap ve reload koruması (GDD 22.1).
      txId: `sale_${deal.dealId}`,
      dealId: deal.dealId,
      day: s.market.day,
      cashDelta: price,
      itemsIn: [],
      itemsOut: purchase.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
      trustDelta: 0,
      reputationDelta: dealReputationDelta(customer.trust),
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
      alternativeChannelNote: `${CHANNEL_LABEL_TR[purchase.channel]} alış-satış farkıyla fiyatlandı.`,
    },
  };

  economy = { ...economy, ledger: recordDeal(economy.ledger, record) };

  const revalued = revalueInventory(economy.inventory, economy.items, thesisContext(get()));
  set({
    ...economyToState({ ...economy, inventory: revalued }),
    activeDeal: { ...deal, settled: true },
  });
}

/**
 * GDD 10.2 — ziyaretin deftere yazılması.
 *
 * Ne yazılır: sonuç (kabul/red/çıkıp gitme/servis), güven değişimi, kısa not
 * ve ciro. Ne yazılmaz: gizli gerçek. Defter oyuncunun da göreceği bir
 * hafızadır; müşterinin bilmediği şeyi taşımaz (GDD 6.6).
 */
function commitVisit(s: GameState): CustomerRegistry {
  const deal = s.activeDeal;
  const customer = s.activeCustomer;
  if (!deal || !customer) return s.customers;

  const record = s.customers[customer.id];
  if (!record) return s.customers;

  const outcome = visitOutcome(deal, customer);
  const volume = dealVolume(deal);

  const visit: VisitRecord = {
    day: s.market.day,
    dealId: deal.dealId,
    outcome,
    // Ziyaretin net güven etkisi: işlem içinde oynayan güvenin defterdeki
    // değere göre farkı.
    trustDelta: customer.trust - record.trust,
    note: visitNote(outcome, volume),
  };

  return { ...s.customers, [customer.id]: recordVisit(record, visit, volume) };
}

/**
 * GDD 10.1 — kişisel güvenin semt itibarına yansıması.
 * "Tek işlem itibarı uçurmaz" (10.4): transfer küçüktür ve yalnız kapanan
 * ziyaretten doğar.
 */
function visitReputationDelta(s: GameState): number {
  const customer = s.activeCustomer;
  const record = customer ? s.customers[customer.id] : undefined;
  if (!customer || !record || !s.activeDeal) return 0;
  // Kural domain'de yaşıyor: hangi reddin konuşulduğunu orası bilir.
  return visitReputation(customer.trust - record.trust, visitOutcome(s.activeDeal, customer));
}

function visitOutcome(deal: ActiveDeal, customer: Customer): VisitRecord['outcome'] {
  if (deal.flow === 'service') {
    return deal.service?.outcome === 'accepted' ? 'serviceBooked' : 'rejected';
  }
  // Ekspertizde "kapandı" demek para değil, RAPOR demektir: ücret
  // reddedilse bile iş yapılmıştır ve ziyaret boşa geçmemiştir.
  if (deal.flow === 'appraisal') {
    return deal.appraisal?.outcome === 'reported' ? 'accepted' : 'rejected';
  }
  // Sabrı bitip çıkan müşteri, fiyatı beğenmeyip redden ayrı tutulur:
  // GDD 10.4 ciddi olayları daha ağır sayar.
  if (customer.patience <= 0) return 'walkedOut';
  return deal.lines.some((l) => l.negotiation.state === 'ACCEPTED') ? 'accepted' : 'rejected';
}

function dealVolume(deal: ActiveDeal): Money {
  return deal.lines.reduce((sum, l) => sum + (l.negotiation.settledPrice ?? 0), 0);
}

function visitNote(outcome: VisitRecord['outcome'], volume: Money): string {
  switch (outcome) {
    case 'accepted':
      return `İşlem kapandı · ${fmt(volume)}`;
    case 'serviceBooked':
      return 'Servis işi bırakıldı';
    case 'walkedOut':
      return 'Sabrı bitti, çıkıp gitti';
    default:
      return 'Anlaşma olmadı';
  }
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
/**
 * Pazarlığın çapası ve ürün sınıfının pazarlık payı.
 *
 * Ticaret ve ekspertizde kalem tektir. Alış akışında pazarlık bir PAKET
 * üzerinden döner: çapa paketin toplam adil değeri, pay ise paketteki en
 * DAR paydır — içinde çeyrek olan bir pakette çeyreğin fiyatı pazarlıkla
 * uçurulamaz. Pakette hiç kalem yoksa sıkıştırma uygulanmaz.
 */
function haggleContext(
  deal: ActiveDeal,
  line: DealLine,
  s: GameState,
): { fairValue: Money | undefined; room: number; retailSpread: number } {
  const pkg = deal.purchase?.lines ?? [];

  if (deal.flow === 'purchase' && pkg.length > 0) {
    let fair = 0;
    let room = 1;
    // Karışık pakette EN DAR makas geçerlidir: paketi bir kalem sarrafiye
    // varsa oyuncu takı marjıyla fiyatlayamaz.
    let retailSpread = Number.POSITIVE_INFINITY;
    for (const pl of pkg) {
      const item = s.items[pl.itemId];
      if (!item) continue;
      const rules = rulesFor(getTemplate(item.templateId));
      fair += trueValue(item, s.market) * pl.quantity;
      room = Math.min(room, rules.haggleRoom);
      retailSpread = Math.min(retailSpread, rules.retailSpread);
    }
    return fair > 0
      ? { fairValue: fair, room, retailSpread: Number.isFinite(retailSpread) ? retailSpread : 0 }
      : { fairValue: undefined, room: 1, retailSpread: 0 };
  }

  const item = s.items[line.itemId];
  if (!item) return { fairValue: undefined, room: 1, retailSpread: 0 };
  const rules = rulesFor(getTemplate(item.templateId));
  return {
    fairValue: trueValue(item, s.market),
    room: rules.haggleRoom,
    retailSpread: rules.retailSpread,
  };
}

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

  // --- Ekspertiz akışı (GDD 23.23 beşinci akış) ---
  // İncele ve Test her zaman açık — GDD 7'nin "bilgi satın alma" kararı
  // oyuncunundur, sistem onu teste zorlamaz ama teste ENGEL de olmaz.
  // Rapor bir değerleme bandı ister: ölçmediğin şey için rapor yazılmaz.
  if (deal.flow === 'appraisal') {
    const appraisal = deal.appraisal;
    if (!appraisal) return false;

    switch (stage) {
      case 'inspect':
      case 'test':
        return true;
      case 'report':
        return line.band !== null;
      case 'result':
        return appraisal.outcome !== 'pending';
      default:
        // Ticaret ve servis aşamaları ekspertiz akışında kilitlidir.
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
      case 'negotiate': {
        /*
         * KATMAN 4 (§2) — UYUMSUZ PAKETLE PAZARLIĞA GEÇİLMEZ.
         *
         * §4.1'in kısmi karşılama kuralına ek olarak paketin İÇERİĞİ de
         * denetlenir. Boş paket zaten `fulfilment === 'none'` verir; bu
         * kapı, dolu ama uyumsuz bir paketi durdurur.
         */
        if (purchase.lines.length === 0) return false;
        const allCompatible = purchase.lines.every((l) => {
          const item = s.items[l.itemId];
          return !!item && isProductCompatible(purchase.demand, item);
        });
        if (!allCompatible) return false;
        // §4.1: kısmi karşılamayı kabul etmeyen müşteriye eksik paket sunulmaz.
        return purchase.fulfilment !== 'none';
      }
      case 'result':
        return isTerminal(line.negotiation.state);
      default:
        return false;
    }
  }

  if (stage === 'result') return isTerminal(line.negotiation.state);

  // İşlem Akışı Ara Düzeltmesi §2/§4 — akış yoğunluğu ÜRÜNE göre değişir.
  // Standart sarrafiyede zorunlu test zinciri yoktur; oyuncu 1-2 adımda
  // fiyata geçebilir. §8 gereği aşama SİLİNMEZ, yalnız zorunluluğu kalkar:
  // hızlı işlemde de İncele ve Değerle açıktır, sadece bekletmez.
  const item = s.items[line.itemId];
  if (!item) return stage === 'inspect' || stage === 'appraise';

  return stageUnlocked(item, stage, {
    hasBand: line.band !== null,
    hasTests: line.testResults.length > 0,
    hasExitPlan: line.selectedThesis !== null,
  });
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

/**
 * §3 — öğretim metinlerinin ayırt ettiği ürün grubu.
 *
 * Gram bazlı külçe ile ziynet ayrılıyor çünkü ders cümlesi değişiyor:
 * külçenin gramajı ÜRETİMİNDE sabittir, ziynetinki STANDARTTIR. İkisini
 * tek metne sıkıştırmak, ikisini de yarım anlatmak olurdu.
 */
function productKindOf(templateId: string): ProductKind {
  if (!isBullion(templateId)) return 'crafted';
  /*
    UPDATEv3 §1 — yatırım bileziği GRAM tarafında.

    'coinBullion' deseydik ders "Ziynet altının gramajı ve ayarı
    standarttır" derdi; bilezik ziynet değil, gramla anılan bir yatırım
    ürünü. 'gramBullion' dersi de "24 ayar" diyor ve bilezik 22 ayar —
    bu yüzden o dersin metni de düzeltildi (bkz. onboarding.ts fastFlow).
  */
  return templateId.startsWith('gram_gold') ||
    templateId === 'small_ingot' ||
    templateId.startsWith('bracelet_22k_plain')
    ? 'gramBullion'
    : 'coinBullion';
}

function openingLine(customer: Customer): string {
  switch (customer.intent) {
    case 'sell':
      return customer.lineIds.length > 1
        ? 'Birkaç parça getirdim, bakar mısınız?'
        : 'Bunu bozdurmak istiyorum.';
    case 'buy':
      /*
        Talep spawn anında sabittir; müşteri ne aradığını ilk cümlede söyler
        ki oyuncu stok seçimine bilgiyle girsin (GDD 23.23).

        §2 — cümle KATALOG ADI değil, KONUŞMA DİLİ. Eskiden
        "Gram Altın (5 g) için geldim." yazıyordu; müşteri öyle konuşmaz.
      */
      return customer.demand
        ? customerRequestLine(customer.demand)
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

/**
 * Oyuncuya görünen her sonucun tek kapısı — ve bu yüzden SES İLE TİTREŞİMİN
 * de doğru yeri.
 *
 * NEDEN BURADA, ÇAĞRI YERLERİNDE DEĞİL: geri bildirimi tek tek eylemlere
 * serpiştirmek, yeni bir eylem eklendiğinde sessiz kalmasını neredeyse
 * garanti ederdi. Toast zaten "oyuncuya bir şey oldu" demenin tek yolu;
 * duyulan ve hissedilen şey de aynı olaydır.
 *
 * BİLGİ TONU TİTREŞMEZ: bilgi toast'ları sık çıkar (akın başladı, plan
 * değişti). Her birinde telefonu titretmek geri bildirim değil, rahatsızlık
 * olurdu. Titreşim yalnız oyuncunun BEKLEDİĞİ bir sonuç geldiğinde.
 */
function pushToast(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
  text: string,
  tone: ToastMessage['tone'],
): void {
  const id = `toast_${get().ledger.transactions.length}_${text.length}_${Date.now()}`;
  set({ toasts: [...get().toasts, { id, text, tone }].slice(-3) });

  const settings = get().settings;
  if (tone === 'positive') {
    playSfx('offerAccepted');
    vibrate('success', settings.haptics);
  } else if (tone === 'negative') {
    playSfx('offerRejected');
    vibrate('warn', settings.haptics);
  } else {
    playSfx('tap');
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmt(n: Money): string {
  return `${Math.round(n).toLocaleString('tr-TR')} ₺`;
}

// UI'nin ihtiyaç duyduğu türetilmiş seçiciler.
export const selectors = {
  /** İşlem Akışı §2 — aktif kalemin işlem sınıfı ve akış politikası. */
  flow: (s: GameState) => {
    const line = s.activeDeal ? activeLine(s.activeDeal) : undefined;
    const item = line ? s.items[line.itemId] : undefined;
    return item ? flowPolicy(item) : null;
  },

  /**
   * GDD 25 — öğretim dersinin karar bağlamı.
   *
   * Ders koşulları saf fonksiyonlardır ve YALNIZ bu bağlamı görür; store'un
   * tamamını görselerdi test edilemez, sırası da denetlenemez olurdu.
   */
  coachContext: (s: GameState): CoachContext => {
    const deal = s.activeDeal;
    const line = deal ? activeLine(deal) : undefined;
    const item = line ? s.items[line.itemId] : undefined;

    return {
      day: s.market.day,
      hasCustomer: s.activeCustomer !== null,
      queueLength: s.queue.length,
      flow: deal?.flow ?? null,
      stage: deal?.stage ?? null,
      transactionClass: item ? transactionClass(item) : null,
      testsRun: line?.testResults.length ?? 0,
      hasBand: line?.band !== null && line?.band !== undefined,
      stockUnits: s.inventory.reduce((n, p) => n + p.quantity, 0),
      /*
        §3 — ders metni aktif ürüne göre konuşabilsin diye.
        Gram bazlı sarrafiye ile ziynet ayrılıyor: ilkinde "gramaj
        üretiminde sabittir", ikincisinde "gramajı standarttır" denir.
        Alış akışında henüz kalem seçilmemiş olabilir; o zaman null.
      */
      productKind: item ? productKindOf(item.templateId) : null,
    };
  },

  /** GDD 25 — şu an gösterilecek ders; yoksa null. */
  lesson: (s: GameState) => nextLesson(selectors.coachContext(s), s.seenLessons),

  /** §5 — bugünkü pozisyon (gün içinde canlı; kapanışta sabitlenir). */
  position: (s: GameState) =>
    measurePosition(s.market.day, s.store.cash, s.inventory, s.items, s.market),

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
