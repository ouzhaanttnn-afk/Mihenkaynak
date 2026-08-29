/**
 * Profili Düzenle penceresi.
 *
 * KAPSAM: kuyumcunun adı ve portresi. Başka hiçbir şey. Avatarların
 * seviyesi, XP'si, özelliği veya karar etkisi yoktur (bkz. @domain/profile).
 *
 * TASLAK ÜZERİNDE ÇALIŞIR: pencere açıldığında mevcut profilin bir kopyası
 * alınır ve tüm düzenleme o kopyada yapılır. "İptal" hiçbir şey yazmaz,
 * çünkü yazılacak bir şey henüz oluşmamıştır — iptalde geri alma mantığı
 * kurmak yerine, kaydedene kadar hiç dokunmamak daha güvenli.
 *
 * ERİŞİLEBİLİRLİK:
 *  - role="dialog" + aria-modal, başlıkla ilişkilendirilmiş.
 *  - Escape kapatır, dış tıklama kapatır.
 *  - Açılışta odak ad alanına gider; Tab pencerede döner (odak tuzağı) —
 *    aksi halde klavye kullanıcısı arkadaki oyun ekranına düşerdi.
 *  - Avatar ızgarası bir radio grubudur: TEK tab durağı vardır ve seçim ok
 *    tuşlarıyla gezilir (roving tabindex).
 *
 *    BU KENDİLİĞİNDEN GELMİYOR — ölçerek öğrendim. Önce "ok tuşları
 *    tarayıcıdan gelir" diye yazmıştım; doğru değil. Yerel ok-tuşu davranışı
 *    yalnız gerçek `<input type="radio">` için vardır, `role="radio"` verilmiş
 *    bir `<button>` için değil. Üstelik 11 düğmenin hepsi ayrı birer tab
 *    durağıydı: klavye kullanıcısı "Kaydet"e ulaşmak için 11 kez Tab'a
 *    basmak zorundaydı. Tarayıcı testinde Kaydet'e hiç ulaşılamadı.
 */

import { useEffect, useId, useRef, useState } from 'react';

import {
  AVATAR_IDS,
  NAME_MAX,
  SHOP_SUFFIX,
  checkJewelerName,
  shopDisplayName,
  type PlayerProfile,
} from '@domain/profile';
import { useGame } from '@state/gameStore';
import { avatarArt } from '@ui/assets';
import { Art } from '@ui/Art';
import { summarizeWealth } from '@domain/settlement';
import { tlToHasGrams } from '@domain/channels';
import { hasGold, price, tl } from '@ui/format';
import { IconTrust } from '@ui/icons';

interface Props {
  profile: PlayerProfile;
  onCancel: () => void;
  /** @returns kaydedildiyse true; ad geçersizse false (pencere açık kalır). */
  onSave: (next: { jewelerName: string; avatarId: string }) => boolean;
}

