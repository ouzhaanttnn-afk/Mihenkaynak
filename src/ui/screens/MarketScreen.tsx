/**
 * MARKET — yalnız boş rota (UPDATEv1 §13).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BU EKRANIN İŞİ SADECE YER TUTMAK.
 *
 * §13 "bu sürümde kesinlikle yapılmayacaklar" listesi açık: katalog yok,
 * ürün veri modeli yok, satın alma yok, oyun içi TL transaction'ı yok,
 * owned/equipped yok, kozmetik ürün yok, fiyat dengesi yok, gerçek para yok.
 *
 * Bu yüzden dosya bilerek bu kadar küçük: içine bir ürün listesi ya da bir
 * `useGame` çağrısı girdiği anda §13 ihlal edilmiş olur. Ekran oyun
 * durumuna HİÇ dokunmaz — ne okur ne yazar.
 *
 * Piyasa ekranıyla KARIŞTIRILMAZ (§10): Piyasa mevcut ekonomi ekranıdır ve
 * İşletme altında kalır; Market gelecekteki kozmetik dükkânıdır.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Art } from '@ui/Art';
import { NAV_ART } from '@ui/assets';
import { IconMarket } from '@ui/icons';

export function MarketScreen() {
  return (
    <div className="page">
      <header className="pageHead">
        <h1 className="pageHead__title">Market</h1>
        <p className="pageHead__sub">Kozmetik ve kişiselleştirme</p>
      </header>

      <div className="page__scroll">
        <div className="empty">
          <div className="empty__icon">
            <Art
              art={NAV_ART.profile}
              size={96}
              decorative
              className="art--hero"
              fallback={<IconMarket size={34} />}
            />
          </div>
          <p className="empty__title">Yakında</p>
          <p className="empty__text">
            Kozmetik ve kişiselleştirme ürünleri burada yer alacak. Bu bölüm
            dükkânın parasını, stoğunu ve ilerlemesini etkilemez.
          </p>
        </div>
      </div>
    </div>
  );
}
