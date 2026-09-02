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
import { isCrafted } from '@domain/customer-pricing';
import { fromMg, toMg, roundMoney, isHasTradingDay } from '@domain/v5-rules';
import { hasQuote, maxHasBuyMg } from '@domain/has-account';
import { poolForTemplate } from '@domain/stock-pools';

import { KARAT_LABEL } from '@domain/balance';
import { CHANNEL_SHORT } from '@domain/thesis';
import { liquidationEstimate, liquidityBand, liquidityRatio, summarizeWealth } from '@domain/settlement';
import { getTemplate } from '@data/item-templates';
import { POOL_SUPPLY, poolSupplyQuote, maxPoolSupplyQuantity, hasPoolSupplySpace } from '@domain/pool-supply';
import { useGame } from '@state/gameStore';

import { IconStock, IconWarning, ProductSilhouette } from '@ui/icons';
import { Art } from '@ui/Art';
import { NAV_ART, productArt } from '@ui/assets';
import { grams, pct, tl, tlBare, tlSigned, preciseGrams } from '@ui/format';
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
          {s.inventory.length === 0 ? 'Stok boş' : `${s.inventory.length} ürün`} · Vitrin {counts.display}/{s.store.displaySlots} · Arka stok{' '}
          {counts.backStock}/{s.store.backStockSlots}
        </p>

        <div className="summaryRow">
          <div className="summaryRow__item">
            <span className="summaryRow__label">Maliyet</span>
            <span className="summaryRow__value num">{tl(wealth.stockCost)}</span>
          </div>
          <div className="summaryRow__item">
            <span className="summaryRow__label">Net Çıkış</span>
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
        {/* Playtest revizyonu §4 · UPDATEv5 — ortak havuz tezgâhı ve HAS. */}
        <BullionCounter />
        <HasCounter />

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
              {s.inventory.length === 0 ? 'Stok boş' : 'Bu filtrede ürün yok'}
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
/**
 * SARRAFİYE TEZGÂHI — UPDATEv5 ortak havuz tedariki.
 *
 * Eski hâli ayrı bir ROTAYDI (`BullionRoute`) ve tek tek SKU satardı.
 * UPDATEv5 stoğu ortak mg havuzlarında topladığı için tezgâh da havuz
 * ürünlerini satar; katalog açılır panel olarak Stok ekranında ve Dükkan
 * ekranının hızlı stok sayfasında AYNI bileşenden gelir.
 */
function BullionCounter() {
  const s = useGame();

  return <div className="counter">
    <button
      type="button"
      className="counter__toggle"
      onClick={() => s.setStockCatalogOpen(!s.stockCatalogOpen)}
      aria-expanded={s.stockCatalogOpen}
      aria-controls="bullion-catalog"
    >
      <span>Sarrafiye Al</span>
      <span className="counter__meta">
        <span className="counter__hint num">{tl(s.store.cash)}</span>
        <span
          className={`counter__chevron ${s.stockCatalogOpen ? 'counter__chevron--open' : ''}`}
          aria-hidden="true"
        >
          ▼
        </span>
      </span>
    </button>
    {s.stockCatalogOpen && <BullionCatalog id="bullion-catalog" />}
  </div>;
}

/** Ana Dükkan hızlı alım sheet'i ile Stok ekranı aynı gerçek kataloğu paylaşır. */
export function BullionCatalog({ id }: { id?: string }) {
  return <div className="counter__list" id={id}>
    {POOL_SUPPLY.map(product => <BullionOffer key={product.templateId} product={product} />)}
  </div>;
}

