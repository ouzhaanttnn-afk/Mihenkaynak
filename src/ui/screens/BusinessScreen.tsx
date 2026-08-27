/**
 * İŞLETME ekranı (GDD 23.19) + Piyasa ikincil rotası (GDD 23.16)
 *
 * GDD 23.19: "İşletme ekranı ana yönetim merkezi ve ikincil rotaların
 * başlangıcıdır. BÜYÜK KARTLAR YERİNE kısa özet satırları ve menü grupları
 * kullanılır." · "Ana Dükkan ekranındaki kasa/itibar bilgisini dev kartlarla
 * tekrar etmez; özet + detay rotası verir."
 *
 * GDD 23.9.1: Piyasa, Toptancı Hesabı, Kariyer ve İşlem Defteri buradan ve
 * piyasa şeridinden açılan ikincil rotalardır — alt navigasyona eklenmez.
 */

import { useState } from 'react';

import { MARKET_REGIME } from '@domain/balance';
import {
  LIQUIDITY_BAND_LABEL,
  channelMetrics,
  liquidityBand,
  liquidityRatio,
  summarizeWealth,
  volumeSplitMetrics,
  type Ledger,
} from '@domain/settlement';
import { CHANNEL_LABEL_TR } from '@domain/channels';
import type { TradeChannel } from '@domain/types';
import { useGame } from '@state/gameStore';

import {
  IconBusiness,
  IconCash,
  IconChevronRight,
  IconLiquidity,
  IconReason,
  IconTrust,
  IconWholesale,
} from '@ui/icons';
import { pct, pctChange, price, tl, tlSigned } from '@ui/format';

type Route = 'root' | 'market' | 'journal';

export function BusinessScreen() {
  const [route, setRoute] = useState<Route>('root');

  if (route === 'market') return <MarketRoute onBack={() => setRoute('root')} />;
  if (route === 'journal') return <JournalRoute onBack={() => setRoute('root')} />;
  return <BusinessRoot onOpen={setRoute} />;
}

// ---------------------------------------------------------------------------

