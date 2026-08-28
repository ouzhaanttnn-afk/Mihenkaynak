/**
 * B — Piyasa Şeridi (GDD 23.9.2, 44 px)
 * "3–5 varlık; yatay swipe. Dokununca Piyasa ekranı açılır."
 *
 * GDD 23.9.1: "Piyasa, ana Dükkan ekranındaki piyasa şeridine dokunularak
 * açılır; ayrı alt-nav öğesi değildir."
 * GDD 23.8: "Piyasa sayısını müşteri işleminin önüne geçirme" → şerit ince
 * kalır ve tipografik ağırlığı Karar Dock'unun altındadır.
 */

import { TERM } from '@ui/terms';
import { MARKET_REGIME } from '@domain/balance';
import { pctChange, price } from '@ui/format';
import type { MarketState } from '@domain/types';

interface Props {
  market: MarketState;
  onOpenMarket: () => void;
}

export function MarketStrip({ market, onOpenMarket }: Props) {
  const regime = MARKET_REGIME[market.regime];

  /*
   * ŞERİT TEK BİR <button> DEĞİLDİR.
   *
   * Öyleydi ve 23.9.2'nin "yatay swipe" sözü fiilen çalışmıyordu: tarayıcı
   * bir butonun içindeki yatay kaydırmayı tıklamayla karıştırıyor, üstelik
   * kaydırılabilir olduğuna dair hiçbir işaret bulunmuyordu. Sonuç: 360–430
   * px'lik telefonlarda dört varlığın YALNIZ İKİSİ görünüyordu (ölçüm:
   * Gümüş right=455, Dolar right=564). Yani veri ekranda değildi.
   *
   * Şimdi kapsayıcı gerçek bir kaydırma alanı, her varlık ayrı bir buton:
   * swipe kaydırır, dokunuş Piyasa ekranını açar (23.9.1).
   */
  return (
    <div
      className="marketStrip"
      role="group"
      aria-label="Piyasa şeridi — kaydırarak tüm varlıkları görün"
    >
      <button
        type="button"
        className="marketStrip__regime"
        onClick={onOpenMarket}
        aria-label="Piyasa ekranını aç"
      >
        <span className="marketStrip__regimeLabel">{TERM.regime}</span>
        <span className="marketStrip__regimeValue">
          {regime.label}
          {market.activeEvent ? ' •' : ''}
        </span>
      </button>

      {market.assets.slice(0, 4).map((asset) => (
        <button
          key={asset.id}
          type="button"
          className="marketStrip__asset"
          onClick={onOpenMarket}
          aria-label={`${asset.label} ${price(asset.price)} — piyasa ekranını aç`}
        >
          <span className="marketStrip__label">{asset.label}</span>
          <span className="marketStrip__row">
            <span className="marketStrip__price num">{price(asset.price)}</span>
            <span className={`marketStrip__change num ${changeClass(asset.changePct)}`}>
              {pctChange(asset.changePct)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function changeClass(pct: number): string {
  if (pct > 0.005) return 'marketStrip__change--up';
  if (pct < -0.005) return 'marketStrip__change--down';
  return 'marketStrip__change--flat';
}