function BullionOffer({ product }: { product: typeof POOL_SUPPLY[number] }) {
  const s = useGame();
  const { templateId, name, gramsPerUnit } = product;
  const [amount, setAmount] = useState(counterMemory.qty[templateId] ?? '1');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const qty = Number(amount.replace(',', '.'));
  const setQty = (next: string) => {
    counterMemory.qty[templateId] = next;
    setAmount(next);
    setConfirmation(null);
  };
  const lot = poolSupplyQuote(templateId, qty, s.market, s.store);
  const max = useMemo(() => maxPoolSupplyQuantity(templateId, s.market, s.store), [templateId, s.market, s.store]);
  const sliderStep = templateId === 'gram_gold_1' ? 0.001 : 1;
  const sliderValue = Number.isFinite(qty) ? Math.min(max, Math.max(0, qty)) : 0;
  const unitQuote = lot ?? poolSupplyQuote(templateId, 1, s.market, s.store)!;
  const poolId = poolForTemplate(templateId);
  const held = s.inventory.filter(p => p.poolId === poolId)
    .reduce((sum, p) => sum + (p.quantityMg === undefined ? p.quantity : fromMg(p.quantityMg)), 0);
  const space = hasPoolSupplySpace(templateId, s.inventory, s.store);
  const affordable = !!lot && lot.totalPrice <= s.store.cash && space;
  const signature = lot ? `${qty}:${lot.totalPrice}` : '';
  const expensive = !!lot && lot.totalPrice >= Math.max(100_000, Math.round(s.store.cash * .2));
  const confirmed = confirmation === signature;
  const buy = () => {
    if (!affordable || !lot) return;
    if (expensive && !confirmed) { setConfirmation(signature); return; }
    s.buyPoolStock(templateId, qty);
    setQty('1');
  };
  return <section className="offerRow" aria-label={name}>
    <div className="offerRow__head">
      <span className="offerRow__name">{name}</span>
      <span className="offerRow__unit num">{tlBare(unitQuote.unitPrice / (gramsPerUnit || 1))} TL/{gramsPerUnit ? 'g' : 'adet'}</span>
    </div>
    <div className="offerRow__meta">Stokta {gramsPerUnit ? preciseGrams(held) : `${held} adet`}</div>
    <div className="offerRow__controls">
      {templateId === 'gram_gold_1'
        ? <label className="poolAmount">Gram <input aria-label="Gram Altın miktarı" type="text" inputMode="decimal" value={amount}
            onChange={e => setQty(e.target.value)} /></label>
        : <div className="qtyStep" role="group" aria-label={`${name} miktarı`}>
          <button type="button" className="qtyStep__btn" aria-label={gramsPerUnit ? '10 gram azalt' : 'Bir adet azalt'}
            disabled={qty <= 1} onClick={() => setQty(String(Math.max(1, qty - 1)))}>−</button>
          <span className="qtyStep__value num">{gramsPerUnit ? `${qty * gramsPerUnit} g` : qty}</span>
          <button type="button" className="qtyStep__btn" aria-label={gramsPerUnit ? '10 gram artır' : 'Bir adet artır'}
            disabled={qty + 1 > max || !space} onClick={() => setQty(String(qty + 1))}>+</button>
        </div>}
      <span className="offerRow__total num">{lot ? tl(lot.totalPrice) : '—'}</span>
      <button type="button" className="offerRow__buy" disabled={!affordable} onClick={buy}>{expensive && confirmed ? 'Onayla' : 'Al'}</button>
    </div>
    <label className="poolSlider">
      <span>Seçilen: {gramsPerUnit ? `${sliderValue * gramsPerUnit} g` : `${sliderValue} adet`}</span>
      <input type="range" aria-label={`${name} miktar sliderı`} min={0} max={max} step={sliderStep} value={sliderValue}
        disabled={max <= 0 || !space}
        onChange={e => setQty(templateId === 'gram_gold_1' ? Number(e.target.value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(Number(e.target.value))))} />
      <span className="poolSlider__range">0 — {gramsPerUnit ? `${max * gramsPerUnit} g` : `${max} adet`}</span>
    </label>
    {expensive && confirmed && <p className="offerRow__confirm" role="status">Yüksek tutar: {tl(lot.totalPrice)}. Satın almak için tekrar onayla.</p>}
    {!lot && <p className="offerRow__shortfall">Pozitif, geçerli bir miktar seçin. Gram altın hassasiyeti 0,001 g.</p>}
    {lot && !affordable && <p className="offerRow__shortfall">{!space
      ? 'Arka stokta yeni ürün ailesi için yer yok.'
      : `Minimum ${templateId === 'gram_gold_1' ? '0,001 g' : '1 adet'} · Yetersiz Nakit · ${tl(lot.totalPrice)} gerekli, ${tl(s.store.cash)} mevcut`}</p>}
  </section>;
}

