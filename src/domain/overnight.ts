/**
 * MIHENKAYNAK — Overnight exposure
 * Kaynak: Ekonomi Ara Düzeltmesi v1.0 · §5, §5.2; GDD 14.3, 34.5.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §5 DEĞİŞMEZ: "Gün kapanışında oyuncunun nakit ve altın dağılımı bir
 * POZİSYONDUR. Altında kalmak fiyat düşüşüne, nakitte kalmak ise fiyat
 * yükselişi karşısında FIRSAT MALİYETİNE maruz bırakır. Sistem, her iki
 * seçeneği de KOŞULSUZ GÜVENLİ veya SÜREKLİ ÜSTÜN hale getirmemelidir."
 *
 * Bu modül o cümlenin iki yarısını da görünür kılar. Yalnız altının
 * değer kaybını göstermek, nakdi koşulsuz güvenli ilan etmek olurdu;
 * fırsat maliyeti de aynı ekranda, aynı ağırlıkta durur.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DEĞİŞMEZ (GDD 34.5): Buradaki hiçbir sayı GERÇEKLEŞMİŞ KÂRA yazılmaz.
 * Overnight sonucu bir POZİSYON RAPORUdur: altın hâlâ stoktadır, satılmamıştır.
 * Fırsat maliyeti ise hiç var olmamış bir paradır — muhasebeye girmesi
 * uydurma gelir yaratırdı.
 */

import { isBullion } from '@data/bullion';
import { MARKET_DAILY_CAP } from './balance';
import { isLastTradingDay, nextMarketOpenDay, weekdayLabel } from './calendar';
import type { GameDay, InventoryPosition, ItemInstance, MarketState, Money } from './types';

/** Gün kapanışında alınan pozisyon. */
export interface OvernightPosition {
  day: GameDay;
  /** Kasadaki nakit. */
  cash: Money;
  /** Metale bağlı değer (sarrafiye + işçilikli ürünün metal kısmı). */
  metalValue: Money;
  /** Metalin toplam pozisyona oranı: 0 = tamamen nakit, 1 = tamamen altın. */
  metalShare: number;
  /** Referans spot — ertesi günün karşılaştırma tabanı. */
  goldSpot: number;
}

/** Ertesi sabah pozisyonun ne yaptığı. */
export interface OvernightOutcome {
  position: OvernightPosition;
  /** Gecelik spot değişimi (oran). */
  spotChange: number;
  /**
   * §5 — ALTINDA KALMANIN sonucu. Pozitifse altın kazandırdı, negatifse
   * kaybettirdi. GERÇEKLEŞMEMİŞTİR: mal hâlâ stokta.
   */
  metalDelta: Money;
  /**
   * §5 — NAKİTTE KALMANIN sonucu: fiyat yükselirken elde tutulan nakdin
   * FIRSAT MALİYETİ. Bu para hiç var olmadı; kaybedilmiş bir kazançtır.
   */
  cashOpportunityCost: Money;
  /**
   * Bu açılışta kaç GÜNLÜK hareket birikmişti. Hafta içi 0; pazartesi 2
   * (cumartesi + pazar). Özetin "gece" mi "hafta sonu" mu dediğini belirler.
   */
  gapDays: number;
  /** Oyuncuya gösterilecek tarafsız özet — kesinlik dili YOK. */
  summary: string;
}

/**
 * Kapanış pozisyonunu ölçer.
 *
 * Metal değeri için stok maliyeti değil GÜNCEL değer kullanılır: pozisyon
 * riski bugünün fiyatına maruzdur, geçmişte ne ödendiğine değil.
 */
export function measurePosition(
  day: GameDay,
  cash: Money,
  inventory: InventoryPosition[],
  items: Record<string, ItemInstance>,
  market: MarketState,
): OvernightPosition {
  const metalValue = inventory.reduce((sum, position) => {
    const item = items[position.itemId];
    if (!item) return sum;
    // Sarrafiye tamamen metale bağlıdır; işçilikli üründe metal payı
    // kabaca değerin bir kısmıdır — işçilik ve taş spot'la hareket etmez.
    const exposure = isBullion(item.templateId) ? 1 : METAL_SHARE_CRAFTED;
    return sum + Math.round(position.currentValue * exposure);
  }, 0);

  const total = cash + metalValue;
  return {
    day,
    cash,
    metalValue,
    metalShare: total > 0 ? metalValue / total : 0,
    goldSpot: market.goldSpot,
  };
}

/**
 * Tutarı binlik ayraçla yazar.
 *
 * Bu cümleler ham sayı basıyordu: "29963 ₺'lik fırsatı kaçırdı". Oyunun her
 * yerinde para "29.963 ₺" biçiminde; tek istisna gün kapanışının en çok
 * okunan satırıydı. Biçimlendirme `@ui/format` içinde ama bu dosya domain
 * katmanında ve arayüzü import ETMEZ — bu yüzden aynı kural burada, iki
 * satırda.
 */
function money(n: number): string {
  return Math.round(n).toLocaleString('tr-TR');
}

