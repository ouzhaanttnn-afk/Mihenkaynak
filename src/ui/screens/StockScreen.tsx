/**
 * STOK ekranı (GDD 23.15)
 *
 * Kurallar:
 *  - Üst başlık: stok değeri + likiditeye bağlı KISA ÖZET; büyük dashboard
 *    kartı yok.
 *  - Sticky filtre rayı: Tümü / Vitrin / Arka Stok / Serviste / Bekleyen / Ölü Stok.
 *  - Dikey liste: ürün adı, ayar/gram, maliyet, bugünkü değer, yaş, tez etiketi.
 *  - Satır uyarısı tek satır durum olarak görünür.
 *  - Stok ekranı scroll kullanabilir; üst başlık ve filtre rayı sticky kalır.
 */

import { TERM } from '@ui/terms';
import { useMemo, useState } from 'react';

import { KARAT_LABEL } from '@domain/balance';
import { CHANNEL_SHORT } from '@domain/thesis';
import { liquidityBand, liquidityRatio, summarizeWealth } from '@domain/settlement';
import { getTemplate } from '@data/item-templates';
import { spawnItem } from '@domain/item-spawn';
import { unitPriceView } from '@domain/channels';
import { supplyOffer } from '@domain/wholesaler';
import { useGame } from '@state/gameStore';

import { IconStock, IconWarning, ProductSilhouette } from '@ui/icons';
import { grams, pct, tl, tlBare, tlSigned } from '@ui/format';
import type { InventoryPosition } from '@domain/types';

type Filter = 'all' | 'display' | 'backStock' | 'workshop' | 'dead';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'display', label: 'Vitrin' },
  { id: 'backStock', label: 'Arka Stok' },
  { id: 'workshop', label: 'Serviste' },
  { id: 'dead', label: 'Ölü Stok' },
];

/** GDD 15.3 — bu yaşın üstündeki kalem "ölü stok" uyarısı taşır. PLAYTEST. */
const DEAD_STOCK_AGE = 6;

