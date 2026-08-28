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
 * gösterir. GDD tek doğruluk kaynağı olduğu için 23.9.1'deki dört kök
 * uygulanmıştır; Yetenekler ve Profil İşletme'nin ikincil rotalarıdır.
 */

import { IconBusiness, IconMarket, IconShop, IconStock, IconWorkshop } from '@ui/icons';
import type { RootTab } from '@state/gameStore';

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
