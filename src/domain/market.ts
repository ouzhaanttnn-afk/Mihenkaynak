/**
 * MIHENKAYNAK — Piyasa ve rejim motoru
 * Kaynak: GDD 13 "Piyasa ve Ekonomi Rejimleri".
 *
 * Değişmezler:
 *  - 13.3: Rejim ve ana yön gün başında belirlenir; gün içi adımlar rejim
 *    sınırları içinde hareket eder.
 *  - 13.4: Oyun yeniden açıldığında piyasa oyuncuya özel avantaj üretecek
 *    şekilde reroll edilmez → tüm hareket (day, seed) üzerinden türetilir.
 *  - 13.4: Event fiyat hareketleri tavanlıdır ve önceden kısmi sinyal verir.
 */

import { MARKET_BASE, MARKET_REGIME, REGIME_WEIGHTS } from './balance';
import { Rng, deriveSeed } from './rng';
import type { MarketAsset, MarketEvent, MarketState, GameDay } from './types';

/** GDD 20.2 — dinamik olay en az iki sistemi etkiler ve karşı oyun sunar. */
const EVENT_POOL: Omit<MarketEvent, 'startedDay'>[] = [
  {
    id: 'wedding_season',
    label: 'Düğün Sezonu',
    description: 'Bilezik ve set talebi ile birlikte servis yoğunluğu artıyor.',
    affects: ['talep: klasik takı', 'atölye kapasitesi'],
    counterplay: ['Önceden stok kur', 'Vitrin önceliğini değiştir', 'Servis kapasitesi ayır'],
    durationDays: 3,
  },
  {
    id: 'market_rally',
    label: 'Piyasa Rallisi',
    description: 'Yatırım ürünü talebi artıyor, tedarik pahalanıyor.',
    affects: ['talep: yatırım altını', 'toptancı fiyat bandı'],
    counterplay: ['Likiditeyi koru', 'Kısa vade riskini azalt'],
    durationDays: 2,
  },
  {
    id: 'fx_calm',
    label: 'Kur Sakinleşmesi',
    description: 'Takı ve perakende talebi güçlenebilir.',
    affects: ['talep: perakende', 'vitrin dönüş hızı'],
    counterplay: ['Vitrin kampanyası', 'Servis + satış paketi'],
    durationDays: 2,
  },
  {
    id: 'fake_wave',
    label: 'Sahte Ürün Dalgası',
    description: 'Riskli müşteri oranı yükseliyor. Doğrulama daha değerli.',
    affects: ['müşteri havuzu riski', 'ekspertiz değeri'],
    counterplay: ['Daha fazla doğrulama testi', 'Alış tavanını düşür'],
    durationDays: 2,
  },
];

/**
 * Bir gün için piyasa durumunu deterministik olarak üretir.
 * Aynı (rootSeed, day) her zaman aynı rejim, trend ve spot üretir — reload
 * avantajı imkânsızdır (GDD 13.4 / 28.3).
 */
export function createMarketForDay(rootSeed: number, day: GameDay, prev?: MarketState): MarketState {
  const rng = new Rng(deriveSeed(rootSeed, 'market/day', day));

  const regime = rng.pickWeighted(REGIME_WEIGHTS);
  const trend: -1 | 0 | 1 = rng.pickWeighted([
    { value: -1 as const, weight: 34 },
    { value: 0 as const, weight: 32 },
    { value: 1 as const, weight: 34 },
  ]);

  const cfg = MARKET_REGIME[regime];
  const volatility = rng.band(cfg.dailyMove);

  // Olay: yalnız volatil/şok rejimde veya düşük olasılıkla normalde çıkar.
  // GDD 13.3 — büyük olaylar kısmi ön sinyal verir; tek başına kaderi belirlemez.
  let activeEvent: MarketEvent | null = null;
  const eventChance = regime === 'shock' ? 1 : regime === 'volatile' ? 0.55 : 0.18;
  if (day > 1 && rng.chance(eventChance)) {
    const template = rng.pick(EVENT_POOL);
    activeEvent = { ...template, startedDay: day };
  }

  const prevGold = prev?.goldSpot ?? MARKET_BASE.goldGram;
  const prevSilver = prev?.silverSpot ?? MARKET_BASE.silverGram;
  const prevFx = prev?.fxIndex ?? MARKET_BASE.usd;

  const eventKick = activeEvent ? rng.band(cfg.eventMove) * (rng.chance(0.5) ? 1 : -1) : 0;
  const drift = trend * volatility * rng.range(0.4, 1);

  const goldSpot = round2(prevGold * (1 + drift + eventKick));
  const silverSpot = round2(prevSilver * (1 + drift * rng.range(0.8, 1.6) + eventKick * 0.7));
  const fxIndex = round2(prevFx * (1 + drift * 0.3));

  const assets = buildAssets(
    { goldSpot, silverSpot, fxIndex },
    { goldSpot: prevGold, silverSpot: prevSilver, fxIndex: prevFx },
    prev,
  );

  return {
    day,
    clockMinutes: 9 * 60,
    goldSpot,
    silverSpot,
    fxIndex,
    regime,
    trend,
    volatility,
    activeEvent,
    assets,
    seed: rootSeed,
  };
}

