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
  { dailyMove: [number, number]; eventMove: [number, number]; label: string; note: string }
> = {
  calm: {
    dailyMove: [0.004, 0.009],
    eventMove: [0, 0],
    label: 'Sakin',
    note: 'Dar bant, düşük stok riski.',
  },
  normal: {
    dailyMove: [0.008, 0.018],
    eventMove: [0.02, 0.03],
    label: 'Normal',
    note: 'Nötr veya hafif trend.',
  },
  volatile: {
    dailyMove: [0.015, 0.025],
    eventMove: [0.04, 0.06],
    label: 'Volatil',
    note: 'Uyarı: likidite ve stok yaşı daha önemli.',
  },
  shock: {
    dailyMove: [0.015, 0.025],
    /** GDD 13.4 — event hareketleri tavanlıdır. */
    eventMove: [0.06, 0.08],
    label: 'Şok Olay',
    note: 'Önceden kısmi sinyal; pozisyon küçültme mümkün.',
  },
};

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
