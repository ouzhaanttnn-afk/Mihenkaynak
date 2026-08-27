/**
 * MIHENKAYNAK — Denge parametreleri
 * Kaynak: GDD 14.1 "Başlangıç denge hedefleri – PLAYTEST", 35.1 "Denge prensipleri".
 *
 * GDD 35.1: "Tüm sayısal eşikler tuning parametresidir; tasarım değişmezleri
 * değildir." Bu dosya tek tuning yüzeyidir — sayılar sistem kodunun içine
 * gömülmez. PLAYTEST ile değişecek her değer burada işaretlidir.
 */

import type { Karat, MarketRegime, ConditionGrade } from './types';

/** GDD 6.1 — Saflık / ayar modeli. Tasarım sabiti, tuning parametresi değildir. */
export const PURITY_TABLE: Record<Karat, number> = {
  '8K': 0.333,
  '14K': 0.585,
  '18K': 0.75,
  '22K': 0.916,
  '24K': 0.995,
  AG925: 0.925,
  AG800: 0.8,
};

export const KARAT_LABEL: Record<Karat, string> = {
  '8K': '8 Ayar',
  '14K': '14 Ayar',
  '18K': '18 Ayar',
  '22K': '22 Ayar',
  '24K': '24 Ayar',
  AG925: '925 Gümüş',
  AG800: '800 Gümüş',
};

/** Altın ayarları, saflık sırasına göre — mihenk testinin bant daraltması için. */
export const GOLD_KARATS: Karat[] = ['8K', '14K', '18K', '22K', '24K'];

/** GDD 14.1 — PLAYTEST başlangıç değerleri. */
export const START = {
  cash: 75_000,
  safeLimit: 250_000,
  displaySlots: 8,
  backStockSlots: 16,
  dailyOverhead: 1_200,
  workshopCapacity: 2,
  reputation: 42,
  supplierTrust: 50,
  supplierLimit: 40_000,
  supplierTerms: 3,
} as const;

/** GDD 14.1 — hedef marj bantları. PLAYTEST. */
export const TARGET_MARGIN = {
  bullion: [0.015, 0.04] as [number, number],
  secondHandJewellery: [0.08, 0.2] as [number, number],
  service: [0.35, 0.6] as [number, number],
} as const;

/** GDD 14.2 — likidite bantları. */
export const LIQUIDITY_BANDS = {
  red: 0.15,
  caution: 0.3,
  healthy: 0.55,
} as const;

/**
 * GDD 8.1 — çıkış kanalı ekonomisi.
 * GDD 35.1: "Hızlı toptan çıkış normal perakende stratejisini ekonomik olarak
 * geçmemelidir." Aşağıdaki katsayılar bu sıralamayı korur:
 * melt < wholesale < retail ≤ serviceResale (süre/kapasite maliyeti karşılığı).
 */
export const EXIT_CHANNEL = {
  wholesale: {
    /** Toptancı, adil değerin bu oranını öder. */
    payoutRatio: 0.9,
    /** İşçilik değerinin ne kadarı korunur. */
    craftsmanshipRecovery: 0.3,
    stoneRecovery: 0.4,
    daysToCash: [0, 1] as [number, number],
    fee: 0,
  },
  retail: {
    /** Vitrin satışında adil değer üzerine perakende marjı. */
    markup: 1.18,
    /** Bekleme sırasında gerçekleşen indirim/pazarlık payı. */
    realizationRatio: 0.94,
    craftsmanshipRecovery: 1.0,
    stoneRecovery: 1.0,
    daysToCash: [3, 7] as [number, number],
    /** Vitrin slotu başına günlük fırsat maliyeti. */
    holdingCostPerDay: 35,
  },
  melt: {
    /** GDD 8.1 — eritmede metal odaklı geri kazanım; işçilik/taş kaybı. */
    metalRecovery: 0.94,
    craftsmanshipRecovery: 0,
    stoneRecovery: 0,
    refiningFee: 180,
    daysToCash: [1, 2] as [number, number],
  },
  serviceResale: {
    /** Servis sonrası kondisyonun düzelmesiyle kazanılan değer oranı. */
    conditionRecovery: 0.75,
    markup: 1.18,
    realizationRatio: 0.94,
    daysToCash: [4, 9] as [number, number],
    /** Servis maliyetinin, düzeltilen değere oranı. */
    serviceCostRatio: 0.32,
    /** Hata riskinin beklenen maliyeti (kapasite doluluğuna göre artar). */
    baseErrorRisk: 0.08,
  },
  collection: {
    /** Nadirlik primi zamanla realize olur. */
    appreciationPerDay: 0.004,
    holdDays: [10, 25] as [number, number],
    realizationRatio: 0.96,
    /** Bu kanal yalnız bu nadirlik eşiğinin üstünde rasyoneldir. */
    minRarity: 0.55,
  },
} as const;

