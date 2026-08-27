/**
 * Teklif kontrolü — Karar Dock'u içinde yaşar (GDD 23.12)
 *
 * Kurallar:
 *  - "Teklif tutarı pazarlıkta Dock'un EN BÜYÜK sayısal değeri olur; kasa ve
 *    piyasa rakamı onu görsel olarak geçmez."
 *  - "Slider kaba ayar sağlar; +/− küçük kontroller ince ayar açar."
 *  - "Tahmini sonuçlar kesinlik iddiası taşımaz: 'Tahmini +1.850 TL',
 *    'Likidite %19 → %12', 'İlişki: riskli' gibi etiketlenir."
 *
 * GDD 23.12 — sayısal giriş sheet'i sistem klavyesinin ana ekranı yukarı
 * itmemesi için ayrı bir katmandır; bu sürümde slider + ince ayar yeterlidir
 * ve klavye hiç açılmaz.
 */

import { tlBare, pct } from '@ui/format';
import type { Money } from '@domain/types';

export interface OfferImpact {
  label: string;
  value: string;
  tone: 'positive' | 'negative' | 'neutral' | 'warning';
}

interface Props {
  value: Money;
  min: Money;
  max: Money;
  step: Money;
  onChange: (value: Money) => void;
  impacts: OfferImpact[];
  disabled?: boolean;
}

export function OfferControl({ value, min, max, step, onChange, impacts, disabled }: Props) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));

  return (
    <div className="offer">
      <div className="offer__row">
        <button
          type="button"
          className="offer__nudge"
          onClick={() => onChange(clamp(value - step))}
          disabled={disabled || value <= min}
          aria-label="Teklifi azalt"
        >
          −
        </button>

        <span className="offer__amount num">
          {tlBare(value)}
          <span className="offer__currency">₺</span>
        </span>

        <button
          type="button"
          className="offer__nudge"
          onClick={() => onChange(clamp(value + step))}
          disabled={disabled || value >= max}
          aria-label="Teklifi artır"
        >
          +
        </button>
      </div>

      <input
        type="range"
        className="offer__slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        disabled={disabled}
        aria-label="Teklif tutarı"
      />

      {impacts.length > 0 && (
        <div className="impacts">
          {impacts.map((impact) => (
            <span key={impact.label} className="impact">
              <span className="impact__label">{impact.label}</span>
              <span className={`impact__value impact__value--${impact.tone} num`}>
                {impact.value}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Likidite etkisi etiketi: "%19 → %12" (GDD 23.12 örneği). */
export function liquidityImpact(before: number, after: number): OfferImpact {
  const drop = before - after;
  return {
    label: 'Likidite',
    value: `${pct(before)} → ${pct(after)}`,
    tone: after < 0.15 ? 'negative' : drop > 0.12 ? 'warning' : 'neutral',
  };
}
