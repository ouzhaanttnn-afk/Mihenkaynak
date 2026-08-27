/**
 * MIHENKAYNAK — Uygulama kökü
 *
 * GDD 23.9.2 global kabuğu burada birleşir. Dört kök ekran (Dükkan / Stok /
 * Atölye / İşletme) aynı cihaz çerçevesini paylaşır; alt navigasyon aktif
 * işlemde de yerini korur (GDD 23.9.2).
 *
 * GDD 23.22: Aktif Dükkan dikey scroll kullanmaz → cihaz gövdesi
 * `overflow: hidden`; ikincil ekranlar kendi scroll'unu yönetir.
 */

import { useEffect } from 'react';

import { useGame } from '@state/gameStore';
import { BottomNav } from '@ui/shell/BottomNav';
import { BusinessScreen } from '@ui/screens/BusinessScreen';
import { ShopScreen } from '@ui/screens/ShopScreen';
import { StockScreen } from '@ui/screens/StockScreen';
import { WorkshopScreen } from '@ui/screens/WorkshopScreen';

import '@ui/tokens.css';
import '@ui/shell/AppShell.css';
import '@ui/workbench/Workbench.css';
import '@ui/screens/Screens.css';

export function App() {
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  const toasts = useGame((s) => s.toasts);
  const dismissToast = useGame((s) => s.dismissToast);

  // Toast'lar kısa geri bildirimdir; kendiliğinden kapanır.
  useEffect(() => {
    if (toasts.length === 0) return;
    const id = window.setTimeout(() => {
      const first = toasts[0];
      if (first) dismissToast(first.id);
    }, 4000);
    return () => window.clearTimeout(id);
  }, [toasts, dismissToast]);

  return (
    <div className="deviceFrame">
      <div className="device">
        <div className={`screen ${tab === 'shop' ? 'screen--noScroll' : ''}`}>
          {tab === 'shop' && <ShopScreen />}
          {tab === 'stock' && <StockScreen />}
          {tab === 'workshop' && <WorkshopScreen />}
          {tab === 'business' && <BusinessScreen />}
        </div>

        <BottomNav active={tab} onSelect={setTab} />

        {toasts.length > 0 && (
          <div className="toastLayer">
            {toasts.map((toast) => (
              <div key={toast.id} className={`toast toast--${toast.tone}`}>
                {toast.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