/** GDD 6.4 — Alış Tavanı bileşenleri. PLAYTEST. */
export const BUY_CEILING = {
  /** Hedef marj — kanal riskine göre ölçeklenir. */
  targetMarginByRisk: { low: 0.05, medium: 0.11, high: 0.19 },
  /**
   * Risk rezervi — değer bandının genişliğinden türer.
   * Geniş band = düşük güven = daha yüksek rezerv (GDD 6.3).
   */
  riskReservePerBandWidth: 0.55,
  /** Operasyon/zaman maliyeti — nakde dönüş günü başına. */
  opCostPerDay: 0.006,
} as const;

/** GDD 6.5 — Satış Tabanı. */
export const SELL_FLOOR = {
  minMargin: 0.06,
  waitRiskPerDay: 0.004,
} as const;

/** GDD 13.2 — Piyasa rejim modeli. Günlük ve olay hareket bantları. */
export const MARKET_REGIME: Record<
  MarketRegime,
  {
    dailyMove: [number, number];
    eventMove: [number, number];
    label: string;
    note: string;
    /**
     * Ekonomi Ara Düzeltmesi §6 — "Belirsizlik ve hızlı fiyat değişimi makası
     * genişletebilir; sakin koşullar daraltabilir."
     */
    spreadShift: number;
    /**
     * §11 "Aşırı volatilite: makas genişleyebilir, fiyat geçerlilik süresi
     * kısalabilir." Kanallar volatil piyasada daha az hacim taşır.
     */
    capacityFactor: number;
  }
> = {
  calm: {
    dailyMove: [0.004, 0.009],
    eventMove: [0, 0],
    label: 'Sakin',
    note: 'Dar bant, düşük stok riski.',
    spreadShift: -0.002,
    capacityFactor: 1.15,
  },
  normal: {
    dailyMove: [0.008, 0.018],
    eventMove: [0.02, 0.03],
    label: 'Normal',
    note: 'Nötr veya hafif trend.',
    spreadShift: 0,
    capacityFactor: 1,
  },
  volatile: {
    dailyMove: [0.015, 0.025],
    eventMove: [0.04, 0.06],
    label: 'Volatil',
    note: 'Uyarı: likidite ve stok yaşı daha önemli.',
    spreadShift: 0.006,
    capacityFactor: 0.72,
  },
  shock: {
    dailyMove: [0.015, 0.025],
    /** GDD 13.4 — event hareketleri tavanlıdır. */
    eventMove: [0.06, 0.08],
    label: 'Şok Olay',
    note: 'Önceden kısmi sinyal; pozisyon küçültme mümkün.',
    spreadShift: 0.013,
    capacityFactor: 0.5,
  },
};

/**
 * Ekonomi Ara Düzeltmesi §2.4 / §6 / §8 — KANAL PROFİLLERİ.
 *
 * DEĞİŞMEZ (§8): "Toptancı ve esnaf ağı aynı fiyat/limit algoritmasının
 * yalnızca farklı isimleri olarak uygulanmaz." Aşağıdaki dört profil farklı
 * spread, kapasite, derinlik ve ilişki ağırlığı taşır.
 *
 * DEĞİŞMEZ (§9): "Hiçbir kanal her rejimde en iyi fiyatı, en hızlı işlemi ve
 * en düşük riski AYNI ANDA vermemelidir." Her profilde en az bir zayıflık var.
 *
 * `makerBias` — FİYATI KİM BELİRLİYOR? +1 dükkân (tezgâh müşterisine karşı
 * dükkân piyasa yapıcıdır), negatif ise karşı taraf (toptancıya karşı dükkân
 * fiyat alıcısıdır). Ürün belirsizliği, rejim ve volatilite genişlemesi bu
 * katsayıyla çarpılır: fiyatı belirleyen taraf kendini korur, alan taraf öder.
 * §6.1'in "tersine çevirebilir" cümlesi bu yapıdan doğar — sabitten değil.
 *
 * `slippageFactor` — kanalın derinliği tükendiğinde fazla adet başına ödenen
 * kayma. Tezgâh sığdır (1.35), toptancı derindir (0.42).
 *
 * `maxConcessionShare` — ilişki ve hacim ödünlerinin yarım makasın en fazla
 * ne kadarını yiyebileceği. §8'in gereği: esnaf ağı ve toptancı fiyatlarını
 * ilişki sermayesi taşır, tezgâh taşımaz. Kalan pay her koşulda ayakta kalır
 * ki §11'in arbitraj döngüsü yapısal olarak kapansın.
 */
