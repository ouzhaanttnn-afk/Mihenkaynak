import { IconMarket } from '@ui/icons';

/** UPDATEv1 yalnız rotayı hazırlar; katalog ve ekonomi sonraki sürümdedir. */
export function MarketPlaceholderScreen() {
  return (
    <div className="page marketPlaceholder">
      <div className="empty marketPlaceholder__card">
        <span className="empty__icon"><IconMarket size={34} /></span>
        <h1 className="empty__title">MARKET</h1>
        <strong className="marketPlaceholder__soon">Yakında</strong>
        <p className="empty__text">
          Kozmetik ve kişiselleştirme ürünleri burada yer alacak.
        </p>
      </div>
    </div>
  );
}