function BusinessRoot({ onOpen }: { onOpen: (r: Route) => void }) {
  const s = useGame();
  const wealth = summarizeWealth({
    store: s.store,
    inventory: s.inventory,
    items: s.items,
    ledger: s.ledger,
  });
  const ratio = liquidityRatio(s.store.cash, s.inventory);
  const band = liquidityBand(ratio);

  return (
    <div className="page">
      <header className="pageHead">
        <h1 className="pageHead__title">İşletme</h1>
        <p className="pageHead__sub">
          {s.store.name} · Kademe {s.store.storeTier} · Seviye {s.store.level}
        </p>
      </header>

      <div className="page__scroll">
        {/* Finans — kısa özet satırları, dev kart değil (GDD 23.19) */}
        <div className="group">
          <h2 className="group__title">Finans</h2>
          <div className="group__body">
            <StatLine label="Nakit" value={tl(wealth.cash)} icon={<IconCash size={15} />} />
            <StatLine
              label="Likidite"
              value={`${pct(ratio)} · ${LIQUIDITY_BAND_LABEL[band]}`}
              icon={<IconLiquidity size={15} />}
              tone={band === 'red' ? 'negative' : band === 'caution' ? 'warning' : undefined}
            />
            {/* GDD 34.5 — gerçekleşmiş kâr ve stok potansiyeli AYRI satırlardır. */}
            <StatLine
              label="Gerçekleşmiş kâr (bugün)"
              value={tlSigned(wealth.realizedProfitToday)}
              tone={wealth.realizedProfitToday >= 0 ? 'positive' : 'negative'}
            />
            <StatLine
              label="Stok potansiyeli (realize değil)"
              value={tlSigned(wealth.stockPotential)}
              tone={wealth.stockPotential >= 0 ? 'positive' : 'negative'}
            />
            <StatLine label="Yükümlülük" value={tl(wealth.liabilities)} />
            <StatLine label="Net servet" value={tl(wealth.netWorth)} />
          </div>
        </div>

        {/*
          Addendum §4.1 — "Toplu işlemler tekil müşteri metriğini
          ŞİŞİRMEMELİ; adet, gram karşılığı, ciro, brüt marj ve KANAL BAZINDA
          ayrıca ölçülmelidir." §6.1 aynı şeyi kanal ortalaması için ister.
          Ölçüm koda girip ekrana çıkmasaydı, ölçülmüş sayılmazdı.
        */}
        <SalesBreakdown ledger={s.ledger} />

        {/* İlişkiler */}
        <div className="group">
          <h2 className="group__title">İlişkiler</h2>
          <div className="group__body">
            <StatLine
              label="Semt itibarı"
              value={`${Math.round(s.store.reputation)}/100`}
              icon={<IconTrust size={15} />}
            />
            <StatLine
              label="Toptancı güveni"
              value={`${Math.round(s.store.supplier.trust)}/100`}
              icon={<IconWholesale size={15} />}
            />
            <StatLine
              label="Tedarik limiti"
              value={`${tl(s.store.supplier.limit)} · ${s.store.supplier.terms} gün vade`}
            />
          </div>
        </div>

        {/* İkincil rotalar (GDD 23.9.1) */}
        <div className="group">
          <h2 className="group__title">Rotalar</h2>
          <div className="group__body">
            <MenuLine
              title="Piyasa"
              sub={`${MARKET_REGIME[s.market.regime].label} rejim · ${s.market.assets.length} varlık`}
              icon={<IconLiquidity size={17} />}
              onPress={() => onOpen('market')}
            />
            <MenuLine
              title="İşlem Defteri"
              sub={`${s.ledger.deals.length} kayıt · vaka özetleri`}
              icon={<IconReason size={17} />}
              onPress={() => onOpen('journal')}
            />
            <MenuLine
              title="Toptancı Hesabı"
              sub={`${s.store.supplier.openInvoices.length} açık vade`}
              icon={<IconWholesale size={17} />}
              onPress={() => undefined}
            />
            <MenuLine
              title="Kariyer / Yetenekler"
              sub={`Seviye ${s.store.level} · ${s.store.xp}/${s.store.xpToNext} XP`}
              icon={<IconBusiness size={17} />}
              onPress={() => undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Addendum §4.1 / §6.1 — SATIŞ KIRILIMI.
 *
 * İki ayrı soruyu ayrı ayrı yanıtlar:
 *   1. Tekil müşteri işi ne kadar marj bırakıyor? (toplu işlem karıştırılmadan)
 *   2. Hangi kanal ne kadar adet, gram ve ciro üretti?
 *
 * Hiç satış yokken panel gösterilmez: boş tablo bilgi değil gürültüdür.
 */
function SalesBreakdown({ ledger }: { ledger: Ledger }) {
  const split = volumeSplitMetrics(ledger);
  const byChannel = channelMetrics(ledger);
  const rows = Object.entries(byChannel).filter(([, m]) => m.deals > 0);

  if (split.single.deals + split.bulk.deals === 0) return null;

  return (
    <div className="group">
      <h2 className="group__title">Satış kırılımı</h2>
      <div className="group__body">
        {split.single.deals > 0 && (
          <StatLine
            label={`Tekil müşteri · ${split.single.deals} işlem`}
            value={`${tl(split.single.revenue)} · marj ${pct(split.single.grossMargin)}`}
          />
        )}
        {split.bulk.deals > 0 && (
          <StatLine
            label={`Toplu müşteri · ${split.bulk.deals} işlem`}
            value={`${tl(split.bulk.revenue)} · marj ${pct(split.bulk.grossMargin)}`}
          />
        )}
        {rows.map(([channel, m]) => (
          <StatLine
            key={channel}
            label={CHANNEL_LABEL_TR[channel as TradeChannel] ?? channel}
            value={`${m.units} adet · ${m.grams.toFixed(2)} gr · ${tl(m.revenue)}`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Piyasa ekranı (GDD 23.16)
// ---------------------------------------------------------------------------

/**
 * GDD 23.16: "Piyasa ekranı telefon finans uygulaması kadar okunur; trading
 * terminali kadar yoğun değildir." · Event alanında "kesin yükselecek" dili
 * kullanılmaz — yalnız hangi grubu etkilediği söylenir.
 */
function MarketRoute({ onBack }: { onBack: () => void }) {
  const market = useGame((s) => s.market);
  const regime = MARKET_REGIME[market.regime];

  return (
    <div className="page">
      <header className="pageHead">
        <button type="button" className="chip" onClick={onBack} style={{ marginBottom: 8 }}>
          ← İşletme
        </button>
        <h1 className="pageHead__title">Piyasa</h1>
        <p className="pageHead__sub">
          Gün {market.day} · {regime.label} rejim · oynaklık {pct(market.volatility, 1)}
        </p>

        {market.activeEvent && (
          <div className="eventCard">
            <div className="eventCard__title">{market.activeEvent.label}</div>
            <div className="eventCard__text">{market.activeEvent.description}</div>
            <div className="eventCard__list">
              {market.activeEvent.counterplay.map((play) => (
                <span key={play} className="tag tag--neutral">
                  {play}
                </span>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="page__scroll">
        <div className="group">
          <h2 className="group__title">Gün Rejimi</h2>
          <div className="group__body">
            <div className="statLine">
              <span className="statLine__label">{regime.label}</span>
              <span className="statLine__value" style={{ fontWeight: 400, fontSize: 12 }}>
                {regime.note}
              </span>
            </div>
          </div>
        </div>

        <div className="group">
          <h2 className="group__title">Varlıklar</h2>
          <div className="group__body">
            {market.assets.map((asset) => (
              <div key={asset.id} className="assetRow">
                <div>
                  <div className="assetRow__name">{asset.label}</div>
                  <div className="assetRow__unit">{asset.unit}</div>
                </div>

                <Sparkline points={asset.history} />

                <div className="assetRow__right">
                  <div className="assetRow__price num">{price(asset.price)}</div>
                  <div className={`assetRow__change num ${changeClass(asset.changePct)}`}>
                    {pctChange(asset.changePct)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mini trend — her satırda küçük bir çizgi (GDD 23.16 "mini trend"). */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="spark" style={{ width: 52 }} />;

  const series = points.slice().reverse();
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const w = 52;
  const h = 18;

  const d = series
    .map((p, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const rising = (series[series.length - 1] ?? 0) >= (series[0] ?? 0);

  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke={rising ? 'var(--positive)' : 'var(--negative)'}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.8}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// İşlem Defteri (GDD 23.20)
// ---------------------------------------------------------------------------

/**
 * GDD 23.20: "Liste: kısa işlem satırı — ürün, kapanış, kâr/zarar, güven delta."
 * "Öğrenme: işlem öncesi cevabı vermez; sonuçtan sonra 'neden' gösterir."
 */
function JournalRoute({ onBack }: { onBack: () => void }) {
  const s = useGame();
  const deals = s.ledger.deals.slice().reverse();

  return (
    <div className="page">
      <header className="pageHead">
        <button type="button" className="chip" onClick={onBack} style={{ marginBottom: 8 }}>
          ← İşletme
        </button>
        <h1 className="pageHead__title">İşlem Defteri</h1>
        <p className="pageHead__sub">{deals.length} kayıt · her işlemin gerekçesi ve sonucu</p>
      </header>

      <div className="page__scroll">
        {deals.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">
              <IconReason size={34} />
            </div>
            <p className="empty__title">Henüz kayıt yok</p>
            <p className="empty__text">
              Kapanan her işlem buraya düşer: kullanılan testler, tahmin bandı, teklif
              geçmişi ve gerçek sonuç.
            </p>
          </div>
        ) : (
          <div className="rowList">
            {deals.map((deal) => {
              const item = s.items[deal.itemIds[0] ?? ''];
              const accepted = deal.finalState === 'ACCEPTED';
              const delta = accepted ? deal.actualValue - deal.price : 0;

              return (
                <div key={deal.dealId} className="row">
                  <div className="row__body">
                    <div className="row__title">
                      {item?.displayName ?? 'Ürün'}{' '}
                      <span className={`tag ${accepted ? '' : 'tag--neutral'}`}>
                        {accepted ? 'Kabul' : 'Red'}
                      </span>
                    </div>
                    <div className="row__meta">
                      Gün {deal.day} · {deal.testsUsed.length} test · güven{' '}
                      {deal.confidence === 'high'
                        ? 'yüksek'
                        : deal.confidence === 'medium'
                          ? 'orta'
                          : 'düşük'}
                    </div>

                    <div className="row__figures">
                      <span className="figure">
                        <span className="figure__label">Kapanış</span>
                        <span className="figure__value num">
                          {accepted ? tl(deal.price) : '—'}
                        </span>
                      </span>
                      <span className="figure">
                        <span className="figure__label">Tahmin bandı</span>
                        <span className="figure__value num">
                          {tl(deal.estimateBand.min)}–{tl(deal.estimateBand.max)}
                        </span>
                      </span>
                      {accepted && (
                        <span className="figure">
                          <span className="figure__label">Gerçeğe fark</span>
                          <span
                            className={`figure__value num ${
                              delta >= 0 ? 'figure__value--positive' : 'figure__value--negative'
                            }`}
                          >
                            {tlSigned(delta)}
                          </span>
                        </span>
                      )}
                    </div>

                    {deal.reviewData.keyDecisionPoint && (
                      <div className="rowAlert" style={{ color: 'var(--text-light-3)' }}>
                        {deal.reviewData.keyDecisionPoint}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatLine({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'positive' | 'negative' | 'warning';
}) {
  return (
    <div className="statLine">
      <span className="statLine__label">
        {icon}
        {label}
      </span>
      <span className={`statLine__value num ${tone ? `statLine__value--${tone}` : ''}`}>
        {value}
      </span>
    </div>
  );
}

function MenuLine({
  title,
  sub,
  icon,
  onPress,
}: {
  title: string;
  sub: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <button type="button" className="menuLine" onClick={onPress}>
      <span className="menuLine__icon">{icon}</span>
      <span className="menuLine__body">
        <span className="menuLine__title">{title}</span>
        <br />
        <span className="menuLine__sub">{sub}</span>
      </span>
      <span className="menuLine__chevron">
        <IconChevronRight size={16} />
      </span>
    </button>
  );
}

function changeClass(pctValue: number): string {
  if (pctValue > 0.005) return 'assetRow__change--up';
  if (pctValue < -0.005) return 'assetRow__change--down';
  return 'assetRow__change--flat';
}