/**
 * Ekonomi Ara Düzeltmesi §3 — MÜŞTERİ INTENT DAĞILIMI.
 *
 * DEĞİŞMEZ: %38 / %38 SABİT TABANDIR. Dinamik havuz bu iki dilimi azaltamaz;
 * yalnız kalan %24'ün içinde iş görür.
 *
 * DEĞİŞMEZ: "Dinamik havuzun tamamını tek yöne yığarak fiili alış-satış
 * dengesini sürekli biçimde bozmak yasaktır." → `maxDynamicTilt` kelepçesi.
 * Tilt ±0.5 iken havuzun en aşırı günü bile %24'ün 75/25'inden fazlasını tek
 * yöne veremez; toplam sapma en fazla ±%6 puandır.
 */
export const INTENT_MIX = {
  /** Müşteri alış intenti — oyuncu müşteriye satar. */
  customerBuys: 0.38,
  /** Müşteri satış intenti — müşteri oyuncuya satar. */
  customerSells: 0.38,
  /** Kontrollü dinamik/RNG havuzu. */
  dynamic: 0.24,
  /** Dinamik havuzun ticaret dışı niyetlere (servis) ayrılan payı. */
  dynamicServiceShare: 0.55,
  /** Havuzun yön eğiminin mutlak tavanı. */
  maxDynamicTilt: 0.5,
} as const;

/**
 * Müşteri alış akışı ayarları (GDD 23.23 · Addendum §3, §4.1).
 * §9: "Denge ayarları veri odaklıdır: sabit kod yerine konfigürasyon."
 */
export const PURCHASE = {
  /** Sarrafiye talebinde havuz — §4'ün ürün havuzuyla aynı kümedir. */
  bullionDemandPool: [
    'gram_gold_1',
    'gram_gold_5',
    'gram_gold_10',
    'quarter_gold',
    'half_gold',
    'full_gold',
    'republic_gold',
    'ata_gold',
  ] as const,

  /** Bu adetten itibaren toplu müşteri kanal profili kullanılır (§4.1). */
  bulkChannelThreshold: 8,

  /** Toplu müşterinin kısmi karşılamayı kabul etme olasılığı (§4.1). */
  bulkPartialChance: 0.65,
  /** Kısmi karşılamada talebin en az bu payı verilmeli. */
  partialFloorShare: 0.5,

  /** Talebe uymayan kalem başına sabır bedeli. */
  offMatchPatienceCost: 6,
  /** Talebe uymayan kalem başına ödeme tavanı kaybı. */
  offMatchCeilingCut: 0.06,
  /** Tam isabetli kalem başına tavan primi. */
  exactMatchCeilingBonus: 0.02,

  /** Ödeme tavanı oranı bandı — spawn anında sabitlenir (GDD 34.2). */
  ceilingRatioBand: [1.04, 1.34] as [number, number],

  /** Mağaza kademesine göre paketteki azami kalem sayısı. */
  maxPackageLinesByTier: { 1: 2, 2: 3, 3: 4, 4: 5 } as Record<number, number>,

  /**
   * §4.1 — TOPLU MÜŞTERİ PROFİLİ.
   * "Toplu müşteri, normal tekil müşterinin sadece yüksek adetli kopyası
   * değildir." Aşağıdaki katsayılar o cümlenin sayısal karşılığıdır.
   */
  bulk: {
    /** Fiyat hassasiyeti: birim farkı adetle çarpıldığı için çok daha yüksek. */
    priceSensitivityFactor: 1.45,
    /** Sabır: büyük iş pazarlık ister, kapıdan dönmez. */
    patienceFactor: 1.3,
    /** Güven: ilişkiye değil rakama bakar; temkinli başlar. */
    trustFactor: 0.85,
    /** Ödeme tavanı: perakende priminin yalnız bu kadarını öder. */
    ceilingCompression: 0.45,
  },
} as const;