export function ProfileDialog({ profile, onCancel, onSave }: Props) {
  const [name, setName] = useState(profile.jewelerName);
  const [avatarId, setAvatarId] = useState<string>(profile.avatarId);
  const [error, setError] = useState<string | null>(null);

  /*
    §4 — PENCERE AÇIKKEN OYUN ZAMANI DURUR.
    Sayaç montajda artar, sökümde azalır; nasıl kapatıldığı (Kaydet, İptal,
    Escape, dış tıklama) fark etmez, temizlik her yolda aynı yerden geçer.
  */
  const pushPause = useGame((st) => st.pushPause);
  const popPause = useGame((st) => st.popPause);
  useEffect(() => {
    pushPause();
    return popPause;
  }, [pushPause, popPause]);

  /*
    §4 — "Hata varsa Kaydet düğmesini pasif yap."
    Doğrulama tek kaynaktan (checkJewelerName) gelir; düğmenin pasifliği de
    hata metni de aynı sonucu okur, ikisi ayrışamaz.
  */
  const nameCheck = checkJewelerName(name);
  const canSave = nameCheck.ok;

  const titleId = useId();
  const nameId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  // Escape kapatır; Tab pencerenin içinde döner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      // `[tabindex="-1"]` olanlar hariç: roving tabindex ile ızgaranın
      // seçili olmayan 10 kartı Tab sırasında yoktur.
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    const check = checkJewelerName(name);
    if (!check.ok) {
      setError(check.error);
      nameRef.current?.focus();
      return;
    }
    // Ad ve avatar BİRLİKTE yazılır — yarısı kaydedilmiş bir profil olmaz.
    if (!onSave({ jewelerName: check.value, avatarId })) {
      setError('Profil kaydedilemedi.');
    }
  };

  return (
    <div
      className="profileScrim"
      onMouseDown={(e) => {
        // Yalnız zemine basıldığında kapanır: panelin içinde başlayan bir
        // sürükleme (metin seçimi) zeminde bitince pencere kapanmamalı.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="profileDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <h2 className="profileDialog__title" id={titleId}>
          Profili Düzenle
        </h2>

        <label className="profileDialog__label" htmlFor={nameId}>
          Dükkân Adı
        </label>
        <input
          id={nameId}
          ref={nameRef}
          className={`profileDialog__input ${error ? 'profileDialog__input--error' : ''}`}
          value={name}
          /*
            maxLength, doğrulamanın YERİNE değil YANINDA: aşırı uzun metnin
            arayüzü bozmasını daha yazılırken engeller. Sınırın kendisi yine
            checkJewelerName'de — tek doğruluk kaynağı orası.
          */
          /*
            UPDATEv3 §2 — maxLength EKİ SAYMAZ.
            Sınır TEMEL isme aittir (24). Oyuncu örnekteki gibi
            "Alvera Kuyumculuk" yazabilsin diye yazma sınırı ekin uzunluğu
            kadar genişletildi; kaydedilen değer yine `checkJewelerName`in
            kırptığı temel isimdir ve 24 karakteri aşamaz.
          */
          maxLength={NAME_MAX + SHOP_SUFFIX.length + 1}
          placeholder={`İsim koyunuz — örn. Alvera ${SHOP_SUFFIX}`}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!canSave || error ? true : undefined}
          aria-describedby={!canSave || error ? errorId : undefined}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        {/*
          Hata metni iki kaynaktan gelebilir: oyuncu Kaydet'e bastığında
          (`error`) ya da alan zaten geçersizken canlı olarak. İkincisi
          olmadan pasif düğmenin NEDENİ görünmezdi — §4 ve §12 ikisini de
          istiyor.
        */}
        {(error ?? (!canSave && name.length > 0 ? nameCheck.ok ? null : nameCheck.error : null)) && (
          <p className="profileDialog__error" id={errorId} role="alert">
            {error ?? (nameCheck.ok ? '' : nameCheck.error)}
          </p>
        )}

        {/*
          §2 — "Kuyumculuk" ekini SİSTEM ekliyor. Oyuncu bunu yazarken
          görmezse eki kendisi yazar ve sonra neden kırpıldığını anlamaz;
          önizleme kuralı açıklamanın en kısa yolu.
        */}
        {nameCheck.ok && (
          <p className="profileDialog__preview">
            Ekranda: <strong>{shopDisplayName(nameCheck.value)}</strong>
          </p>
        )}

        <CapitalInHas />

        <span className="profileDialog__label">Karakter</span>
        <div
          className="avatarGrid"
          role="radiogroup"
          aria-label="Kuyumcu portresi"
          ref={gridRef}
          onKeyDown={(e) => {
            const step =
              e.key === 'ArrowRight' || e.key === 'ArrowDown'
                ? 1
                : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                  ? -1
                  : 0;
            let target: number | null = null;
            if (step !== 0) {
              const at = AVATAR_IDS.indexOf(avatarId as (typeof AVATAR_IDS)[number]);
              // Uçlarda sarar: son karttan sağa basınca başa döner.
              target = (at + step + AVATAR_IDS.length) % AVATAR_IDS.length;
            } else if (e.key === 'Home') target = 0;
            else if (e.key === 'End') target = AVATAR_IDS.length - 1;
            if (target === null) return;

            e.preventDefault();
            setAvatarId(AVATAR_IDS[target]!);
            // Odak seçimi TAKİP EDER; aksi halde ekran okuyucu nerede
            // olduğunu, gören kullanıcı da odak halkasını kaybederdi.
            gridRef.current
              ?.querySelectorAll<HTMLElement>('.avatarCard')
              [target]?.focus();
          }}
        >
          {AVATAR_IDS.map((id) => {
            const selected = id === avatarId;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                /*
                  ROVING TABINDEX: gruba tek bir tab durağı düşer — seçili
                  olan. Diğerleri Tab sırasından çıkar ama ok tuşlarıyla
                  hâlâ erişilebilir.
                */
                tabIndex={selected ? 0 : -1}
                aria-label={`Karakter ${id.replace('male-', '')}`}
                className={`avatarCard ${selected ? 'avatarCard--selected' : ''}`}
                onClick={() => setAvatarId(id)}
              >
                <Art
                  art={avatarArt(id)}
                  size={72}
                  decorative
                  className="avatarCard__img"
                  fallback={<IconTrust size={26} />}
                />
                {selected && (
                  <span className="avatarCard__check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="profileDialog__actions">
          <button type="button" className="profileDialog__cancel" onClick={onCancel}>
            İptal
          </button>
          <button
            type="button"
            className="profileDialog__save"
            onClick={submit}
            disabled={!canSave}
            /* §12 — pasif düğmenin nedeni ERİŞİLEBİLİR ADDA da bulunmalı. */
            aria-label={
              canSave
                ? 'Değişiklikleri kaydet'
                : `Değişiklikleri kaydet — ${nameCheck.ok ? '' : nameCheck.error}`
            }
            title={canSave ? undefined : nameCheck.ok ? undefined : nameCheck.error}
          >
            Değişiklikleri Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SERMAYENİN HAS ALTIN KARŞILIĞI.
 *
 * Kuyumcu serveti TL ile ölçmez; "kaç kilo altınım var" diye ölçer. Enflasyon
 * altında TL rakamı sürekli büyüdüğü için oyuncunun gerçekten ilerleyip
 * ilerlemediğini TL söylemez — altın söyler.
 *
 * SALT GÖSTERİM: burada hiçbir şey çevrilmez, satılmaz, kaydedilmez. Nakit
 * nakit kalır; bu satır yalnız "bugünkü kurla bu sermaye kaç gram HAS eder"
 * sorusunun cevabıdır ve her fiyat adımında kendiliğinden güncellenir.
 *
 * SERMAYE = NET SERVET: nakit + stoğun bugünkü değeri − yükümlülükler.
 * Yalnız nakdi saymak, malını altına çevirmiş oyuncuyu fakir gösterirdi;
 * borcu saymamak da olduğundan zengin.
 */
function CapitalInHas() {
  const store = useGame((st) => st.store);
  const inventory = useGame((st) => st.inventory);
  const items = useGame((st) => st.items);
  const ledger = useGame((st) => st.ledger);
  const goldSpot = useGame((st) => st.market.goldSpot);

  const wealth = summarizeWealth({ store, inventory, items, ledger });
  const gramsOfHas = tlToHasGrams(wealth.netWorth, goldSpot);

  return (
    <div className="profileDialog__capital">
      <span className="profileDialog__capitalLabel">Sermaye</span>
      <span className="profileDialog__capitalValue num">{hasGold(gramsOfHas)}</span>
      <span className="profileDialog__capitalNote">
        {tl(wealth.netWorth)} · bugünkü HAS karşılığı ({price(goldSpot)} ₺/g)
      </span>
    </div>
  );
}