/**
 * Gün içi mikro adım. GDD 13.3 — "gün içinde küçük fiyat adımları bu rejimin
 * sınırları içinde hareket eder". Adım da (day, clock) ile deterministiktir.
 */
export function stepMarketIntraday(market: MarketState, newClockMinutes: number): MarketState {
  const stepIndex = Math.floor(newClockMinutes / 15);
  const rng = new Rng(deriveSeed(market.seed, `market/intraday/${market.day}`, stepIndex));

  // Gün içi adım, günlük volatilitenin küçük bir kesridir.
  const stepScale = market.volatility * 0.12;
  const dayOpenGold = market.assets.find((a) => a.id === 'goldGram')?.history[0] ?? market.goldSpot;

  const nudge = (rng.next() - 0.5) * 2 * stepScale + market.trend * stepScale * 0.35;
  const goldSpot = round2(market.goldSpot * (1 + nudge));
  const silverSpot = round2(market.silverSpot * (1 + nudge * rng.range(0.9, 1.4)));
  const fxIndex = round2(market.fxIndex * (1 + nudge * 0.25));

  const assets = market.assets.map((asset) => {
    const price = priceForAsset(asset.id, { goldSpot, silverSpot, fxIndex });
    const base = asset.history[0] ?? price;
    return {
      ...asset,
      price,
      changePct: base === 0 ? 0 : ((price - base) / base) * 100,
      history: [...asset.history.slice(-23), price],
    };
  });

  void dayOpenGold;
  return { ...market, clockMinutes: newClockMinutes, goldSpot, silverSpot, fxIndex, assets };
}

type Spots = { goldSpot: number; silverSpot: number; fxIndex: number };

function priceForAsset(id: MarketAsset['id'], spots: Spots): number {
  switch (id) {
    case 'goldGram':
      return round2(spots.goldSpot);
    case 'silverGram':
      return round2(spots.silverSpot);
    case 'quarterGold':
      // GDD 13.1 — ürün fiyatları ayar/saflık ve ticari spread üzerinden
      // ana referanstan türer. Bağımsız fiyat = arbitraj açığı olurdu (13.4).
      return round2(
        spots.goldSpot *
          MARKET_BASE.quarterGoldWeight *
          0.916 *
          MARKET_BASE.quarterGoldSpread,
      );
    case 'usd':
      return round2(spots.fxIndex);
    case 'eur':
      return round2(spots.fxIndex * (MARKET_BASE.eur / MARKET_BASE.usd));
  }
}

function buildAssets(spots: Spots, prevSpots: Spots, prev?: MarketState): MarketAsset[] {
  const defs: { id: MarketAsset['id']; label: string; unit: string }[] = [
    { id: 'goldGram', label: 'Gram Altın', unit: '₺/g' },
    { id: 'quarterGold', label: 'Çeyrek', unit: '₺' },
    { id: 'silverGram', label: 'Gümüş', unit: '₺/g' },
    { id: 'usd', label: 'Dolar', unit: '₺' },
    { id: 'eur', label: 'Euro', unit: '₺' },
  ];

  return defs.map((def) => {
    const price = priceForAsset(def.id, spots);
    const prevPrice = priceForAsset(def.id, prevSpots);
    const prevHistory = prev?.assets.find((a) => a.id === def.id)?.history ?? [];
    return {
      id: def.id,
      label: def.label,
      unit: def.unit,
      price,
      changePct: prevPrice === 0 ? 0 : ((price - prevPrice) / prevPrice) * 100,
      // Gün açılışında history yeniden başlar; ilk eleman günün referansıdır.
      history: [price, ...prevHistory.slice(0, 11)],
    };
  });
}

/** Ürünün metal cinsine göre anlık gram spotu. */
export function spotFor(market: MarketState, metal: 'gold' | 'silver'): number {
  return metal === 'gold' ? market.goldSpot : market.silverSpot;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