/**
 * Ekonomi Ara Düzeltmesi §7 — TOPTANCI FİNANSMANI.
 *
 * DEĞİŞMEZ: "Finansman, SINIRSIZ STOK ve RİSKSİZ ARBİTRAJ üretmemeli."
 * Bu yüzden vade farkı hiçbir güven seviyesinde sıfırlanmaz (`minRate`) ve
 * limit güvenle büyüse de kendi tavanını taşır.
 */
export const WHOLESALE = {
  /** Vade farkı taban oranı (dönem başına). */
  baseRate: 0.028,
  /** Güvenin vade farkından düşürebileceği azami pay. */
  rateTrustRelief: 0.018,
  /** Vade farkı bunun altına ASLA inmez — bedava kredi arbitraj kapısıdır. */
  minRate: 0.008,

  /** Sıfır güvende bile limitin bu payı kullanılabilir. */
  limitFloorShare: 0.35,
  /** Semt itibarının limite katkı ağırlığı. */
  reputationLimitWeight: 0.2,
  /** Güvenin vadeye ekleyebileceği azami gün. */
  termBonusDays: 4,

  /** Zamanında ödemenin güven kazancı. */
  onTimeTrustGain: 4,
  /** Geciken ödemenin güven cezası. */
  lateTrustPenalty: 9,
  /** Zamanında ödemede limit büyüme katsayısı. */
  onTimeLimitGrowth: 1.06,
  /** Gecikmede limit daralma katsayısı. */
  lateLimitCut: 0.82,
  /** Limit bunun altına inmez. */
  minLimit: 10_000,

  /** Gecikmiş borcun günlük yükü. */
  overduePerDayRate: 0.012,
  /** Gecikmenin günlük güven aşınması. */
  overdueDailyTrustPenalty: 3,

  /** Bir lotun kanal kapasitesine oranı — toptancı sınırsız mal satmaz. */
  lotShareOfCapacity: 0.18,
} as const;

/**
 * Ekonomi Ara Düzeltmesi §8 — ESNAF AĞI.
 *
 * DEĞİŞMEZ: "toptancının yerine geçen SINIRSIZ İKİNCİ BANKA DEĞİLDİR."
 * Sayılar bu cümleyi taşımak için seçildi: üye başına tavan toptancı
 * limitinin küçük bir kesri, vade yarısı kadar kısa, ve ağ tavanı üye
 * tavanlarının TOPLAMINDAN belirgin küçük.
 */
export const NETWORK = {
  /** Ağdaki esnaf sayısı. */
  memberCount: 6,
  /** Bir esnafın kasasındaki nakit bandı — bozdurma kapasitesinin kaynağı. */
  cashBand: [18_000, 70_000] as [number, number],
  /** Gün başında kasanın tazelenen payı; ağ kalıcı kurumaz. */
  dailyReplenishShare: 0.22,
  /** Bu iştahın altındaki esnaf sarrafiye almaz (§8 "uygun esnafta"). */
  minAppetiteToBuy: 0.3,

  /** Kısa vadeli borç tabanı. */
  loanBase: 4_000,
  /** Güven puanı başına borç kapasitesi. */
  loanPerTrustPoint: 90,
  /** Düzenli ödemenin kapasiteye katkısı (§8 "düzenli ödeme ağı güçlendirebilir"). */
  historyBonusPerRepayment: 1_200,
  /** Gecikmenin kapasite cezası. */
  historyPenaltyPerLate: 2_600,

  /**
   * Ağın TOPLAM açık borç tavanı. Üye tavanlarının toplamından belirgin
   * küçük: toplam olsaydı üye sayısını artırmak sınırsız bankaya giden yol
   * olurdu (§8).
   */
  networkDebtCeiling: 45_000,
  /** Sıfır ortalama güvende bile ağ tavanının bu payı açıktır. */
  ceilingFloorShare: 0.3,

  /** §8 "KISA vadeli" — toptancının vadesinin yarısı kadar. */
  termDays: 2,
  /** Bu güvenin üstündeki esnaf bir gün daha veriyor. */
  longTermTrust: 70,

  /** Dayanışma ücreti — gizli değil, işlem öncesi görünür. */
  baseFeeRate: 0.035,
  feeTrustRelief: 0.02,
  /** Ücret hiçbir güvende sıfırlanmaz; bedava para arbitraj kapısıdır. */
  minFeeRate: 0.012,

  /** Zamanında ödeme ilişkiyi güçlendirir. */
  onTimeTrustGain: 5,
  /** Gecikme ilişkiyi aşındırır — ağ toptancıdan daha kırılgandır. */
  lateTrustPenalty: 14,
  /** Ticaret ilişkiyi bir tık büyütür. */
  tradeTrustGain: 2,

  /** Gecikmiş borcun günlük yükü. */
  overduePerDayRate: 0.02,
  overdueDailyTrustPenalty: 5,
} as const;

