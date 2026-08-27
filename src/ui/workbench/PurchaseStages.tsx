/**
 * İşlem Masası · MÜŞTERİ ALIŞ AKIŞI (GDD 23.23)
 *
 * "Müşteri alış: Stok seçimi → Değer/Paket → Pazarlık."
 *
 * Ekonomi Ara Düzeltmesi §3'ün terminolojisiyle: müşteri ALIR, oyuncu SATAR.
 *
 * Bu akışın satış akışından yüzeysel farkı üç adım olması; YAPISAL farkı ise
 * belirsizliğin yer değiştirmesidir. Satış akışında bilinmeyen ürünün
 * gerçeğidir ve testlerle kapanır. Burada ürün oyuncunun kendi stoğudur;
 * bilinmeyen MÜŞTERİNİN ÖDEME TAVANIdır ve o hiçbir araçla ölçülemez —
 * yalnız doğru malı doğru pakette sunarak yükseltilebilir.
 *
 * GDD 23.24 gereği üç adım da AYNI Workbench yüzeyini kullanır.
 * GDD 6.6 gereği müşterinin tavanı hiçbir yerde sayı olarak gösterilmez.
 */

import { matchDemand, type DemandMatch } from '@domain/purchase';
import { CHANNEL_LABEL_TR } from '@domain/channels';
import { getTemplate } from '@data/item-templates';
import { IconPackage, IconWarning, ProductSilhouette } from '@ui/icons';
import { tl } from '@ui/format';
import type {
  CustomerDemand,
  InventoryPosition,
  ItemInstance,
  PurchaseSession,
} from '@domain/types';

const MATCH_LABEL: Record<DemandMatch, string> = {
  exact: 'Tam istediği',
  family: 'İlgili ürün',
  off: 'Aradığı değil',
};

// ---------------------------------------------------------------------------
// 1. STOK SEÇİMİ
// ---------------------------------------------------------------------------

export function StockPickStage({
  purchase,
  rows,
  onToggle,
}: {
  purchase: PurchaseSession;
  rows: { position: InventoryPosition; item: ItemInstance }[];
  onToggle: (itemId: string) => void;
}) {
  const demand = purchase.demand;
  const selected = new Set(purchase.selectedItemIds);

  return (
    <div className="svc">
      <div className="pkgDemand">
        <span className="pkgDemand__icon">
          <IconPackage size={20} />
        </span>
        <div>
          <h2 className="svc__title">{demand.summary}</h2>
          <p className="svc__meta">
            {demand.quantity > 1 ? `${demand.quantity} adet istiyor` : 'Tek parça arıyor'}
            {demand.acceptsPartial && demand.minQuantity < demand.quantity && (
              <> · en az {demand.minQuantity} adede razı</>
            )}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="svc__note svc__note--center">
          <IconWarning size={16} />
          <strong>Stokta sunulacak ürün yok.</strong> Bu müşteriye verecek malınız
          bulunmuyor; talebi karşılayamadan gitmesi normaldir.
        </p>
      ) : (
        <ul className="pickList">
          {rows.map(({ position, item }) => {
            const match = matchDemand(demand, item);
            const isOn = selected.has(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`pickRow ${isOn ? 'pickRow--on' : ''}`}
                  onClick={() => onToggle(item.id)}
                  aria-pressed={isOn}
                >
                  <span className="pickRow__art">
                    <ProductSilhouette kind={getTemplate(item.templateId).silhouette} size={30} />
                  </span>
                  <span className="pickRow__body">
                    <span className="pickRow__name">{item.displayName}</span>
                    <span className={`pickRow__match pickRow__match--${match}`}>
                      {MATCH_LABEL[match]}
                      {position.location === 'backStock' && ' · arka stok'}
                    </span>
                  </span>
                  <span className="pickRow__value">{tl(position.currentValue)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. DEĞER / PAKET
// ---------------------------------------------------------------------------

export function PackageStage({
  purchase,
  items,
}: {
  purchase: PurchaseSession;
  items: ItemInstance[];
}) {
  const potential = purchase.suggestedPrice - purchase.packageCost;

  return (
    <div className="svc">
      <div className="pkgDemand">
        <span className="pkgDemand__icon">
          <IconPackage size={20} />
        </span>
        <div>
          <h2 className="svc__title">Paket · {items.length} kalem</h2>
          <p className="svc__meta">{fulfilmentText(purchase, purchase.demand)}</p>
        </div>
      </div>

      <ul className="pkgLines">
        {items.map((item) => (
          <li key={item.id} className="pkgLines__row">
            <ProductSilhouette kind={getTemplate(item.templateId).silhouette} size={22} />
            <span>{item.displayName}</span>
          </li>
        ))}
      </ul>

      {/*
        GDD 6.6 — müşterinin ödeme tavanı GÖSTERİLMEZ. Gösterilen her sayı
        oyuncunun kendi tarafındandır: paketin adil değeri, defter maliyeti,
        kanal makasının önerdiği fiyat ve aradaki potansiyel.
      */}
      <div className="pkgFigures">
        <Figure label="Adil değer" value={tl(purchase.packageFairValue)} />
        <Figure label="Defter maliyeti" value={tl(purchase.packageCost)} />
        <Figure
          label="Kanal önerisi"
          value={tl(purchase.suggestedPrice)}
          tone={potential >= 0 ? 'positive' : 'negative'}
          big
        />
      </div>

      <p className="svc__note">
        <IconPackage size={16} />
        <strong>{CHANNEL_LABEL_TR[purchase.channel]}</strong> makasıyla fiyatlandı.{' '}
        {purchase.rationale} Öneri bir dayatma değildir; pazarlıkta istediğiniz
        rakamı verirsiniz.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
  big?: boolean;
}) {
  return (
    <div className={`pkgFigure ${big ? 'pkgFigure--big' : ''}`}>
      <span className="pkgFigure__label">{label}</span>
      <span className={`pkgFigure__value ${tone ? `pkgFigure__value--${tone}` : ''}`}>{value}</span>
    </div>
  );
}

function fulfilmentText(purchase: PurchaseSession, demand: CustomerDemand): string {
  switch (purchase.fulfilment) {
    case 'full':
      return 'Talep tam karşılandı.';
    case 'partial':
      // §4.1 "Toplu talepler ... kısmen karşılanabilir."
      return `Kısmi karşılama · ${purchase.selectedItemIds.length}/${demand.quantity} adet.`;
    default:
      return demand.acceptsPartial
        ? `Yetersiz · en az ${demand.minQuantity} adet gerekiyor.`
        : `Yetersiz · ${demand.quantity} adedin tamamı gerekiyor.`;
  }
}
