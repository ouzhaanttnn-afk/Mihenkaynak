/**
 * A — Durum Şeridi (GDD 23.9.2, 52 px)
 * "Seviye/XP, Gün-Saat, Nakit + kompakt 1x/2x/4x hız kontrolü."
 *
 * GDD 23.6: "Kompakt; ekranı domine etmez. 4x rewarded state ayrı kart açmaz."
 */

import { SPEED_STEPS, type SpeedStep } from '@domain/balance';
import { BrandMark, IconLock, IconVideo } from '@ui/icons';
import { clock, tlBare } from '@ui/format';
import type { MarketState, StoreState } from '@domain/types';

interface Props {
  store: StoreState;
  market: MarketState;
  speed: SpeedStep;
  speed4xUnlocked: boolean;
  onSpeed: (s: SpeedStep) => void;
  onUnlock4x: () => void;
}

export function StatusStrip({ store, market, speed, speed4xUnlocked, onSpeed, onUnlock4x }: Props) {
  const xpRatio = Math.min(1, store.xp / Math.max(1, store.xpToNext));

  return (
    <header className="statusStrip">
      <span className="statusStrip__brand">
        <BrandMark size={24} />
      </span>

      <div className="statusStrip__level">
        <div className="statusStrip__levelRow">
          <span className="statusStrip__levelNum">Sv {store.level}</span>
          <span className="statusStrip__xp num">
            {store.xp}/{store.xpToNext}
          </span>
        </div>
        <div className="statusStrip__xpBar">
          <div className="statusStrip__xpFill" style={{ width: `${xpRatio * 100}%` }} />
        </div>
      </div>

      <div className="statusStrip__clock">
        <div className="statusStrip__day">Gün {market.day}</div>
        <div className="statusStrip__time num">{clock(market.clockMinutes)}</div>
      </div>

      <div className="statusStrip__cash">
        <div className="statusStrip__cashLabel">Nakit</div>
        <div className="statusStrip__cashValue num">{tlBare(store.cash)} ₺</div>
      </div>

      <SpeedControl
        speed={speed}
        unlocked={speed4xUnlocked}
        onSpeed={onSpeed}
        onUnlock={onUnlock4x}
      />
    </header>
  );
}

/**
 * GDD 26.2 — "1x/2x temel erişimdir; 4x isteğe bağlı rewarded video ile
 * geçici açılır." Rewarded CTA'da oyun içi fayda adı kullanılır ve video
 * gerekliliği küçük bir simgeyle belirtilir.
 */
function SpeedControl({
  speed,
  unlocked,
  onSpeed,
  onUnlock,
}: {
  speed: SpeedStep;
  unlocked: boolean;
  onSpeed: (s: SpeedStep) => void;
  onUnlock: () => void;
}) {
  return (
    <div className="speed" role="group" aria-label="Oyun hızı">
      {SPEED_STEPS.map((step) => {
        const isLocked = step === 4 && !unlocked;
        const isActive = speed === step;

        return (
          <button
            key={step}
            type="button"
            className={[
              'speed__step',
              isActive ? 'speed__step--active' : '',
              isLocked ? 'speed__step--locked' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => (isLocked ? onUnlock() : onSpeed(step))}
            aria-pressed={isActive}
            aria-label={isLocked ? `${step}x hızı aç — video izle` : `${step}x hız`}
            title={isLocked ? `${step}x Hızı Aç · video` : `${step}x hız`}
          >
            {step}x
            {isLocked && (unlocked ? <IconLock size={9} /> : <IconVideo size={10} />)}
          </button>
        );
      })}
    </div>
  );
}