export const CHANNEL = {
  /**
   * Tezgâh müşterisi: dükkânın fiyatı BELİRLEDİĞİ kanal (makerBias +1).
   * Marjı en yüksek, kapasitesi en dar, derinliği en sığ olan kanal.
   */
  retailCustomer: {
    buySpread: 0.02,
    sellSpread: 0.014,
    capacityUnits: 5,
    slippageFactor: 1.35,
    relationshipWeight: 0.006,
    makerBias: 1,
    maxConcessionShare: 0.55,
    settlementDays: 0,
  },
  /** Toplu müşteri: hacim getirir, pazarlık gücünün bir kısmını da (§4.1). */
  bulkCustomer: {
    buySpread: 0.011,
    sellSpread: 0.008,
    capacityUnits: 60,
    slippageFactor: 0.9,
    relationshipWeight: 0.012,
    makerBias: 0.45,
    maxConcessionShare: 0.6,
    settlementDays: 0,
  },
  /**
   * Toptancı: fiyatı TOPTANCI belirler (makerBias negatif). Dükkân burada
   * fiyat alıcısıdır — ürün belirsizliğinin ve volatilitenin bedelini o öder.
   * Karşılığında en derin piyasa ve en yüksek kapasite (§4.2).
   * Zayıflığı: küçük hacimde tezgâhtan KÖTÜ fiyat verir; üstünlüğü ancak
   * hacim tezgâhın derinliğini tükettiğinde ortaya çıkar (§6.1).
   */
  wholesaler: {
    buySpread: 0.002,
    sellSpread: 0.001,
    capacityUnits: 220,
    slippageFactor: 0.42,
    relationshipWeight: 0.022,
    makerBias: -0.6,
    maxConcessionShare: 0.8,
    settlementDays: 0,
  },
  /**
   * Esnaf ağı: toptancının kopyası DEĞİL (§8). Kapasitesi bir düzine kat
   * küçük, ilişki ağırlığı en yüksek — fiyatı neredeyse tamamen ilişki
   * sermayesi taşır. Derinliği toptancıdan çok sığdır.
   */
  tradeNetwork: {
    buySpread: 0.008,
    sellSpread: 0.006,
    capacityUnits: 18,
    slippageFactor: 1.05,
    relationshipWeight: 0.026,
    makerBias: -0.15,
    maxConcessionShare: 0.85,
    settlementDays: 0,
  },
} as const;

/** Rejim seçimi ağırlıkları — gün başında belirlenir (GDD 13.3). */
export const REGIME_WEIGHTS: { value: MarketRegime; weight: number }[] = [
  { value: 'calm', weight: 30 },
  { value: 'normal', weight: 45 },
  { value: 'volatile', weight: 20 },
  { value: 'shock', weight: 5 },
];

/** Başlangıç piyasa referansları (oyun TL). */
export const MARKET_BASE = {
  goldGram: 4_244,
  silverGram: 48.6,
  usd: 32.45,
  eur: 34.89,
  /** Çeyrek altın = 1.75 g × 0.916 saflık × spot × ticari spread. */
  quarterGoldSpread: 1.075,
  quarterGoldWeight: 1.75,
} as const;

/** Kondisyonun gerçek değerden düşülen oranı (GDD 6.2 kondisyon kesintisi). */
export const CONDITION_DEDUCTION: Record<ConditionGrade, number> = {
  pristine: 0,
  good: 0.02,
  worn: 0.07,
  damaged: 0.16,
  broken: 0.3,
};

