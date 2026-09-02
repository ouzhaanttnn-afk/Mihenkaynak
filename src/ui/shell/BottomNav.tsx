/**
 * H — Alt Navigasyon (UPDATEv1, 64 px)
 *
 * UPDATEv1: Beş kök içerir: Dükkan / Stok / Atölye / Market / İşletme.
 *   "Piyasa, Toptancı, Kariyer ve İşlem Defteri ikincil rotalardır."
 *
 * GDD 23.9.2: "Aktif işlemde de yerini korur."
 *
 * NOT: Asset paketindeki stok ekranı referansı Dükkan/Stok/Yetenekler/Profil
 * gösterir. Yetenekler ve Profil İşletme'nin ikincil rotalarıdır.
 *
 * GDD 23.9.1'DEN BİLİNÇLİ SAPMA (UPDATEv1 §13): madde "alt navigasyon TAM
 * OLARAK 4 kök içerir" diyor; §13 beşinci kökü (Market) açıkça istiyor ve
 * yerini de belirtiyor. Sapma burada kayıt altındadır. Öge yüksekliği şerit
 * yüksekliğine eşit kaldığı için beş sekmede de dokunma hedefi 44 px'in
 * üstündedir; genişlik `flex: 1 1 0` ile eşit bölünür.
 */

import { IconBusiness, IconMarket, IconShop, IconStock, IconWorkshop } from '@ui/icons';
import { t } from '@ui/i18n';
import { Art } from '@ui/Art';
import { NAV_ART, type Art as ArtAsset } from '@ui/assets';
import type { RootTab } from '@state/gameStore';

/**
 * UPDATEv1 §13 — ZORUNLU SIRA: Dükkan / Stok / Atölye / Market / İşletme.
 * Market, Atölye ile İşletme ARASINDA durur.
 *
 * Simge artık gerçekçi asset; `Icon` çizgi sürümü yalnız FALLBACK'tir.
 */
const ROOTS: { id: RootTab; key: string; label: string; Icon: typeof IconShop; art: ArtAsset }[] = [
  { id: 'shop', key: 'nav.shop', label: 'Dükkan', Icon: IconShop, art: NAV_ART.shop },
  { id: 'stock', key: 'nav.stock', label: 'Stok', Icon: IconStock, art: NAV_ART.stock },
  { id: 'workshop', key: 'nav.workshop', label: 'Atölye', Icon: IconWorkshop, art: NAV_ART.workshop },
  { id: 'market', key: 'nav.market', label: 'Market', Icon: IconMarket, art: NAV_ART.market },
  { id: 'business', key: 'nav.business', label: 'İşletme', Icon: IconBusiness, art: NAV_ART.business },
];

interface Props {
  active: RootTab;
  onSelect: (tab: RootTab) => void;
  /**
   * Sekme başına bekleyen iş sayısı. Ölçüldü: 30 günde 224 servis işi kabul
   * edildi, parça maliyeti kasadan çıktı, hiçbiri teslim edilmedi ve oyun
   * bunu HİÇ haber vermedi — `overdueJobs()` yalnız Atölye ekranı açıkken
   * okunuyordu. Rozet, o bilgiyi ekranı açmadan görünür kılar.
   *
   * Sekmeye özel DEĞİL, genel: yarın Stok ya da İşletme de rozet isterse
   * ikinci bir alan açmak gerekmesin.
   */
  badges?: Partial<Record<RootTab, { count: number; urgent: boolean }>>;
}

export function BottomNav({ active, onSelect, badges }: Props) {
  return (
    <nav className="bottomNav" aria-label="Ana navigasyon">
      {ROOTS.map(({ id, key, label, Icon, art }) => {
        const badge = badges?.[id];
        const name = t(key, label);
        return (
          <button
            key={id}
            type="button"
            className={`bottomNav__item ${active === id ? 'bottomNav__item--active' : ''}`}
            onClick={() => onSelect(id)}
            aria-current={active === id ? 'page' : undefined}
            // Rozet salt görsel kalmasın: ekran okuyucu da sayıyı duysun.
            aria-label={badge ? `${name} · ${badge.count} bekleyen` : undefined}
          >
            <span className="bottomNav__iconWrap">
              <Art
                art={art}
                size={29}
                decorative
                className="bottomNav__art art--onDark"
                fallback={<Icon size={21} />}
              />
              {badge && badge.count > 0 && (
                <span
                  className={`bottomNav__badge num ${badge.urgent ? 'bottomNav__badge--urgent' : ''}`}
                  aria-hidden="true"
                >
                  {badge.count > 9 ? '9+' : badge.count}
                </span>
              )}
            </span>
            <span className="bottomNav__label">{name}</span>
          </button>
        );
      })}
    </nav>
  );
}
