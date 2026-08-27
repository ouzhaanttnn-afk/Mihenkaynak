/**
 * ATÖLYE ekranı (GDD 23.18)
 *
 * Kurallar:
 *  - Kapasite şeridi sticky: aktif slot / toplam slot, bugün teslim, gecikme riski.
 *  - İş kuyruğu: müşteri/ürün, servis tipi, kalan süre, söz verilen gün, hata riski.
 *  - "Atölye ekranı fabrika üretim bandı gibi görünmez; aktif iş emri ve teslim
 *    sözleri ön plandadır."
 *
 * DEĞİŞMEZ — GDD 17.4 / 34.13: "MIHENKAYNAK atölyesi havadan günlük metal veya
 * sabit pasif gelir ÜRETMEZ." Bu ekranda hiçbir pasif gelir sayacı yoktur.
 *
 * Kapsam notu: servis kuyruğu MVP kapsamındadır (GDD 30.2); bu sürümde
 * kapasite yüzeyi ve boş-durum sözleşmesi kurulmuştur, iş kabul akışı
 * (GDD 23.14 Servis Kabul) sıradaki üretim adımıdır.
 */

import { useGame } from '@state/gameStore';
import { IconClock, IconWorkshop } from '@ui/icons';
import { tl } from '@ui/format';

export function WorkshopScreen() {
  const s = useGame();
  const inService = s.inventory.filter((p) => p.location === 'workshop');
  const used = inService.length;
  const capacity = s.store.workshopCapacity;

  return (
    <div className="page">
      <header className="pageHead">
        <h1 className="pageHead__title">Atölye</h1>
        <p className="pageHead__sub">Servis kuyruğu, kapasite ve teslim sözleri</p>

        <div className="summaryRow">
          <div className="summaryRow__item">
            <span className="summaryRow__label">Kapasite</span>
            <span className="summaryRow__value num">
              {used}/{capacity} slot
            </span>
          </div>
          <div className="summaryRow__item">
            <span className="summaryRow__label">Bugün Teslim</span>
            <span className="summaryRow__value num">0 iş</span>
          </div>
          <div className="summaryRow__item">
            <span className="summaryRow__label">Gecikme Riski</span>
            <span className="summaryRow__value">Yok</span>
          </div>
        </div>

        <div className="liquidityBar">
          <div
            className="liquidityBar__fill liquidityBar__fill--healthy"
            style={{ width: `${capacity > 0 ? (used / capacity) * 100 : 0}%` }}
          />
        </div>
      </header>

      <div className="page__scroll">
        {used === 0 ? (
          <div className="empty">
            <div className="empty__icon">
              <IconWorkshop size={34} />
            </div>
            <p className="empty__title">Kuyruk boş</p>
            <p className="empty__text">
              Servis işleri müşteriden kabul edildiğinde buraya düşer. Atölye pasif gelir
              üretmez — gelir kabul edilen gerçek işten, kullanılan kapasiteden ve
              üstlenilen hata riskinden doğar.
            </p>
          </div>
        ) : (
          <div className="rowList">
            {inService.map((position) => {
              const item = s.items[position.itemId];
              if (!item) return null;
              return (
                <div key={position.itemId} className="row">
                  <span className="row__thumb">
                    <IconClock size={20} />
                  </span>
                  <div className="row__body">
                    <div className="row__title">{item.displayName}</div>
                    <div className="row__meta">Serviste · maliyet {tl(position.costBasis)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="group">
          <h2 className="group__title">Dış Usta</h2>
          <div className="group__body">
            <div className="statLine">
              <span className="statLine__label">Ortalama süre</span>
              <span className="statLine__value">2–3 gün</span>
            </div>
            <div className="statLine">
              <span className="statLine__label">Güvenilirlik</span>
              <span className="statLine__value">Orta</span>
            </div>
            <div className="statLine">
              <span className="statLine__label">Marj etkisi</span>
              <span className="statLine__value statLine__value--warning">Düşük</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