export const CONDITION_LABEL: Record<ConditionGrade, string> = {
  pristine: 'Kusursuz',
  good: 'İyi',
  worn: 'Yıpranmış',
  damaged: 'Hasarlı',
  broken: 'Kırık',
};

/** Kondisyon sıralaması — servis sonrası iyileşmeyi hesaplamak için. */
export const CONDITION_ORDER: ConditionGrade[] = ['broken', 'damaged', 'worn', 'good', 'pristine'];

/**
 * GDD 7.2 — Diminishing return.
 * Aynı bilgi alanında n'inci test, temel kazancın bu çarpanıyla çalışır.
 */
export const DIMINISHING_RETURN = [1.0, 0.45, 0.2, 0.08] as const;

/**
 * GDD 7 — hata payı "Çok düşük" olan araçlar bir çıkarım değil ÖLÇÜMdür
 * (hassas terazi, dijital spektrometre). Bu eşiğin üstündeki güvenilirlik,
 * aracın ilgilendiği bilgi alanını tam olarak kapatır: "Ayarı çok yüksek
 * doğrulukla çözer... İleri oyun kesinlik aracı."
 */
export const DEFINITIVE_RELIABILITY = 0.95;

/** Güven seviyesi eşikleri — bandın göreli genişliğine göre (GDD 6.3). */
export const CONFIDENCE_THRESHOLD = {
  /** Bu genişliğin altı = yüksek güven. */
  high: 0.06,
  /** Bu genişliğin altı = orta güven. */
  medium: 0.16,
} as const;

/**
 * GDD 11 — Pazarlık denge parametreleri.
 * GDD 35.1: "Yüksek güven her fiyatı kabul ettirmez; ilişki fiyat farkını
 * sınırlı ölçüde tolere eder." MAX_RESERVATION_FLEX bu sınırı kodlar.
 */
export const NEGOTIATION = {
  /** Rezervasyon fiyatı ilişki/gerekçe ile en fazla bu kadar esneyebilir. */
  maxReservationFlex: 0.08,

  /** Kapanış skoru bileşen ağırlıkları (GDD 11.3). */
  weights: {
    trust: 0.028,
    urgency: 0.022,
    reasoning: 0.02,
    reputation: 0.015,
    gesture: 0.012,
    waiting: -0.02,
    suspicion: -0.035,
  },

  /** Karşı teklif marjı: müşteri rezervasyonunun üstüne bu oranı koyar. */
  counterMarginByState: {
    OPEN: [0.14, 0.09] as [number, number],
    HARDENING: [0.06, 0.04] as [number, number],
    FINAL_OFFER: [0.02, 0.02] as [number, number],
  },

  /** Bu orandan düşük teklif "kötü teklif" sayılır ve sertleşmeyi tetikler. */
  insultThreshold: 0.82,
  /** Sertleşmeye geçiş için gereken kötü teklif sayısı. */
  hardeningTrigger: 2,
  /** FINAL_OFFER'a geçiş: sabır bu oranın altına düştüğünde. */
  finalOfferPatienceRatio: 0.28,

  /** Tur başına temel sabır maliyeti. */
  patiencePerRound: 6,
  /** Aynı teklifi tekrar etmenin sabır cezası (GDD 11.4). */
  repeatOfferPatiencePenalty: 14,
  repeatOfferTrustPenalty: 5,
  /** İki teklifi "aynı" saymak için göreli fark eşiği. */
  repeatEpsilon: 0.005,

  /** Karşı teklif isteme maliyeti. */
  requestCounterPatienceCost: 9,
  /** Jest: küçük marj kaybı oranı. */
  gestureCostRatio: 0.012,
  gestureTrustGain: 6,
  /** Bir oturumda anlamlı jest sayısı üst sınırı (exploit koruması, GDD 10.4). */
  maxEffectiveGestures: 2,
  /** Doğru gerekçenin güven kazancı. */
  reasonTrustGain: 5,
  /** Yanlış/şüpheli gerekçenin bilinçli müşteride güven cezası (GDD 11.5). */
  falseReasonTrustPenalty: 12,
  falseReasonKnowledgeThreshold: 55,
} as const;

/** Test aracı süresinin sabır maliyetine çevrimi. */
export const PATIENCE_PER_TEST_SECOND = 1.6;

