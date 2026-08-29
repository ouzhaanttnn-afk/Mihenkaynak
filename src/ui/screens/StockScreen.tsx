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
import { Art } from '@ui/Art';
import { NAV_ART, productArt } from '@ui/assets';
import { supplierCounterIds } from '@domain/sales-catalog';
import { grams, pct, tl, tlBare, tlSigned } from '@ui/format';
import type { ExitChannel, InventoryPosition } from '@domain/types';

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
  /*
    UPDATEv2 §8 — "İç içe iki kaydırma alanını kaldır. Katalog tek bir
    kaydırma yüzeyinde veya AYRI TAM EKRAN ALT ROTADA açılmalı."

    Alt rota seçildi. Katalog listenin içinde açıldığında `.counter__list`
    kendi `max-height: 46vh` + `overflow-y: auto` yüzeyini kuruyor ve sayfa
    kaydırmasının içinde ikinci bir kaydırma oluyordu: parmak nereye
    değdiğine göre farklı listeyi kaydırıyor, ürün ararken oyuncu kayboluyor.
    Tam ekran rota hem o iç yüzeyi kaldırır hem de nakdin yapışkan başlıkta
    kalmasına yer açar.
  */
  const [route, setRoute] = useState<'list' | 'buy'>('list');

  if (route === 'buy') return <BullionRoute onBack={() => setRoute('list')} />;

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
            <span className="summaryRow__label">Maliyet</span>
            <span className="summaryRow__value num">{tl(wealth.stockCost)}</span>
          </div>
          <div className="summaryRow__item">
            <span className="summaryRow__label">Potansiyel</span>
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
        {/* Playtest revizyonu §4 · UPDATEv2 §8 — katalog artık ayrı rotada. */}
        <button type="button" className="counter__toggle counter" onClick={() => setRoute('buy')}>
          <span>Sarrafiye Al</span>
          <span className="counter__hint num">Nakit {tl(s.store.cash)} ›</span>
        </button>

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
              <Art
                art={NAV_ART.stock}
                size={96}
                decorative
                className="art--hero"
                fallback={<IconStock size={34} />}
              />
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
function BullionRoute({ onBack }: { onBack: () => void }) {
  const s = useGame();

  return (
    <div className="page">
      {/*
        §8 — "Mevcut nakit YAPIŞKAN BAŞLIKTA görülsün." `.pageHead` zaten
        sticky; nakit oraya taşındı ve katalog boyunca ekranda kalıyor.
      */}
      <header className="pageHead">
        <button type="button" className="chip" onClick={onBack} style={{ marginBottom: 8 }}>
          ← Stok
        </button>
        <h1 className="pageHead__title">Sarrafiye Al</h1>
        <p className="pageHead__sub">
          Nakit <span className="num">{tl(s.store.cash)}</span> · fiyatlar toptancı kanalından
          gelir
        </p>
      </header>

      {/* TEK kaydırma yüzeyi: iç `max-height` / `overflow` YOK. */}
      <div className="page__scroll">
        {supplierCounterIds(s.store.storeTier).map((templateId) => (
          <BullionOffer key={templateId} templateId={templateId} />
        ))}
      </div>
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
  const shortfall = Math.max(0, lot.total - s.store.cash);

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
          /* §12 — pasif düğmenin nedeni erişilebilir adda da yazılı. */
          aria-label={affordable ? undefined : `Al — nakit yetersiz, ${tl(shortfall)} eksik`}
          title={affordable ? undefined : `Nakit yetersiz · ${tl(shortfall)} eksik`}
        >
          {affordable ? 'Al' : 'Nakit yok'}
        </button>
      </div>

      {/* §8 — "Nakit yetersizliği açıkça yazsın." */}
      {!affordable && (
        <div className="offerRow__short">
          Nakit yetersiz · {tl(shortfall)} eksik. Adedi azaltabilir ya da stok satıp nakde
          geçebilirsin.
        </div>
      )}
    </div>
  );
}

