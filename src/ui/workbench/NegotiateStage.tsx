/**
 * İşlem Masası · PAZARLIK (GDD 23.7 "Pazarlık", 23.10.2)
 *
 * Kurallar:
 *  - Teklif tutarı ekranın en güçlü sayısal değeridir → Karar Dock'unda.
 *  - Teklif değiştikçe tahmini kâr/zarar, likidite ve ilişki etkisi güncellenir.
 *  - Müşteri mesajı ve state AYNI YÜZEYDE değişir.
 *  - Gerekçe/Jest/Paket gibi aksiyonlar ikincil ama görünürdür → Araç Rayı.
 *
 * GDD 23.24 DEĞİŞMEZ: "Karşı teklifte yeni modal/sayfa açma; müşteri mesajı ve
 * pazarlık state'i aynı yüzeyde güncellenir." Bu bileşen hiçbir koşulda yeni
 * ekran veya modal açmaz.
 */

import { TERM } from '@ui/terms';
import { CHANNEL_SHORT } from '@domain/thesis';
import { STATE_LABEL } from '@domain/negotiation';
import { CONFIDENCE_LABEL } from '@domain/valuation';
import { tl, tlBare, tlSigned, tonWord } from '@ui/format';
import type {
  ExitChannel,
  NegotiationSession,
  ThesisOption,
  ValuationBand,
} from '@domain/types';

const STATE_ORDER: NegotiationSession['state'][] = ['OPEN', 'HARDENING', 'FINAL_OFFER'];

interface Props {
  session: NegotiationSession;
  message: string;
  selectedThesis: ExitChannel | null;
  thesisOptions: ThesisOption[];
  band: ValuationBand | null;
  /** Kaç bilgi alanı doğrulandı — "ne biliyorum?" sorusunun ikinci yarısı. */
  verifiedFields: number;
  totalFields: number;
  /** Kabul edilirse likidite bu değere düşer. */
  liquidityAfter: string;
}

export function NegotiateStage({
  session,
  message,
  selectedThesis,
  thesisOptions,
  band,
  verifiedFields,
  totalFields,
  liquidityAfter,
}: Props) {
  const active = selectedThesis
    ? thesisOptions.find((o) => o.channel === selectedThesis)
    : thesisOptions[0];

  const isFinal = session.state === 'FINAL_OFFER';
  const counter = session.finalOffer ?? session.activeCounter;

  return (
    <div className="negotiate">
      <div className="negotiate__top">
        <p className="speech">“{message}”</p>
        <StateBadge state={session.state} />
      </div>

      {counter !== null && (
        <div className={`counterRow ${isFinal ? 'counterRow--final' : ''}`}>
          <span className="counterRow__label">
            {isFinal ? 'Son teklifi' : 'Karşı teklifi'}
          </span>
          <span className="counterRow__value num">{tl(counter)}</span>
        </div>
      )}

      {active && (
        <div className="contextRow">
          <span className="contextRow__key">Seçili tez</span>
          <span className="contextRow__val">{CHANNEL_SHORT[active.channel]}</span>
          <span className="contextRow__key">Alış tavanı</span>
          <span className="contextRow__val num">{tl(active.buyCeiling)}</span>
        </div>
      )}

      <div className="negotiate__spacer">
        {isFinal && counter !== null && active ? (
          /* GDD 23.12 Final Offer — "'Son teklif' etiketi + SONUÇ ÖNİZLEMESİ" */
          <div className="preview">
            <div className="preview__row">
              <span className="preview__key">Kabul edilirse ödenecek</span>
              <span className="preview__val num">{tl(counter)}</span>
            </div>
            <div className="preview__row">
              <span className="preview__key">Alış tavanına göre</span>
              <span
                className={`preview__val num preview__val--${
                  active.buyCeiling - counter >= 0 ? 'positive' : 'negative'
                }`}
              >
                {tlSigned(active.buyCeiling - counter)}{' '}
                {tonWord(active.buyCeiling - counter)}
              </span>
            </div>
            <div className="preview__row">
              <span className="preview__key">{TERM.liquidity}</span>
              <span className="preview__val preview__val--warning num">{liquidityAfter}</span>
            </div>
            <div className="preview__row">
              <span className="preview__key">Geri dönüş</span>
              <span className="preview__val preview__val--negative">Yok — kabul veya red</span>
            </div>
          </div>
        ) : (
          band && (
            /* "Ne biliyorum?" — oyuncu bandı görmek için geri dönmek zorunda kalmaz. */
            <div className="knownPanel">
              <span className="knownPanel__label">Tahmini değer aralığı</span>
              <span className="knownPanel__band num">
                {tlBare(band.min)} – {tlBare(band.max)} ₺
              </span>
              <span className="knownPanel__foot">
                <span>
                  Güven:{' '}
                  <strong className={`confidence__value--${band.confidence}`}>
                    {CONFIDENCE_LABEL[band.confidence]}
                  </strong>
                </span>
                <span className="num">
                  {verifiedFields}/{totalFields} alan doğrulandı
                </span>
              </span>
            </div>
          )
        )}
      </div>

      {session.offerHistory.length > 0 && (
        <div className="history">
          <span className="history__label">Teklifleriniz</span>
          {session.offerHistory.map((offer, i) => {
            const prev = session.offerHistory[i - 1];
            // Anti-spam görünür kanıtı: tekrar eden teklif işaretlenir (GDD 11.4).
            const isRepeat =
              prev !== undefined && Math.abs(offer - prev) / Math.max(1, prev) < 0.005;
            return (
              <span
                key={`${i}-${offer}`}
                className={`history__chip num ${isRepeat ? 'history__chip--repeat' : ''}`}
                title={isRepeat ? 'Aynı teklif tekrarlandı — yeni şans üretmez' : undefined}
              >
                {tlBare(offer)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Durum rozeti. GDD 11.1 durum makinesini görünür kılar; kapanış skoru
 * gösterilmez (GDD 11.3 — "matematiksel skor oyuncuya gösterilmez").
 */
function StateBadge({ state }: { state: NegotiationSession['state'] }) {
  const index = STATE_ORDER.indexOf(state);

  return (
    <div className="stateBadge">
      <span className="stateBadge__label">Pazarlık</span>
      <span className={`stateBadge__value stateBadge__value--${state}`}>
        {STATE_LABEL[state]}
      </span>
      <span className={`stateBadge__dots stateBadge__value--${state}`}>
        {STATE_ORDER.map((_, i) => (
          <span
            key={i}
            className={`stateBadge__dot ${i <= index ? 'stateBadge__dot--on' : ''}`}
          />
        ))}
      </span>
    </div>
  );
}