/**
 * GDD 17 — Servis ve atölye denge parametreleri. Tümü PLAYTEST.
 *
 * DEĞİŞMEZ (GDD 17.4): burada pasif gelir üreten hiçbir parametre yoktur.
 * Her değer ya bir maliyeti, ya bir riski, ya da bir ilişki sonucunu ölçekler.
 */
export const SERVICE = {
  /** GDD 14.1 — "Servis brüt marj %35–60". Ücret bu banttan türetilir. */
  grossMarginBand: [0.35, 0.6] as [number, number],

  /**
   * GDD 35 hata riski formülünün yoğunluk terimi ağırlığı.
   * GDD 17.3: "Aşırı iş almak bekleme süresini ve hata riskini artırır."
   */
  loadRiskWeight: 0.3,

  /** Personel başına beceri katkısı (riski düşürür). Personel sistemi post-MVP. */
  staffSkillPerMember: 0.06,

  /** Mağaza kademesine bağlı ekipman bonusu (GDD 17.2 "ekipman"). */
  equipmentBonusByTier: { 1: 0, 2: 0.04, 3: 0.08, 4: 0.13, 5: 0.18 } as Record<number, number>,

  /** GDD 17.2 — dış usta: marj düşer, süre uzar, kapasite tüketmez. */
  outsource: {
    /** Ücretin dış ustaya giden payı. */
    feeShare: 0.42,
    /** Kendi atölyeye göre ek gün. */
    extraDays: 2,
    /** Dış ustanın hata riski çarpanı — kontrol sende değildir. */
    riskFactor: 0.85,
  },

  /** GDD 17.3 — teslim sözü kişisel güvenin parçasıdır. */
  promise: {
    /** Varsayılan tampon: bir gün pay bırak. */
    defaultBufferDays: 1,
    /** Tamponsuz (sıkı) söz tutulursa ek güven. */
    tightBonus: 4,
    /** Aşırı geniş söz vermenin güven maliyeti. */
    loosePenalty: -2,
    /** Oyuncunun seçebileceği en geniş tampon. */
    maxBufferDays: 3,
  },

  /** Sözden her gün gecikmenin güven cezası. */
  latePenaltyPerDay: 6,

  /** GDD 21.2 — servis hatasında ödenen tazminin ücrete oranı. */
  compensationRatio: 1.25,

  /** Servis hatasının doğrudan güven cezası. */
  failureTrustPenalty: 18,

  /** Kişisel güven hareketinin semt itibarına yansıma oranı (GDD 10.4). */
  reputationTransfer: 0.25,

  /** Servis işi kabul edildiğinde kazanılan XP. */
  xpOnAccept: 18,
  /** Başarılı teslimde kazanılan ek XP. */
  xpOnDelivery: 26,
} as const;

/** XP kazanımı — GDD 18.1 "doğru ekspertiz, kârlı işlem, iyi risk kararı". */
export const XP = {
  dealClosed: 30,
  perTestUsed: 6,
  highConfidenceBonus: 25,
  goodMarginBonus: 40,
  /** Zararına kapanan işlem XP vermez ama cezalandırmaz. */
  lossFloor: 0,
  levelCurve: (level: number) => Math.round(400 + level * level * 180),
} as const;

/** Güven / itibar hareketleri (GDD 10). */
export const TRUST = {
  /** Adil fiyat algısı eşiği: teklif/rezervasyon oranı. */
  fairPriceRatio: 1.02,
  fairDealGain: 8,
  harshDealPenalty: 10,
  rejectPenalty: 4,
  /** Semt itibarına yansıma oranı — tek işlem itibarı uçurmaz (GDD 10.4). */
  reputationTransfer: 0.12,
} as const;

/** Gün akışı (GDD 3.2). */
export const DAY = {
  openMinutes: 9 * 60,
  closeMinutes: 19 * 60,
  /** Gerçek saniye başına ilerleyen oyun dakikası (1x hızda). */
  minutesPerRealSecond: 1.2,
  /** Müşteri geliş aralığı (oyun dakikası). PLAYTEST. */
  customerIntervalMinutes: [12, 26] as [number, number],
} as const;

/** Hız kontrolü — 1x/2x temel, 4x rewarded (GDD 23.9.2 / 26.2). */
export const SPEED_STEPS = [1, 2, 4] as const;
export type SpeedStep = (typeof SPEED_STEPS)[number];