/** Uncommitted UI choice survives tab changes; inventory is always held in game state. */
const counterMemory: { qty: Record<string, string> } = { qty: {} };

function StockRow({ position }: { position: InventoryPosition }) {
  const s = useGame();
  const item = useGame((s) => s.items[position.itemId]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!item) return null;

  const template = getTemplate(item.templateId);
  const liquidation = liquidationEstimate(position);
  const delta = liquidation.value - position.costBasis;
  const isDead = position.age >= DEAD_STOCK_AGE;

  return (
    <div className={`row ${detailsOpen ? 'row--open' : ''}`}>
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
          <span className="row__qty num"> · {position.quantityMg === undefined ? `${position.quantity} adet` : preciseGrams(fromMg(position.quantityMg))}</span>
        </div>
        <div className="row__meta">
          {KARAT_LABEL[item.declared.claimedKarat]} · {position.poolId ? 'Ortak havuz' : grams(item.truth.grossWeight)} ·{' '}
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
            <span className="figure__label">Gerçek Alış Maliyeti</span>
            <span className="figure__value num">{tl(position.costBasis)}</span>
          </span>
          <span className="figure">
            <span className="figure__label">Net Satış Tahmini</span>
            <span className="figure__value num">{tl(liquidation.value)}</span>
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

        <div className="row__exitEstimate">
          Hızlı çıkış: <strong>{liquidation.channel}</strong> · Tahmini süre {liquidation.time}
        </div>

        {/* Satır uyarısı — tek satır durum (GDD 23.15) */}
        {isDead && (
          <div className="rowAlert">
            <IconWarning size={12} />
            Ölü stok riski · {position.age} gündür bekliyor
          </div>
        )}

        {/*
          UPDATEv2 §8 + UPDATEv5 — TEK AÇILIR PANEL.

          İki ayrı açılır bölüm vardı (biri eylemler, biri konum/çıkış planı)
          ve ikisi de aynı kartın altına iniyordu: oyuncu aynı bilgi için iki
          düğme görüyordu. Panel tek; içinde önce eylemler, sonra durum.
        */}
        <button
          type="button"
          className="row__disclosure rowDetailToggle"
          onClick={() => setDetailsOpen(!detailsOpen)}
          aria-expanded={detailsOpen}
        >
          {detailsOpen ? 'Eylemleri gizle' : 'Eylemler ve çıkış planı'}
          <span aria-hidden="true">{detailsOpen ? ' ▾' : ' ›'}</span>
        </button>

        {detailsOpen && (
          <div className="rowDetailPanel">
            <StockActions position={position} />
            {isCrafted(item) && position.location !== 'workshop' && <>
              <button type="button" className="chip" disabled={position.location === 'display'} onClick={() => s.displayStock(item.id)}>Vitrine Koy</button>
              <button type="button" className="chip" onClick={() => { if (window.confirm('Ürün fiziksel stoktan çıkarılıp HAS bakiyesine dönüşecek. Mevcut 180 ₺ eritme bedeli alınır. Onaylıyor musunuz?')) s.meltStock(item.id); }}>Erit → HAS</button>
            </>}
            <p><strong>Konum:</strong> {position.location === 'display' ? 'Vitrin' : position.location === 'backStock' ? 'Arka stok' : position.location === 'workshop' ? 'Serviste' : 'Müşteride'}</p>
            <p><strong>Çıkış planı:</strong> {position.thesis ? CHANNEL_SHORT[position.thesis] : 'Henüz seçilmedi.'}</p>
            {!position.thesis && <p>Çıkış planı, ürünün müşteri işleminde değerlendirilip bir satış kanalı seçildiğinde atanır.</p>}
          </div>
        )}
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
function HasCounter() {
  const s = useGame();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amountMg, setAmountMg] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const quote = hasQuote(s.market, s.store);
  const open = isHasTradingDay(s.market.day);
  const maxMg = side === 'buy' ? maxHasBuyMg(s.store.cash, quote.buy) : s.store.hasBalanceMg ?? 0;
  const selectedMg = Math.min(amountMg, maxMg);
  const qty = fromMg(selectedMg);
  const total = roundMoney(qty * (side === 'buy' ? quote.buy : quote.sell));
  const valid = selectedMg > 0 && selectedMg <= maxMg && total > 0;
  const signature = `${s.market.day}:${side}:${selectedMg}:${total}:${s.ledger.transactions.length}`;
  const changeSide = (next: 'buy' | 'sell') => { setSide(next); setAmountMg(0); setPending(null); };
  return <section className="group" aria-label="HAS hesabı">
    <h2 className="group__title">HAS hesabı · {preciseGrams(fromMg(s.store.hasBalanceMg ?? 0))}</h2>
    <div className="group__body v5Controls">
      <p>Saflık 1.000 · Değer {tl(fromMg(s.store.hasBalanceMg ?? 0) * s.market.goldSpot)}</p>
      <p>Toptancıdan al {tl(quote.buy)}/g · Toptancıya sat {tl(quote.sell)}/g</p>
      <p>{open ? 'Cuma: HAS işlemleri açık.' : 'Miktarı şimdi seçebilirsiniz; alım-satım onayı yalnız cuma günü açılır.'}</p>
      <div role="group" aria-label="HAS işlem yönü">
        <button type="button" className="chip" aria-pressed={side === 'buy'} onClick={() => changeSide('buy')}>HAS Al</button>
        <button type="button" className="chip" aria-pressed={side === 'sell'} onClick={() => changeSide('sell')}>HAS Sat</button>
      </div>
      <label className="hasSlider">{side === 'buy' ? 'Seçilen' : 'Satılacak'}: {preciseGrams(qty)}
        <input type="range" aria-label="HAS miktarı" min={0} max={fromMg(maxMg)} step={0.001} value={qty}
          disabled={maxMg <= 0} onChange={e => { setAmountMg(Math.min(maxMg, Math.max(0, toMg(Number(e.target.value))))); setPending(null); }} />
      </label>
      <p>0 g — {preciseGrams(fromMg(maxMg))}</p>
      <p>{side === 'buy' ? 'Yaklaşık Tutar' : 'Alınacak'}: {tl(total)}</p>
      <button type="button" className="chip" disabled={maxMg <= 0}
        onClick={() => { setAmountMg(maxMg); setPending(null); }}>{side === 'buy' ? 'MAX AL' : 'TÜM HAS'}</button>
      <button type="button" className="chip" disabled={!open || !valid} onClick={() => setPending(signature)}>İşleme Devam Et</button>
      {pending === signature && open && valid && <div role="group" aria-label="HAS işlem onayı">
        <p>{preciseGrams(qty)} · {tl(total)} — {side === 'buy' ? 'alım' : 'satış'} onayı</p>
        <button type="button" className="chip" onClick={() => {
          s.tradeHas(side, qty, `has_${s.market.day}_${s.ledger.transactions.length}_${side}`);
          setPending(null); setAmountMg(0);
        }}>İşlemi Onayla</button>
        <button type="button" className="chip" onClick={() => setPending(null)}>Vazgeç</button>
      </div>}
    </div>
  </section>;
}