/**
 * Pozisyonun gecelik sonucu.
 *
 * §5'in iki yarısı da hesaplanır ve İKİSİ DE döndürülür. Yalnız birini
 * göstermek, diğer seçeneği koşulsuz güvenli ilan etmek olurdu.
 */
export function resolveOvernight(
  position: OvernightPosition,
  nextMarket: MarketState,
): OvernightOutcome {
  const spotChange =
    position.goldSpot > 0 ? (nextMarket.goldSpot - position.goldSpot) / position.goldSpot : 0;

  // Altında kalmanın sonucu — her iki yönde de.
  // Sıfır normalize edilir: metal yokken düşen piyasada "−0 ₺" yazmak
  // olmayan bir kayıp göstermek olurdu.
  const metalDelta = normalizeZero(Math.round(position.metalValue * spotChange));

  // Nakitte kalmanın sonucu: yalnız fiyat YÜKSELDİĞİNDE bir maliyet vardır.
  // Fiyat düşerken nakit tutmak bir kazanç değil, kaçınılmış bir zarardır;
  // onu "kâr" gibi göstermek nakdi sürekli üstün gösterirdi.
  const cashOpportunityCost = spotChange > 0 ? Math.round(position.cash * spotChange) : 0;
  const gapDays = nextMarket.gapDays ?? 0;

  return {
    position,
    spotChange,
    metalDelta,
    cashOpportunityCost,
    gapDays,
    summary: describeOutcome(position, spotChange, metalDelta, cashOpportunityCost, gapDays),
  };
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

function describeOutcome(
  position: OvernightPosition,
  spotChange: number,
  metalDelta: Money,
  opportunityCost: Money,
  gapDays: number,
): string {
  /*
    HAFTA SONU BOŞLUĞU AYRI BİR CÜMLEDİR.

    Pazartesi açılışı "gece" değildir: üç günlük haber tek seferde
    fiyatlanır ve oyuncunun cuma günü verdiği kararın sonucudur. Aynı
    cümleyi kullanmak, oyuncuya haftanın en pahalı kararının sonucunu
    sıradan bir gece gibi okuturdu.
  */
  const gap = gapDays > 0;
  const when = gap ? 'Hafta sonu' : 'Gecelik';

  if (Math.abs(spotChange) < 0.0005) {
    return gap
      ? 'Piyasa hafta sonunu neredeyse yerinde açtı.'
      : 'Gecelik fiyat neredeyse yerinde kaldı.';
  }

  const pct = `%${Math.abs(spotChange * 100).toFixed(2).replace('.', ',')}`;
  const opened = gap
    ? `Piyasa hafta sonunu ${spotChange > 0 ? '+' : '−'}${pct} ile açtı; `
    : '';

  if (spotChange > 0) {
    return position.metalShare >= 0.5
      ? `${opened}${gap ? 'ağırlığı' : 'Fiyat yükseldi; ağırlığı'} altında taşımak işe yaradı — pozisyon ${money(Math.abs(metalDelta))} ₺ arttı.`
      : `${opened}${gap ? 'nakitte' : 'Fiyat yükseldi; nakitte'} kalan kısım ${money(Math.abs(opportunityCost))} ₺'lik fırsatı kaçırdı.`;
  }

  return position.metalShare >= 0.5
    ? `${opened}${gap ? 'altında' : 'Fiyat düştü; altında'} kalan pozisyon ${money(Math.abs(metalDelta))} ₺ geriledi.`
    : `${opened}${gap ? 'nakit' : 'Fiyat düştü; nakit'} ağırlığı ${when.toLowerCase()} zararı sınırladı.`;
}

// ---------------------------------------------------------------------------
// HAFTA SONU POZİSYON UYARISI (cuma kapanışı)
// ---------------------------------------------------------------------------

export interface WeekendRisk {
  /** Piyasanın kapalı kalacağı gün sayısı (cumartesi + pazar = 2). */
  closedDays: number;
  /** Piyasanın yeniden açılacağı gün. */
  reopensOnDay: GameDay;
  reopensOnLabel: string;
  /** Metale bağlı pozisyon — riskin taşındığı tutar. */
  metalValue: Money;
  /** En kötü/en iyi hâlde pozisyonun oynayabileceği tutar (bant tavanı). */
  worstCase: Money;
  /** Oyuncuya gösterilecek tek cümle — YÖN SÖYLEMEZ (§5.2). */
  note: string;
}

/**
 * §5.2 — "Sinyaller karar desteğidir; ertesi gün YÖNÜNÜ VEYA BÜYÜKLÜĞÜNÜ
 * GARANTİ ETMEZ." Bu yüzden burada da yön yoktur: yalnız kapalı gün sayısı,
 * taşınan tutar ve bandın izin verdiği EN BÜYÜK oynama söylenir.
 *
 * `worstCase` bir tahmin değil, bir TAVANDIR: market.ts hafta sonu bandını
 * √span ile büyütür (%3 × √3 ≈ %5,2) ve fiyat o bandın dışına çıkamaz.
 * Tahmin vermek, olmayan bir kesinlik göstermek olurdu.
 *
 * Cuma dışında `null` döner — uyarı ancak karar verilebilecek gün anlamlıdır.
 */
export function weekendRisk(day: GameDay, position: OvernightPosition): WeekendRisk | null {
  if (!isLastTradingDay(day)) return null;

  const reopensOnDay = nextMarketOpenDay(day);
  const closedDays = reopensOnDay - day - 1;
  const worstCase = Math.round(position.metalValue * MARKET_DAILY_CAP * Math.sqrt(closedDays + 1));

  return {
    closedDays,
    reopensOnDay,
    reopensOnLabel: weekdayLabel(reopensOnDay),
    metalValue: position.metalValue,
    worstCase,
    note:
      position.metalValue <= 0
        ? `Piyasa ${closedDays} gün kapalı. Nakitte olduğun için açılış boşluğu pozisyonunu taşımıyor; yükselirse fırsat maliyeti doğar.`
        : `Piyasa ${closedDays} gün kapalı; ${weekdayLabel(reopensOnDay)} birikmiş hareketle açılacak. Altında taşıdığın ${money(position.metalValue)} ₺ için açılış boşluğu ${money(worstCase)} ₺'ye kadar iki yöne de oynayabilir.`,
  };
}

// ---------------------------------------------------------------------------
// §5.2 — OYUNCUYA VERİLEN SİNYALLER
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high';

export interface MarketSignal {
  label: string;
  detail: string;
  level: RiskLevel;
}

/**
 * §5.2: "Oyuncuya rejim, volatilite, talep baskısı, olay riski ve kanal
 * koşulları hakkında OKUNABİLİR sinyaller verilir. Sinyaller karar
 * desteğidir; ertesi gün YÖNÜNÜ VEYA BÜYÜKLÜĞÜNÜ GARANTİ ETMEZ. Yanlış
 * kesinlik yaratacak 'kesin yükselecek/düşecek' dili KULLANILMAZ."
 *
 * Bu yüzden sinyaller yön değil KOŞUL bildirir. Hiçbiri "yükselecek"
 * demez; "hareket büyük olabilir" der. Fark, oyuncunun kararı kendi
 * vermesi ile sisteme uyması arasındaki farktır.
 */
export function marketSignals(
  market: MarketState,
  position: OvernightPosition | null,
): MarketSignal[] {
  const signals: MarketSignal[] = [];

  signals.push({
    label: 'Rejim',
    detail: REGIME_NOTE[market.regime],
    level: market.regime === 'shock' ? 'high' : market.regime === 'volatile' ? 'medium' : 'low',
  });

  const volLevel: RiskLevel =
    market.volatility >= 0.015 ? 'high' : market.volatility >= 0.008 ? 'medium' : 'low';
  signals.push({
    label: 'Oynaklık',
    detail:
      volLevel === 'high'
        ? 'Hareketin büyüklüğü bugün geniş bir bantta olabilir.'
        : volLevel === 'medium'
          ? 'Orta ölçekli hareket görülebilir.'
          : 'Hareketin dar kalması bekleniyor.',
    level: volLevel,
  });

  if (market.activeEvent) {
    signals.push({
      label: 'Olay',
      detail: `${market.activeEvent.label} · ${market.activeEvent.affects.join(', ')}`,
      level: 'medium',
    });
  }

  if (position) {
    // §5 — pozisyonun kendisi bir sinyaldir; ama hangisinin doğru olduğunu
    // söylemez, yalnız neye maruz kaldığını söyler.
    const share = Math.round(position.metalShare * 100);
    signals.push({
      label: 'Pozisyon',
      detail:
        share >= 65
          /*
            §10 — CÜMLE DÜZELTİLDİ.
            Eskiden "Varlığın %96'i altında" yazıyordu: hem ek yanlıştı
            ("%96'i" değil "%96'sı"), hem de "altında" burada METAL demek
            olduğu hâlde "%96'nın altında" gibi okunuyordu — yani tam tersi
            bir anlam. Belgede istenen biçim kullanılıyor.
          */
          ? `Servetinin %${share}'sı altına bağlı; fiyat düşüşüne açıksın.`
          : share <= 35
            ? `Varlığın %${100 - share}'i nakitte; yükselişte fırsat maliyeti taşırsınız.`
            : `Altın %${share} / nakit %${100 - share} — dengeli duruyorsunuz.`,
      level: share >= 80 || share <= 15 ? 'medium' : 'low',
    });
  }

  return signals;
}

const REGIME_NOTE: Record<MarketState['regime'], string> = {
  calm: 'Sakin koşullar; alış-satış farkı dar kalma eğiliminde.',
  normal: 'Olağan koşullar.',
  volatile: 'Oynak koşullar; alış-satış farkı açılabilir.',
  shock: 'Stres koşulları; kapasite daralır, alış-satış farkı açılır.',
};

/** İşçilikli üründe değerin metale bağlı kabul edilen payı. */
const METAL_SHARE_CRAFTED = 0.72;
