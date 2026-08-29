/**
 * H — Alt Navigasyon (GDD 23.9.1, 64 px)
 *
 * DEĞİŞMEZ — GDD 23.9.1:
 *   "Alt navigasyon TAM OLARAK 4 kök içerir: Dükkan / Stok / Atölye / İşletme.
 *    Hamburger menü kullanılmaz."
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
import type { RootTab } from '@state/gameStore';

/**
 * UPDATEv1 §13 — ZORUNLU SIRA: Dükkan / Stok / Atölye / Market / İşletme.
 * Market, Atölye ile İşletme ARASINDA durur.
 */
const ROOTS: { id: RootTab; label: string; Icon: typeof IconShop }[] = [
  { id: 'shop', label: 'Dükkan', Icon: IconShop },
  { id: 'stock', label: 'Stok', Icon: IconStock },
  { id: 'workshop', label: 'Atölye', Icon: IconWorkshop },
  { id: 'market', label: 'Market', Icon: IconMarket },
  { id: 'business', label: 'İşletme', Icon: IconBusiness },
];

interface Props {
  active: RootTab;
  onSelect: (tab: RootTab) => void;
}

export function BottomNav({ active, onSelect }: Props) {
  return (
    <nav className="bottomNav" aria-label="Ana navigasyon">
      {ROOTS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`bottomNav__item ${active === id ? 'bottomNav__item--active' : ''}`}
          onClick={() => onSelect(id)}
          aria-current={active === id ? 'page' : undefined}
        >
          <Icon size={21} />
          <span className="bottomNav__label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
