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

import { useEffect, useMemo } from 'react';

import { activeLine, useGame } from '@state/gameStore';
import { getTemplate } from '@data/item-templates';
import { syncAudioSettings, unlockAudio } from '@ui/audio';
import { setLocale } from '@ui/i18n';
import { stageLabel } from '@ui/shell/StageStrip';
import { BottomNav } from '@ui/shell/BottomNav';
import { overdueJobs, readyJobs } from '@domain/service';
import { BusinessScreen } from '@ui/screens/BusinessScreen';
import { ShopScreen } from '@ui/screens/ShopScreen';
import { MarketScreen } from '@ui/screens/MarketScreen';
import { StockScreen } from '@ui/screens/StockScreen';
import { WorkshopScreen } from '@ui/screens/WorkshopScreen';
import { ProfileDialog } from '@ui/shell/ProfileDialog';

import '@ui/tokens.css';
import '@ui/shell/AppShell.css';
import '@ui/workbench/Workbench.css';
import '@ui/screens/Screens.css';

export function App() {
  const tab = useGame((s) => s.tab);
  const setTab = useGame((s) => s.setTab);
  const toasts = useGame((s) => s.toasts);
  const dismissToast = useGame((s) => s.dismissToast);
  const profile = useGame((s) => s.profile);
  const profileOpen = useGame((s) => s.profileOpen);
  const closeProfile = useGame((s) => s.closeProfile);
  const updateProfile = useGame((s) => s.updateProfile);

  /*
    ATÖLYE ROZETİ — teslime hazır ve sözü geçmiş işler.

    Ölçüldü: 30 günde 224 iş kabul edildi, parça maliyeti kabulde kasadan
    çıktı, ücret teslimde gelecekti ve hiçbiri teslim edilmedi çünkü oyun
    bunu hiç haber vermiyordu; `overdueJobs()` yalnız Atölye ekranı açıkken
    okunuyordu. Gecikme cezası da yalnız teslim anında işlediği için,
    teslim edilmeyen iş hem bedava hem görünmezdi.

    Rozet SAYAR, ekonomiye dokunmaz.
  */
  const jobs = useGame((s) => s.jobs);
  const day = useGame((s) => s.market.day);
  const navBadges = useMemo(() => {
    const hazir = readyJobs(jobs).length;
    const geciken = overdueJobs(jobs, day).length;
    if (hazir === 0 && geciken === 0) return undefined;
    // Geciken iş varsa aciliyet rengi kazanır; sayı yine bekleyen toplamıdır.
    return { workshop: { count: Math.max(hazir, geciken), urgent: geciken > 0 } };
  }, [jobs, day]);

  /*
    AYARLARI AÇILIŞTA UYGULA.

    Mağaza ayarları depodan OKUR ama uygulamaz: dil ve ses motoru mağazanın
    dışında yaşıyor. Bu etki olmadan oyuncunun kaydettiği dil bir sonraki
    açılışta ekrana yansımaz — ayar duruyor ama işlemiyor olurdu.
  */
  const settings = useGame((s) => s.settings);
  useEffect(() => {
    setLocale(settings.locale);
    syncAudioSettings(settings);
  }, [settings]);

  /*
    SES KİLİDİNİ İLK DOKUNUŞTA AÇ.

    Tarayıcılar kullanıcı bir şeye dokunmadan ses açtırmaz; `resume()`
    sessizce reddedilir. Dinleyici bir kez çalışır ve kendini kaldırır —
    her dokunuşta yeniden denemek gereksiz iş olurdu.
  */
  useEffect(() => {
    const onFirstInput = () => unlockAudio();
    window.addEventListener('pointerdown', onFirstInput, { once: true });
    window.addEventListener('keydown', onFirstInput, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstInput);
      window.removeEventListener('keydown', onFirstInput);
    };
  }, []);

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
          {tab === 'market' && <MarketScreen />}
          {tab === 'business' && <BusinessScreen />}
        </div>

        {/*
          UPDATEv2 §7 — "Aktif işlem varsa: aktif müşteri ve ürün, mevcut
          aşama, İşleme Dön."

          NEDEN DÜKKAN'DA DEĞİL DE BURADA: Dükkan sekmesinde açık bir işlem
          varken ekran ZATEN o işlemdir — müşteri Müşteri Şeridi'nde, ürün
          ve aşama Aşama Şeridi'ndedir ve dönülecek bir yer yoktur. "İşleme
          Dön" ancak oyuncu işlemi bırakıp Stok'a, Atölye'ye, Market'e ya da
          İşletme'ye geçtiğinde bir şey ifade eder; müşteri tezgâhta
          beklerken oyuncunun onu unutması buranın gerçek hatasıydı.
        */}
        {tab !== 'shop' && <ResumeDealBar onResume={() => setTab('shop')} />}

        <BottomNav active={tab} onSelect={setTab} badges={navBadges} />

        {/*
          Profil penceresi CİHAZ SEVİYESİNDE: ekranın değil, çerçevenin
          çocuğu. Ekranın içine konsaydı Dükkan'ın `overflow: hidden`
          gövdesine hapsolur ve alt navigasyonun altında kalırdı.
        */}
        {profileOpen && (
          <ProfileDialog
            profile={profile}
            onCancel={closeProfile}
            onSave={updateProfile}
          />
        )}

        {/*
          En fazla İKİ toast görünür.
          Kapatma zamanlayıcısı `toasts` her değiştiğinde sıfırlandığı için
          arka arkaya yapılan işlemlerde balonlar birikiyordu; üst üste binen
          üç balon Stok özetini tamamen gömüyordu. Sınır, biriktirmeyi
          içeriğin üstünü kapatmadan durdurur — sıradakiler yine gösterilir,
          yalnız öndekiler düştükçe.
        */}
        {toasts.length > 0 && (
          <div className="toastLayer">
            {toasts.slice(0, 2).map((toast) => (
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

/**
 * Açık işlemi olan oyuncuyu tezgâha çağıran ince çubuk (§7).
 * İşlem yoksa hiç çizilmez — boş yer kaplamaz.
 */
function ResumeDealBar({ onResume }: { onResume: () => void }) {
  const deal = useGame((s) => s.activeDeal);
  const customer = useGame((s) => s.activeCustomer);
  const items = useGame((s) => s.items);

  if (!deal || !customer) return null;

  const line = activeLine(deal);
  /*
    Ürünün adı: ticaret/servis/ekspertizde müşterinin getirdiği kalem,
    alışta paketten seçilen ilk kalem. Hiçbiri yoksa ad yazılmaz — burada
    uydurulacak bir ürün yok.
  */
  const item = line ? items[line.itemId] : undefined;
  const itemName = item
    ? getTemplate(item.templateId).displayName
    : (deal.purchase?.demand.alternativesLabel ?? null);

  return (
    <button type="button" className="resumeBar" onClick={onResume}>
      <span className="resumeBar__body">
        <span className="resumeBar__title">
          {customer.displayName}
          {itemName ? ` · ${itemName}` : ''}
        </span>
        <span className="resumeBar__stage">Aşama: {stageLabel(deal.flow, deal.stage)}</span>
      </span>
      <span className="resumeBar__cta" aria-hidden="true">
        İşleme Dön ›
      </span>
    </button>
  );
}
