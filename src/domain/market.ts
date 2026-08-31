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

import {
  EVENT_DIRECTION,
  MARKET_BASE,
  MARKET_COMPOSITION,
  MARKET_REGIME,
  REGIME_DRIFT,
  REGIME_TRANSITIONS,
  REGIME_WEIGHTS,
} from './balance';
import { Rng, deriveSeed } from './rng';
import { bullionMeta } from '@data/bullion';
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

  // --- 1. REJİM: bir DURUM, günlük çekiliş değil (§5.1) ---
  const regime = nextRegime(rng, prev?.regime ?? null);

  // --- 2. TREND: momentumla taşınır (§5.1) ---
  const trend = nextTrend(rng, prev?.trend ?? 0, regime);

  const cfg = MARKET_REGIME[regime];
  const volatility = rng.band(cfg.dailyMove);

  // --- 3. OLAY: "SÜRELİ değişken" (§5.1) ---
  // Olay her gün yeniden çekilmez; süresi dolana kadar taşınır ve etkisi
  // sönümlenir. Her gün yeni olay çekmek, olayı bir haber değil bir zar
  // yapardı.
  const activeEvent = carryEvent(rng, prev?.activeEvent ?? null, day, regime);

  const prevGold = prev?.goldSpot ?? MARKET_BASE.goldGram;
  const prevSilver = prev?.silverSpot ?? MARKET_BASE.silverGram;
  const prevFx = prev?.fxIndex ?? MARKET_BASE.usd;

  // --- 4. AĞIRLIKLI BİLEŞİM (§5.1) ---
  //
  // §5.1 DEĞİŞMEZ: "Ertesi gün fiyatı basit ve BAĞIMSIZ bir 50/50 yükseliş-
  // düşüş çekilişiyle belirlenmez." Dört bileşenin ağırlıklı sonucudur ve
  // hiçbiri tek başına yönü belirlemez:
  const move = composeDailyMove(rng, { regime, trend, volatility, activeEvent, day });

  const goldSpot = round2(prevGold * (1 + move.total));
  const silverSpot = round2(prevSilver * (1 + move.total * rng.range(0.8, 1.6)));
  const fxIndex = round2(prevFx * (1 + move.total * 0.3));

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

/** §5.1 fiyat bileşenlerinin tek tek katkısı — §5.2 sinyalleri buradan okur. */
export interface DailyMove {
  regimeDrift: number;
  trendMomentum: number;
  eventImpact: number;
  noise: number;
  total: number;
}

/**
 * §5.1 — dört bileşenin AĞIRLIKLI sonucu.
 *
 * "Kontrollü RNG: rejim ve olay sınırları içinde belirsizlik üretir; sonucu
 * KEYFİ veya TAMAMEN BAĞIMSIZ yapmaz." Bu yüzden gürültü bağımsız bir yön
 * çekilişi değil, toplam hareketin sınırlı bir payıdır ve rejimin
 * volatilitesiyle ölçeklenir.
 */
export function composeDailyMove(
  rng: Rng,
  input: {
    regime: MarketState['regime'];
    trend: -1 | 0 | 1;
    volatility: number;
    activeEvent: MarketEvent | null;
    day: GameDay;
  },
): DailyMove {
  const cfg = MARKET_REGIME[input.regime];
  const w = MARKET_COMPOSITION;

  // Rejim kayması: stres rejimleri aşağı eğilimlidir, sakin rejim nötre yakın.
  const regimeDrift = REGIME_DRIFT[input.regime] * input.volatility * w.regime;

  // Trend momentumu: dünün yönü bugüne taşınır, ama tek başına yetmez.
  const trendMomentum = input.trend * input.volatility * w.trend;

  // Olay etkisi: süresi ilerledikçe sönümlenir; tavanı rejim tarafından
  // belirlenir (GDD 13.4 "event hareketleri tavanlıdır").
  let eventImpact = 0;
  if (input.activeEvent) {
    const age = input.day - input.activeEvent.startedDay;
    const decay = Math.max(0, 1 - age / Math.max(1, input.activeEvent.durationDays));
    // Tanımsız olay yönü sessizce 0 olur; bilinmeyen bir haber fiyatı itmez.
    const direction = EVENT_DIRECTION[input.activeEvent.id] ?? 0;
    eventImpact = direction * rng.band(cfg.eventMove) * decay * w.event;
  }

  // Kontrollü RNG: yönü değil, sapmayı üretir.
  const noise = (rng.next() - 0.5) * 2 * input.volatility * w.noise;

  return {
    regimeDrift,
    trendMomentum,
    eventImpact,
    noise,
    total: regimeDrift + trendMomentum + eventImpact + noise,
  };
}

/**
 * §5.1 "Piyasa rejimi: ... DURUM." Rejim bir durumdur; her gün sıfırdan
 * çekilmez, geçiş olasılıklarıyla evrilir. Sıfırdan çekmek, rejimi bir
 * durum değil ikinci bir zar yapardı.
 */
export function nextRegime(rng: Rng, prev: MarketState['regime'] | null): MarketState['regime'] {
  if (!prev) return rng.pickWeighted(REGIME_WEIGHTS);
  const row = REGIME_TRANSITIONS[prev];
  return rng.pickWeighted(row.map((r) => ({ value: r.to, weight: r.weight })));
}

/**
 * §5.1 — yön de momentumla taşınır. Bağımsız 34/32/34 çekilişi, §5.1'in
 * açıkça reddettiği "bağımsız 50/50" ile aynı şeydi.
 */
export function nextTrend(
  rng: Rng,
  prev: -1 | 0 | 1,
  regime: MarketState['regime'],
): -1 | 0 | 1 {
  // Stresli rejimde yön daha kaygan; sakin rejimde daha ısrarcı.
  const persistence =
    regime === 'calm' ? 0.72 : regime === 'normal' ? 0.6 : regime === 'volatile' ? 0.44 : 0.3;

  if (rng.chance(persistence)) return prev;
  return rng.pickWeighted([
    { value: -1 as const, weight: regime === 'shock' ? 42 : 34 },
    { value: 0 as const, weight: 32 },
    { value: 1 as const, weight: regime === 'shock' ? 26 : 34 },
  ]);
}

/**
 * §5.1 "Olay etkisi: ... SÜRELİ değişken." Aktif olay süresi dolana kadar
 * taşınır; yeni olay ancak eskisi bittiğinde çıkabilir.
 */
export function carryEvent(
  rng: Rng,
  prev: MarketEvent | null,
  day: GameDay,
  regime: MarketState['regime'],
): MarketEvent | null {
  if (prev && day - prev.startedDay < prev.durationDays) return prev;

  const eventChance = regime === 'shock' ? 0.85 : regime === 'volatile' ? 0.45 : 0.14;
  if (day <= 1 || !rng.chance(eventChance)) return null;

  const template = rng.pick(EVENT_POOL);
  return { ...template, startedDay: day };
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
      return round2(spots.goldSpot * bullionMeta('gram_gold_1')!.unitPurity);
    case 'silverGram':
      return round2(spots.silverSpot);
    case 'quarterGold':
      // GDD 13.1 — ürün fiyatları ayar/saflık ve ticari spread üzerinden
      // ana referanstan türer. Bağımsız fiyat = arbitraj açığı olurdu (13.4).
      return round2(
        spots.goldSpot *
          MARKET_BASE.quarterGoldWeight *
          bullionMeta('quarter_gold')!.unitPurity,
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
