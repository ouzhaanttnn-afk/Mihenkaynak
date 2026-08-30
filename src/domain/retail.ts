/**
 * VİTRİN SATIŞI — çıkış kanalının gerçekten uygulanması (GDD 8.1).
 *
 * NEDEN VAR: `retail` altı çıkış kanalından biriydi, tam olarak
 * modellenmişti (`EXIT_CHANNEL.retail`: markup, realizationRatio,
 * daysToCash, holdingCostPerDay) ve İŞLEM TEZİNDE oyuncuya sunuluyordu —
 * ama uygulanacak hiçbir yolu yoktu. Yalnız toptancı ve esnaf ağı
 * gerçekten satış yapabiliyordu.
 *
 * ÖLÇÜLEN SONUÇ (958 ticaret işlemi): oyuncuya sunulan EN İYİ tez
 * %99,9 oranında uygulanamaz olandı.
 *
 *   kanal        sunulma   ort. alış tavanı   uygulanabilir?
 *   retail           928            157.583   HAYIR
 *   melt             958            134.272   HAYIR
 *   wholesale        958            130.633   evet
 *
 * Yani oyun "vitrinde satarsan 157.583'e kadar verebilirsin" diyor, oyuncu
 * o parayı ödüyor, sonra malı ancak toptancıya 130.633'e verebiliyor:
 * her işçilikli alımda sistematik ~%21 fazla ödeme. Uzun simülasyonlarda
 * ekonominin düz kalmasının sebebi buydu.
 *
 * BU DOSYA YENİ EKONOMİ KURMAZ. Fiyatı `expectedExitValues.retail`ten,
 * yani tezin oyuncuya GÖSTERDİĞİ sayıdan alır — vaat edilenle gerçekleşen
 * aynı olsun diye. Yeni bir formül yazmak, aynı kanalın iki farklı fiyatı
 * olması demekti.
 */

import { EXIT_CHANNEL, RETAIL } from './balance';
import { Rng, deriveSeed } from './rng';
import type { GameDay, InventoryPosition, Money } from './types';

/** Vitrinde gerçekleşen tek bir satış. */
export interface RetailSale {
  itemId: string;
  /** Satılan adet — sarrafiye yığılır, işçilikli kalem tektir. */
  quantity: number;
  /** Tahsil edilen tutar. */
  price: Money;
  /** Bu adede düşen maliyet tabanı — gerçekleşmiş kâr bundan doğar. */
  costBasis: Money;
}

export interface RetailDayResult {
  sales: RetailSale[];
  /** Vitrinde bekleyen her kalemin günlük fırsat maliyeti. */
  holdingCost: Money;
}

/**
 * Bir kalemin o günkü satılma olasılığı.
 *
 * Çıpa `daysToCash`in ortasıdır: ortalama 5 günde dönen bir vitrin, günde
 * ~1/5 ihtimal demektir. Talep etiketi ve bekleme süresi bunu eğer —
 * bekleyen mal "yanar", çünkü vitrinde unutulan kalem gerçekte de
 * indirimle gider.
 */
export function dailySaleChance(position: InventoryPosition): number {
  const [lo, hi] = EXIT_CHANNEL.retail.daysToCash;
  const base = 1 / ((lo + hi) / 2);
  const talep =
    position.demand === 'hot'
      ? RETAIL.demandFactor.hot
      : position.demand === 'cold'
        ? RETAIL.demandFactor.cold
        : RETAIL.demandFactor.steady;
  // Yaşlanan mal ivme kaybeder ama sıfırlanmaz; taban her zaman kalır.
  const yas = Math.max(RETAIL.ageFloor, 1 - position.age * RETAIL.ageDecayPerDay);
  return Math.min(1, base * talep * yas);
}

/**
 * Gün kapanışında vitrini çözer.
 *
 * SAF: durum değiştirmez, ne satıldığını ve ne kadar taşıma maliyeti
 * doğduğunu döndürür. Uygulama settlement katmanının işidir — para tek
 * kapıdan geçsin (GDD 22.1).
 *
 * DETERMİNİZM: çekiliş KENDİ isim uzayında ('retail/day'), yani mevcut
 * rastgelelik akışlarını kaydırmaz (GDD 28.3). Aynı tohum + aynı gün +
 * aynı kalem her zaman aynı sonucu verir.
 */
export function resolveRetailDay(
  rootSeed: number,
  day: GameDay,
  inventory: InventoryPosition[],
): RetailDayResult {
  const vitrinde = inventory.filter((p) => p.location === 'display' && p.thesis === 'retail');

  const sales: RetailSale[] = [];
  vitrinde.forEach((position, i) => {
    const fiyat = position.expectedExitValues.retail;
    // Tez bu kanalı hesaplamadıysa satılacak bir fiyat da yok.
    if (fiyat === undefined || fiyat <= 0) return;

    const rng = new Rng(deriveSeed(rootSeed, 'retail/day', day * 1000 + i));
    if (!rng.chance(dailySaleChance(position))) return;

    /*
      Yığılabilir üründe günde TEK adet gider: vitrinden 40 çeyreğin bir
      anda satılması, oyuncunun bekleme kararını anlamsız kılardı. İşçilikli
      kalem zaten tektir.
    */
    const adet = Math.min(1, position.quantity);
    if (adet <= 0) return;

    const birimFiyat = Math.round(fiyat / Math.max(1, position.quantity));
    const birimMaliyet = Math.round(position.costBasis / Math.max(1, position.quantity));
    sales.push({
      itemId: position.itemId,
      quantity: adet,
      price: birimFiyat * adet,
      costBasis: birimMaliyet * adet,
    });
  });

  return {
    sales,
    holdingCost: vitrinde.length * EXIT_CHANNEL.retail.holdingCostPerDay,
  };
}
