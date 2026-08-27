/**
 * C — Müşteri / Kuyruk Şeridi (GDD 23.9.2, 50 px)
 * "Aktif müşteride kimlik/niyet/sabır; boş durumda kuyruk/çağrı."
 *
 * GDD 23.10.1: Müşteri yokken şerit "Bekleyen: N" veya "Yeni müşteri
 * bekleniyor" durumuna geçer — ekran boş bir dashboard'a dönüşmez.
 * GDD 11.3: Sabır sayısal skor olarak gösterilmez; nokta dizisiyle okunur.
 */

import { getArchetype } from '@data/archetypes';
import { IconQueue } from '@ui/icons';
import type { Customer } from '@domain/types';

interface Props {
  customer: Customer | null;
  queueLength: number;
  lineCount: number;
}

const INTENT_TEXT: Record<Customer['intent'], string> = {
  sell: 'Ürün satmak / bozdurmak istiyor',
  buy: 'Dükkandan ürün almak istiyor',
  service: 'Servis / tamir istiyor',
  appraisal: 'Ekspertiz danışıyor',
};

export function CustomerStrip({ customer, queueLength, lineCount }: Props) {
  if (!customer) {
    return (
      <div className="customerStrip">
        <span className="customerStrip__avatar">
          <IconQueue size={18} />
        </span>
        <div className="customerStrip__main">
          <div className="customerStrip__name">
            {queueLength > 0 ? `Bekleyen: ${queueLength} müşteri` : 'Yeni müşteri bekleniyor'}
          </div>
          <div className="customerStrip__intent">
            {queueLength > 0 ? 'Karşılamak için hazır' : 'Kapı açık — gün akıyor'}
          </div>
        </div>
      </div>
    );
  }

  const archetype = getArchetype(customer.archetype);
  const initial = customer.displayName.charAt(0);

  return (
    <div className="customerStrip">
      <span className="customerStrip__avatar" aria-hidden="true">
        {initial}
      </span>

      <div className="customerStrip__main">
        <div className="customerStrip__name">
          {customer.displayName}
          {lineCount > 1 && (
            <span style={{ color: 'var(--brass-600)', fontWeight: 500 }}> · {lineCount} ürün</span>
          )}
        </div>
        <div className="customerStrip__intent">{INTENT_TEXT[customer.intent]}</div>
      </div>

      <div className="customerStrip__meta">
        <div className="customerStrip__demeanor">{archetype.demeanor}</div>
        <PatienceDots value={customer.patience} max={customer.patienceMax} />
      </div>
    </div>
  );
}

/**
 * Sabır göstergesi. GDD 11.3 — "matematiksel skor oyuncuya gösterilmez".
 * Beş nokta; renk düşük sabırda uyarıya döner.
 */
function PatienceDots({ value, max }: { value: number; max: number }) {
  const ratio = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const filled = Math.ceil(ratio * 5);
  const tone = ratio <= 0.2 ? 'critical' : ratio <= 0.45 ? 'low' : 'on';

  return (
    <div className="patience" aria-label={`Sabır: ${filled}/5`} title="Müşteri sabrı">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`patience__dot ${i < filled ? `patience__dot--${tone}` : ''}`}
        />
      ))}
    </div>
  );
}
