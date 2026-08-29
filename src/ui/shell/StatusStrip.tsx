/**
 * A — Durum Şeridi (GDD 23.9.2, 52 px)
 * "Seviye/XP, Gün-Saat, Nakit + kompakt 1x/2x/4x hız kontrolü."
 *
 * GDD 23.6: "Kompakt; ekranı domine etmez. 4x rewarded state ayrı kart açmaz."
 */

import { SPEED_STEPS, type SpeedStep } from '@domain/balance';
import { IconLock, IconPencil, IconVideo, BrandMark } from '@ui/icons';
import { Art } from '@ui/Art';
import { avatarArt } from '@ui/assets';
import { clock, tlBare } from '@ui/format';
import type { PlayerProfile } from '@domain/profile';
import type { MarketState, StoreState } from '@domain/types';

interface Props {
  store: StoreState;
  market: MarketState;
  speed: SpeedStep;
  speed4xUnlocked: boolean;
  onSpeed: (s: SpeedStep) => void;
  onUnlock4x: () => void;
  /** Kuyumcunun adı ve portresi — yalnız görünüm. */
  profile: PlayerProfile;
  onEditProfile: () => void;
}

export function StatusStrip({
  store,
  market,
  speed,
  speed4xUnlocked,
  onSpeed,
  onUnlock4x,
  profile,
  onEditProfile,
}: Props) {
  const xpRatio = Math.min(1, store.xp / Math.max(1, store.xpToNext));

  return (
    <header className="statusStrip">
      {/*
        PROFİL ALANI — avatar + kuyumcu adı + düzenleme kalemi, tek düğme.

        NEDEN AD SEVİYE SATIRININ ÜSTÜNE İSTİFLENDİ:
        Şerit 52 px ve 360 px genişlikte ÖLÇÜLDÜĞÜNDE tam doluydu — artan
        yer 0 px. Adı yeni bir sütun olarak eklemek, tek esneyen blok olan
        saati 37 px'in altına iterdi ve "Gün 1" iki satıra kırılırdı (bu
        kırılma daha önce yaşandı ve geri alındı).

        Bu yüzden ad, marka işaretinin yerine geçen avatarın YANINDA ama
        seviye satırının ÜSTÜNDE duruyor: zaten var olan bloğun genişliğini
        paylaşıyor, yeni genişlik istemiyor. Kazanılan 16 px de şerit
        boşluğunun 12→8 px inmesinden geliyor. Saat 37 px'te kalır.

        Marka işareti şeritten çıktı: 24 px'lik o alan artık oyuncunun
        kimliğini taşıyor ve markanın kendisi zaten açılış ekranında var.
      */}
      <button
        type="button"
        className="profileChip"
        onClick={onEditProfile}
        aria-label={`Profili düzenle — ${profile.jewelerName}`}
      >
        <span className="profileChip__avatar">
          <Art
            art={avatarArt(profile.avatarId)}
            size={34}
            decorative
            className="profileChip__img"
            fallback={<BrandMark size={20} />}
          />
          <span className="profileChip__pencil" aria-hidden="true">
            <IconPencil size={9} />
          </span>
        </span>

        <span className="profileChip__text">
          <span className="profileChip__name">{profile.jewelerName}</span>
          <span className="statusStrip__levelRow">
            <span className="statusStrip__levelNum">Sv {store.level}</span>
            {/*
              UPDATEv2 §12/§7 — XP KESRİ YERİNE YÜZDE.
              "0/580" 52 px'lik şeritte 34 px istiyordu ve hız kontrolü
              132 px'e çıkınca "0/…" diye kırpılıyordu — kırpılmış bir kesir
              hiçbir şey söylemez. Yüzde aynı bilgiyi 16 px'te veriyor;
              ham sayılar Kariyer / Yetenekler rotasında tam hâliyle duruyor.
            */}
            <span className="statusStrip__xp num">%{Math.round(xpRatio * 100)}</span>
          </span>
          <span className="statusStrip__xpBar">
            <span className="statusStrip__xpFill" style={{ width: `${xpRatio * 100}%` }} />
          </span>
        </span>
      </button>

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
