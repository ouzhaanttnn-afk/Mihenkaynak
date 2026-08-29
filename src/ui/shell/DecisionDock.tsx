/**
 * G — Karar Dock'u (GDD 23.12, 128 px)
 *
 * GDD 23.12: "Karar Dock'u ana oyunun başparmak bölgesidir. Ana CTA her
 * aşamada aynı fiziksel bölgede kalır; yalnız etiketi ve çevresindeki karar
 * özeti değişir. Böylece oyuncu 'şimdi ne yapacağım?' sorusunun cevabını
 * ekranda aramaz."
 *
 * GDD 23.9.2: "Tahmini etki + ana CTA + en fazla 2 ikincil eylem."
 * GDD 23.12: "Tahmini sonuçlar kesinlik iddiası taşımaz."
 */

import type { ReactNode } from 'react';
import { IconChevronRight } from '@ui/icons';

export interface DockAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  /**
   * UPDATEv1 §6/§12 — DÜĞME NEDEN PASİF?
   *
   * Metin hem ERİŞİLEBİLİR ADA hem `title`a girer. Pasif bir düğmenin
   * nedenini yalnız ekranda göstermek yetmez: ekran okuyucu kullanan
   * oyuncu düğmeye odaklandığında "Teklifi Gönder, devre dışı" duyar ve
   * NİÇİN olduğunu hiç öğrenemezdi.
   */
  disabledReason?: string;
}

interface Props {
  /** Üst özet satırı — "bu karar kabul edilirse ne değişecek?" */
  summaryLabel: string;
  summaryValue: ReactNode;
  /** Pazarlıkta teklif tutarı gibi baskın içerik buraya girer. */
  children?: ReactNode;
  primary: DockAction;
  /** En fazla 2 (GDD 23.9.2). */
  secondary?: DockAction[];
}

export function DecisionDock({ summaryLabel, summaryValue, children, primary, secondary = [] }: Props) {
  // GDD 23.9.2 sözleşmesi: en fazla 2 ikincil eylem.
  const actions = secondary.slice(0, 2);

  return (
    <footer className="dock">
      <div className="dock__summary">
        <span className="dock__summaryLabel">{summaryLabel}</span>
        <span className="dock__summaryValue">{summaryValue}</span>
      </div>

      {children}

      <div className="dock__actions">
        <button
          type="button"
          className="cta"
          onClick={primary.onPress}
          disabled={primary.disabled}
          aria-label={
            primary.disabled && primary.disabledReason
              ? `${primary.label} — ${primary.disabledReason}`
              : undefined
          }
          title={primary.disabled ? primary.disabledReason : undefined}
        >
          {primary.icon}
          {primary.label}
          {!primary.icon && <IconChevronRight size={18} />}
        </button>

        {actions.length === 1 && actions[0] && (
          <SecondaryButton action={actions[0]} />
        )}
      </div>

      {actions.length === 2 && (
        <div className="dock__secondaryRow">
          {actions.map((action) => (
            <SecondaryButton key={action.label} action={action} />
          ))}
        </div>
      )}
    </footer>
  );
}

function SecondaryButton({ action }: { action: DockAction }) {
  return (
    <button
      type="button"
      className={`secondary ${action.danger ? 'secondary--danger' : ''}`}
      onClick={action.onPress}
      disabled={action.disabled}
      aria-label={
        action.disabled && action.disabledReason
          ? `${action.label} — ${action.disabledReason}`
          : undefined
      }
      title={action.disabled ? action.disabledReason : undefined}
    >
      {action.icon}
      {action.label}
    </button>
  );
}