/**
 * Tezgâhın ekran hafızası. Oyun durumunun parçası DEĞİL: kaydedilmez,
 * yüklenmez, ekonomiyi etkilemez. Yalnız sekme ya da rota gidip gelirken
 * oyuncunun adet seçimini korur.
 *
 * §8 sonrası `open` alanı düştü: katalog artık açılır panel değil, kendi
 * rotası. Rotanın açık olup olmadığını ekranın kendi state'i tutuyor.
 */
const counterMemory: { qty: Record<string, number> } = {
  qty: {},
};

function StockRow({ position }: { position: InventoryPosition }) {
  const item = useGame((s) => s.items[position.itemId]);
  const [open, setOpen] = useState(false);
  if (!item) return null;

  const template = getTemplate(item.templateId);
  const delta = position.currentValue - position.costBasis;
  const isDead = position.age >= DEAD_STOCK_AGE;

  return (
    <div className={`row ${open ? 'row--open' : ''}`}>
      {/*
        Ürün görseli 64 px — 44 px'lik eski silüet yuvası gerçekçi bandın
        altındaydı. Satırın kendi yüksekliği (başlık + meta + üç rakam)
        zaten 64 px'i geçiyor, yani yuvayı büyütmek satırı büyütmüyor:
        stok listesi aynı sayıda kalemi aynı ekranda göstermeye devam eder.
      */}
      <span className="row__thumb">
        <Art
          art={productArt(item.templateId, template.silhouette)}
          size={64}
          alt={item.displayName}
          className="art--onDark"
          fallback={<ProductSilhouette kind={template.silhouette} size={30} />}
        />
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

        {/*
          UPDATEv2 §8 — "Stok kartları yalnız bilgi kartı olarak kalmamalı."
          Eylemler satırı şişirmesin diye açılır panelde; kapalıyken liste
          eskisi kadar kalem gösterir.
        */}
        <button
          type="button"
          className="row__disclosure"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? 'Eylemleri gizle' : 'Eylemler ve çıkış planı'}
          <span aria-hidden="true">{open ? ' ▾' : ' ›'}</span>
        </button>

        {open && <StockActions position={position} />}
      </div>
    </div>
  );
}

/**
 * UPDATEv2 §8 — KALEM EYLEM PANELİ.
 *
 * §8'in koşulu net: "Bu işlemler mevcut mekanikte yoksa YENİ EKONOMİ SİSTEMİ
 * OLUŞTURMA; en azından `Çıkış Planı yok` etiketini eylemsiz göstermemek için
 * açıklayıcı detay paneli aç."
 *
 * Bu panelde bu ayrım AÇIKÇA yapılır:
 *
 *   Vitrine / Arka stoğa taşı  → GERÇEK eylem. `location` alanı zaten var,
 *                                taşımak nakde ve maliyete dokunmaz.
 *   Çıkış planı seç / değiştir → GERÇEK eylem. `thesis` alanı zaten var;
 *                                değişince yalnız MARK güncellenir.
 *   Satış rotasına git         → GERÇEK eylem, ama yalnız GEZİNME: satışı
 *                                yine İşletme'deki mevcut kanal ekranı yapar.
 *   Servise gönder             → YOK. Kendi stoğunu servise vermek iş kaydı,
 *                                süre ve maliyet ister; uydurmak yerine
 *                                neden olmadığı yazılır.
 */
