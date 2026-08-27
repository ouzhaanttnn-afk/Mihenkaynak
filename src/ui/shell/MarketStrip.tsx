/**
 * B — Piyasa Şeridi (GDD 23.9.2, 44 px)
 * "3–5 varlık; yatay swipe. Dokununca Piyasa ekranı açılır."
 *
 * GDD 23.9.1: "Piyasa, ana Dükkan ekranındaki piyasa şeridine dokunularak
 * açılır; ayrı alt-nav öğesi değildir."
 * GDD 23.8: "Piyasa sayısını müşteri işleminin önüne geçirme" → şerit ince
 * kalır ve tipografik ağırlığı Karar Dock'unun altındadır.
 */

import { MARKET_REGIME } from '@domain/balance';
import { pctChange, price } from '@ui/format';
import type { MarketState } from '@domain/types';

interface Props {
  market: MarketState;
  onOpenMarket: () => void;
}

export function MarketStrip({ market, onOpenMarket }: Props) {
  const regime = MARKET_REGIME[market.regime];

  return (
    <button
      type="button"
      className="marketStrip"
      onClick={onOpenMarket}
      aria-label="Piyasa ekranını aç"
    >
      <div className="marketStrip__regime">
        <span className="marketStrip__regimeLabel">Rejim</span>
        <span className="marketStrip__regimeValue">
          {regime.label}
          {market.activeEvent ? ' •' : ''}
        </span>
      </div>

      {market.assets.slice(0, 4).map((asset) => (
        <div key={asset.id} className="marketStrip__asset">
          <span className="marketStrip__label">{asset.label}</span>
          <span className="marketStrip__row">
            <span className="marketStrip__price num">{price(asset.price)}</span>
            <span className={`marketStrip__change num ${changeClass(asset.changePct)}`}>
              {pctChange(asset.changePct)}
            </span>
          </span>
        </div>
      ))}
    </button>
  );
}

function changeClass(pct: number): string {
  if (pct > 0.005) return 'marketStrip__change--up';
  if (pct < -0.005) return 'marketStrip__change--down';
  return 'marketStrip__change--flat';
}