export function StockScreen() {
  const s = useGame();
  const [filter, setFilter] = useState<Filter>('all');

  const wealth = summarizeWealth({
    store: s.store,
    inventory: s.inventory,
    items: s.items,
    ledger: s.ledger,
  });
  const ratio = liquidityRatio(s.store.cash, s.inventory);
  const band = liquidityBand(ratio);

  const counts = {
    all: s.inventory.length,
    display: s.inventory.filter((p) => p.location === 'display').length,
    backStock: s.inventory.filter((p) => p.location === 'backStock').length,
    workshop: s.inventory.filter((p) => p.location === 'workshop').length,
    dead: s.inventory.filter((p) => p.age >= DEAD_STOCK_AGE).length,
  };

  const visible = s.inventory.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'dead') return p.age >= DEAD_STOCK_AGE;
    return p.location === filter;
  });

  return (
    <div className="page">
      <header className="pageHead">
        <h1 className="pageHead__title">Stok</h1>
        <p className="pageHead__sub">
          {s.inventory.length} kalem · Vitrin {counts.display}/{s.store.displaySlots} · Arka stok{' '}
          {counts.backStock}/{s.store.backStockSlots}
        </p>

        <div className="summaryRow">
          <div className="summaryRow__item">
            <span className="summaryRow__label">Stok Maliyeti</span>
            <span className="summaryRow__value num">{tl(wealth.stockCost)}</span>
          </div>
          <div className="summaryRow__item">
            <span className="summaryRow__label">Stok Potansiyeli</span>
            <span
              className={`summaryRow__value num ${
                wealth.stockPotential >= 0
                  ? 'summaryRow__value--positive'
                  : 'summaryRow__value--negative'
              }`}
            >
              {tlSigned(wealth.stockPotential)}
            </span>
          </div>
          <div className="summaryRow__item">
            <span className="summaryRow__label">{TERM.liquidity}</span>
            <span
              className={`summaryRow__value num ${
                band === 'red'
                  ? 'summaryRow__value--negative'
                  : band === 'caution'
                    ? 'summaryRow__value--warning'
                    : ''
              }`}
            >
              {pct(ratio)}
            </span>
          </div>
        </div>

        <div className="liquidityBar">
          <div
            className={`liquidityBar__fill liquidityBar__fill--${band}`}
            style={{ width: `${Math.min(100, ratio * 100)}%` }}
          />
        </div>
      </header>

      <div className="page__scroll">
        {/* Playtest revizyonu §4 — sarrafiye stoklama tezgâhı. */}
        <BullionCounter />

        <div className="filterRail">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`chip ${filter === f.id ? 'chip--active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="chip__count num">{counts[f.id]}</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">
              <IconStock size={34} />
            </div>
            <p className="empty__title">
              {s.inventory.length === 0 ? 'Stok boş' : 'Bu filtrede kalem yok'}
            </p>
            <p className="empty__text">
              {s.inventory.length === 0
                ? 'Müşteriden aldığınız her ürün buraya düşer ve çıkış planı burada yönetilir.'
                : 'Başka bir filtre deneyin.'}
            </p>
          </div>
        ) : (
          <div className="rowList">
            {visible.map((position) => (
              <StockRow key={position.itemId} position={position} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * PLAYTEST — SARRAFİYE ALIM TEZGÂHI
 * Kaynak: Hızlı Sarrafiye Fiyat Görünürlüğü revizyonu · §4.
 *
 * "Bu sistem müşteri alım-satım döngüsünün YERİNE GEÇMEZ. Sadece sarrafiye
 * stoklama, piyasa pozisyonu ve nakit-altın dengesini hızlı test etmek için
 * eklenir."
 *
 * Fiyat hardcode DEĞİL: mevcut toptancı kanalından (`supplyOffer`) türer,
 * yani piyasa, ürün tipi ve makas kuralları aynen işler.
 */
function BullionCounter() {
  const s = useGame();
  // Tezgâhın açık/kapalı durumu ve adet seçimleri sekme değişince
  // KAYBOLMAMALI. StockScreen sekme değiştiğinde unmount olduğu için yerel
  // state sıfırlanıyordu: oyuncu 20 adet seçip nakde bakmaya gidince
  // dönüşünde 1'e düşüyordu. Playtest oturumu boyunca yaşayan küçük bir
  // modül durumu bunu çözer; oyun durumuna girmesi gerekmiyor çünkü
  // kaydedilecek bir şey değil, ekranın hafızası.
  const [open, setOpen] = useState(counterMemory.open);
  const setOpenPersisted = (next: boolean) => {
    counterMemory.open = next;
    setOpen(next);
  };

  return (
    <div className="counter">
      <button
        type="button"
        className="counter__toggle"
        onClick={() => setOpenPersisted(!open)}
        aria-expanded={open}
      >
        <span>Sarrafiye Al</span>
        <span className="counter__hint num">{tl(s.store.cash)}</span>
      </button>

      {open && (
        <div className="counter__list">
          {PLAYTEST_BULLION.map((templateId) => (
            <BullionOffer key={templateId} templateId={templateId} />
          ))}
        </div>
      )}
    </div>
  );
}

function BullionOffer({ templateId }: { templateId: string }) {
  const s = useGame();
  const [qty, setQtyState] = useState(counterMemory.qty[templateId] ?? 1);
  const setQty = (next: number) => {
    counterMemory.qty[templateId] = next;
    setQtyState(next);
  };

  // Sonda sabit: fiyat ürünün ŞABLONUNA bağlıdır, örneğin kimliğine değil.
  const probe = useMemo(() => spawnItem(s.seed, 990_001, templateId), [s.seed, templateId]);
  const lot = supplyOffer(probe, Math.max(1, qty), s.market, s.store);
  if (!lot) return null;

  const view = unitPriceView(probe, lot.unitPrice);
  // Elde bu üründen kaç adet var.
  const held = s.inventory
    .filter((p) => s.items[p.itemId]?.templateId === templateId)
    .reduce((sum, p) => sum + p.quantity, 0);

  const affordable = lot.total <= s.store.cash;

  return (
    <div className="offerRow">
      <div className="offerRow__head">
        <span className="offerRow__name">{probe.displayName}</span>
        <span className="offerRow__unit num">
          {tlBare(view.unitPrice)} {view.unit}
        </span>
      </div>

      <div className="offerRow__meta">
        Stokta {held} · {view.perGram ? `${lot.grams.toFixed(1)} g` : `${lot.quantity} adet`} ·
        en çok {lot.maxQuantity}
      </div>

      <div className="offerRow__controls">
        <div className="qtyStep" role="group" aria-label={`${probe.displayName} adedi`}>
          <button
            type="button"
            className="qtyStep__btn"
            onClick={() => setQty(Math.max(1, qty - 1))}
            aria-label="Bir azalt"
          >
            −
          </button>
          <span className="qtyStep__value num">{lot.quantity}</span>
          <button
            type="button"
            className="qtyStep__btn"
            onClick={() => setQty(Math.min(lot.maxQuantity, qty + 1))}
            disabled={lot.quantity >= lot.maxQuantity}
            aria-label="Bir artır"
          >
            +
          </button>
        </div>

        <span className="offerRow__total num">{tl(lot.total)}</span>

        <button
          type="button"
          className="offerRow__buy"
          onClick={() => s.buyFromWholesaler(templateId, lot.quantity)}
          disabled={!affordable}
        >
          {affordable ? 'Al' : 'Nakit yok'}
        </button>
      </div>
    </div>
  );
}

/**
 * Tezgâhın ekran hafızası. Oyun durumunun parçası DEĞİL: kaydedilmez,
 * yüklenmez, ekonomiyi etkilemez. Yalnız sekme gidip gelirken oyuncunun
 * seçimini korur.
 */
const counterMemory: { open: boolean; qty: Record<string, number> } = {
  open: false,
  qty: {},
};

/** §4 — playtest havuzu. En az bu on bir ürün bulunmalı. */
const PLAYTEST_BULLION = [
  'gram_gold_1',
  'gram_gold_2_5',
  'gram_gold_5',
  'gram_gold_10',
  'gram_gold_20',
  'gram_gold_50',
  'gram_gold_100',
  'quarter_gold',
  'half_gold',
  'full_gold',
  'ata_gold',
];

function StockRow({ position }: { position: InventoryPosition }) {
  const item = useGame((s) => s.items[position.itemId]);
  if (!item) return null;

  const template = getTemplate(item.templateId);
  const delta = position.currentValue - position.costBasis;
  const isDead = position.age >= DEAD_STOCK_AGE;

  return (
    <div className="row">
      <span className="row__thumb">
        <ProductSilhouette kind={template.silhouette} size={30} />
      </span>

      <div className="row__body">
        <div className="row__title">
          {item.displayName}
          {/* §4.1 — yığılmış sarrafiyede adet gizlenmez; maliyet ve değer
              toplamdır, tek parçanınki değil. */}
          {position.quantity > 1 && <span className="row__qty num"> ×{position.quantity}</span>}
        </div>
        <div className="row__meta">
          {KARAT_LABEL[item.declared.claimedKarat]} · {grams(item.truth.grossWeight)} ·{' '}
          {position.age} gün{' '}
          {/* GDD 8.3 — "her kalemin neden tutulduğunu görünür kılan plan etiketi" */}
          <span className={`tag ${position.thesis ? '' : 'tag--neutral'}`}>
            {position.thesis
              ? `${TERM.thesisShort}: ${CHANNEL_SHORT[position.thesis]}`
              : `${TERM.thesis} yok`}
          </span>
        </div>

        <div className="row__figures">
          <span className="figure">
            <span className="figure__label">Maliyet</span>
            <span className="figure__value num">{tl(position.costBasis)}</span>
          </span>
          <span className="figure">
            <span className="figure__label">Bugünkü Değer</span>
            <span className="figure__value num">{tl(position.currentValue)}</span>
          </span>
          <span className="figure">
            <span className="figure__label">Tahmini Marj</span>
            <span
              className={`figure__value num ${
                delta >= 0 ? 'figure__value--positive' : 'figure__value--negative'
              }`}
            >
              {tlSigned(delta)}
            </span>
          </span>
        </div>

        {/* Satır uyarısı — tek satır durum (GDD 23.15) */}
        {isDead && (
          <div className="rowAlert">
            <IconWarning size={12} />
            Ölü stok riski · {position.age} gündür bekliyor
          </div>
        )}
      </div>
    </div>
  );
}