function StockActions({ position }: { position: InventoryPosition }) {
  const s = useGame();

  const displayUsed = s.inventory.filter((p) => p.location === 'display').length;
  const backUsed = s.inventory.filter((p) => p.location === 'backStock').length;
  const inWorkshop = position.location === 'workshop';

  const target: 'display' | 'backStock' = position.location === 'display' ? 'backStock' : 'display';
  const targetFull =
    target === 'display'
      ? displayUsed >= s.store.displaySlots
      : backUsed >= s.store.backStockSlots;

  const moveReason = inWorkshop
    ? 'Kalem atölyede; iş teslim edilince stoğa döner.'
    : targetFull
      ? target === 'display'
        ? `Vitrin dolu (${displayUsed}/${s.store.displaySlots}).`
        : `Arka stok dolu (${backUsed}/${s.store.backStockSlots}).`
      : null;

  /*
    Kanal seçenekleri UYDURULMAZ: pozisyonun kendi `expectedExitValues`
    alanından gelir. O alan her gün `revalueInventory` tarafından yazılır,
    yani buradaki rakamlar ekrandaki "Bugünkü Değer" ile aynı hesabın
    çıktısıdır.
  */
  const channels = Object.entries(position.expectedExitValues) as [ExitChannel, number][];
  const sorted = [...channels].sort((a, b) => b[1] - a[1]);

  /* Satış rotası: hangi kanalın nerede gerçekleştiğine göre. */
  const plan = position.thesis;
  const routeTo: 'wholesaler' | 'network' | null =
    plan === 'wholesale' || plan === 'melt' ? 'wholesaler' : plan === 'collection' ? null : null;

  return (
    <div className="rowActions">
      {/* --- Konum --- */}
      <div className="rowActions__group">
        <span className="rowActions__label">
          Konum · {LOCATION_LABEL[position.location]}
        </span>
        <button
          type="button"
          className="miniBtn"
          disabled={!!moveReason}
          title={moveReason ?? undefined}
          aria-label={
            moveReason
              ? `${target === 'display' ? 'Vitrine taşı' : 'Arka stoğa taşı'} — ${moveReason}`
              : undefined
          }
          onClick={() => s.moveStock(position.itemId, target)}
        >
          {target === 'display' ? 'Vitrine taşı' : 'Arka stoğa taşı'}
        </button>
        {moveReason && <span className="rowActions__note">{moveReason}</span>}
      </div>

      {/* --- Çıkış planı --- */}
      <div className="rowActions__group">
        <span className="rowActions__label">{TERM.thesis}</span>
        {sorted.length === 0 ? (
          <span className="rowActions__note">
            Bu kalem için kanal hesabı henüz oluşmadı; gün devrinde yeniden değerlenince
            seçenekler burada listelenir.
          </span>
        ) : (
          <>
            <div className="rowActions__chips">
              {sorted.map(([channel, net]) => (
                <button
                  key={channel}
                  type="button"
                  className={`planChip ${position.thesis === channel ? 'planChip--active' : ''}`}
                  onClick={() => s.setStockThesis(position.itemId, channel)}
                  aria-pressed={position.thesis === channel}
                >
                  {CHANNEL_SHORT[channel]}
                  <span className="planChip__net num">{tlBare(net * position.quantity)}</span>
                </button>
              ))}
            </div>
            <span className="rowActions__note">
              Plan yalnız bugünkü değeri (mark) belirler; kâr satışta gerçekleşir.
            </span>
          </>
        )}
      </div>

      {/* --- Satış rotası --- */}
      <div className="rowActions__group">
        <span className="rowActions__label">Satış rotası</span>
        <div className="rowActions__chips">
          <button
            type="button"
            className="miniBtn"
            onClick={() => s.openBusinessRoute('wholesaler')}
          >
            Toptancıya git
          </button>
          <button
            type="button"
            className="miniBtn"
            onClick={() => s.openBusinessRoute('network')}
          >
            Esnaf ağına git
          </button>
        </div>
        <span className="rowActions__note">
          {routeTo
            ? 'Bu plan toptancıda kapanır; satış İşletme ekranındaki kanaldan yapılır.'
            : 'Vitrin ve beklet planlarında satış tezgâhta olur: ürünü isteyen müşteri geldiğinde Dükkan ekranında satarsın.'}
        </span>
      </div>

      {/* --- Servise gönder: mekanik YOK --- */}
      <div className="rowActions__group">
        <span className="rowActions__label">Servise gönder</span>
        <span className="rowActions__note">
          Bu sürümde yalnız MÜŞTERİ ürünü servise alınır: atölye kuyruğu bir müşteri işine,
          teslim sözüne ve ücretine bağlıdır. Kendi stoğun için böyle bir iş kaydı yok; olmayan
          bir eylemi düğme gibi göstermemek için burada yazıyor.
        </span>
      </div>
    </div>
  );
}

const LOCATION_LABEL: Record<InventoryPosition['location'], string> = {
  display: 'Vitrin',
  backStock: 'Arka stok',
  workshop: 'Atölyede',
};
