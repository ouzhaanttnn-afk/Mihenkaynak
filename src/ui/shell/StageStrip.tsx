/**
 * D — Aşama Şeridi (GDD 23.9.2, 32 px)
 * "İncele / Değerle / Tez / Pazarlık. Bağlama göre adım atlanabilir."
 *
 * GDD 23.10.3 kuralları:
 *  - Aşama Şeridi ileri doğru yalnız gerekli minimum koşullar sağlandığında
 *    ilerler. Kilitli adım tıklanamaz.
 *  - Oyuncu önceki aşamaya dönüp bilgiyi inceleyebilir; geri dönmek hidden
 *    truth, test sonucu veya rezervasyon fiyatını yeniden üretmez.
 *
 * GDD 23.24: "İncele/Değerle/Tez/Pazarlık için ayrı tam ekran sayfalar açma;
 * aynı Workbench state değiştirir." Bu bileşen yalnız state değiştirir.
 */

import type { WorkbenchStage } from '@domain/types';

const STEPS: { stage: WorkbenchStage; label: string }[] = [
  { stage: 'inspect', label: 'İncele' },
  { stage: 'appraise', label: 'Değerle' },
  { stage: 'thesis', label: 'Tez' },
  { stage: 'negotiate', label: 'Pazarlık' },
];

const ORDER: WorkbenchStage[] = ['inspect', 'appraise', 'thesis', 'negotiate', 'result'];

interface Props {
  current: WorkbenchStage;
  canEnter: (stage: WorkbenchStage) => boolean;
  onSelect: (stage: WorkbenchStage) => void;
}

export function StageStrip({ current, canEnter, onSelect }: Props) {
  const currentIndex = ORDER.indexOf(current);

  return (
    <nav className="stageStrip" aria-label="İşlem aşaması">
      {STEPS.map((step, i) => {
        const index = ORDER.indexOf(step.stage);
        const isActive = step.stage === current;
        const isDone = index < currentIndex;
        const unlocked = canEnter(step.stage);

        const state = isActive ? 'active' : isDone ? 'done' : unlocked ? '' : 'locked';

        return (
          <button
            key={step.stage}
            type="button"
            className={`stageStrip__step ${state ? `stageStrip__step--${state}` : ''}`}
            onClick={() => unlocked && onSelect(step.stage)}
            disabled={!unlocked}
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="stageStrip__num">{i + 1}</span>
            {step.label}
          </button>
        );
      })}
    </nav>
  );
}
