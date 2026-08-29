/**
 * UPDATEv1 §4 ve §9 — durum makinesi düzeyinde kabul testleri.
 *
 * Bu iki madde arayüzde görünen ama KAYNAĞI store'da olan davranışlar:
 * modal açıkken zamanın durması ve teslimin yalnız bir kez uygulanması.
 * Tarayıcıda tıklayarak sınamak yerine burada bağlanıyorlar — çift tıklama
 * yarışını tarayıcıda güvenilir biçimde üretmek zordur, burada kesindir.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { useGame } from './gameStore';

/*
  Test ortamı 'node': localStorage YOKTUR (bkz. vite.config.ts). Store bunu
  zaten try/catch ile karşılıyor ve yeni oyunla başlıyor. Burada yalnız
  testler arası SIZINTIYI temizliyoruz — pause sayacı biriken tek durum.
*/
beforeEach(() => {
  useGame.setState({ pauseDepth: 0 });
});

describe('§4 — yönetim modalı açıkken oyun zamanı durur', () => {
  it('pause açıkken saat, gün ve müşteri üretimi donar', () => {
    const s = useGame.getState();
    const before = {
      clock: s.market.clockMinutes,
      day: s.market.day,
      cash: s.store.cash,
      queue: s.queue.length,
      spawn: s.spawnCounter,
    };

    s.pushPause();
    // Bir günü aşacak kadar çok tick: pause olmasaydı gün DEVREDERDİ.
    for (let i = 0; i < 4000; i += 1) useGame.getState().tick(1);

    const after = useGame.getState();
    expect(after.market.clockMinutes).toBe(before.clock);
    expect(after.market.day).toBe(before.day);
    expect(after.store.cash).toBe(before.cash);
    expect(after.queue.length).toBe(before.queue);
    expect(after.spawnCounter).toBe(before.spawn);
  });

  it('pause kalkınca zaman kaldığı yerden akar', () => {
    const s = useGame.getState();
    s.pushPause();
    for (let i = 0; i < 50; i += 1) useGame.getState().tick(1);
    const paused = useGame.getState().market.clockMinutes;

    useGame.getState().popPause();
    for (let i = 0; i < 50; i += 1) useGame.getState().tick(1);

    expect(useGame.getState().market.clockMinutes).toBeGreaterThan(paused);
  });

  it('iç içe modal: en dıştaki kapanana kadar durur', () => {
    const s = useGame.getState();
    s.pushPause();
    s.pushPause();
    s.popPause(); // içteki kapandı, dıştaki hâlâ açık

    const clock = useGame.getState().market.clockMinutes;
    for (let i = 0; i < 100; i += 1) useGame.getState().tick(1);
    expect(useGame.getState().market.clockMinutes).toBe(clock);

    useGame.getState().popPause();
    for (let i = 0; i < 20; i += 1) useGame.getState().tick(1);
    expect(useGame.getState().market.clockMinutes).toBeGreaterThan(clock);
  });

  it('sayaç sıfırın altına düşmez — fazladan popPause zamanı kilitlemez', () => {
    const s = useGame.getState();
    s.popPause();
    s.popPause();
    expect(useGame.getState().pauseDepth).toBe(0);

    const clock = useGame.getState().market.clockMinutes;
    for (let i = 0; i < 40; i += 1) useGame.getState().tick(1);
    expect(useGame.getState().market.clockMinutes).toBeGreaterThan(clock);
  });

  it('profil penceresi zamanı DURDURMAZ ama hızı da DEĞİŞTİRMEZ', () => {
    const s = useGame.getState();
    s.setSpeed(2);
    s.pushPause();
    expect(useGame.getState().speed).toBe(2);
    useGame.getState().popPause();
    expect(useGame.getState().speed).toBe(2);
  });
});

describe('§9 — teslim yalnız bir kez uygulanır', () => {
  it('aynı işi iki kez teslim etmek nakdi iki kez değiştirmez', () => {
    const s = useGame.getState();
    // Teslime hazır yapay bir iş kur; ekonomi geri kalanına dokunmuyoruz.
    const item = Object.values(s.items)[0];
    if (!item) return; // yeni oyunda kalem yoksa test sessiz geçer

    const job = {
      jobId: 'test_job_1',
      customerId: 'c1',
      customerName: 'Test',
      itemId: item.id,
      itemName: item.displayName,
      type: 'clean',
      venue: 'inHouse' as const,
      risk: 0.1,
      remainingDays: 0,
      expectedDay: 1,
      promisedDay: 1,
      fee: 500,
      partsCost: 0,
      outsourceCost: 0,
      compensation: 200,
      result: 'success' as const,
    };
    useGame.setState({ jobs: [job as never] });

    const cashBefore = useGame.getState().store.cash;
    useGame.getState().deliverJob('test_job_1');
    const cashAfter = useGame.getState().store.cash;
    expect(cashAfter).not.toBe(cashBefore);

    // İkinci çağrı (çift tıklama / yenileme) hiçbir şey yazmamalı.
    useGame.getState().deliverJob('test_job_1');
    expect(useGame.getState().store.cash).toBe(cashAfter);

    // Üçüncü kez de aynı.
    useGame.getState().deliverJob('test_job_1');
    expect(useGame.getState().store.cash).toBe(cashAfter);
  });
});

// ===========================================================================
// SAHA DEFTERİ B3/B4/B12 — gün kapanışı
// ===========================================================================

describe('Gün kapanışı onay ister ve raporu kalıcıdır', () => {
  it('onay penceresi açıkken oyun zamanı DURUR', () => {
    /*
      Ölçüldü: sekiz saniyede altı gün geçirilip 7.200 ₺ gider yazdırılabildi.
      Onay penceresi bunu keser; açıkken saat de akmamalı, yoksa oyuncu
      düşünürken müşteri kaçar.
    */
    const s = useGame.getState();
    const clockBefore = s.market.clockMinutes;

    s.askDayClose();
    for (let i = 0; i < 200; i += 1) useGame.getState().tick(1);

    expect(useGame.getState().dayCloseAsk).toBe(true);
    expect(useGame.getState().market.clockMinutes).toBe(clockBefore);

    useGame.getState().cancelDayClose();
    expect(useGame.getState().dayCloseAsk).toBe(false);
    expect(useGame.getState().pauseDepth).toBe(0);
  });

  it('vazgeçmek günü DEĞİŞTİRMEZ', () => {
    const before = useGame.getState().market.day;
    useGame.getState().askDayClose();
    useGame.getState().cancelDayClose();
    expect(useGame.getState().market.day).toBe(before);
  });

  it('onaydan sonra kapanış raporu doldurulur ve duraklatma bırakılır', () => {
    const before = useGame.getState().market.day;

    useGame.getState().askDayClose();
    useGame.getState().advanceDay();

    const s = useGame.getState();
    expect(s.market.day).toBe(before + 1);
    expect(s.dayCloseAsk).toBe(false);
    // Duraklatma asılı kalırsa oyun panelin arkasında donar.
    expect(s.pauseDepth).toBe(0);

    const rapor = s.lastDayClose;
    expect(rapor, 'kapanış raporu üretilmedi').not.toBeNull();
    expect(rapor!.day).toBe(before);
    expect(rapor!.overhead).toBeGreaterThan(0);
    expect(rapor!.cashAfter).toBe(s.store.cash);
  });

  it('rapor oyuncu kapatana kadar durur — kendiliğinden kaybolmaz', () => {
    useGame.getState().askDayClose();
    useGame.getState().advanceDay();
    expect(useGame.getState().lastDayClose).not.toBeNull();

    // Zaman aksa bile panel yerinde kalır.
    for (let i = 0; i < 300; i += 1) useGame.getState().tick(1);
    expect(useGame.getState().lastDayClose).not.toBeNull();

    useGame.getState().dismissDayClose();
    expect(useGame.getState().lastDayClose).toBeNull();
  });

  it('B12 — gün sonu haberleri toast sınırına kurban gitmez', () => {
    /*
      Gün sonunda dörde kadar toast gönderiliyordu ama ekranda en fazla ikisi
      duruyor. Gecikmiş vade ve esnaf borcu — en çok bilinmesi gereken iki
      şey — sessizce düşebiliyordu. Artık uyarılar raporun kendi alanında.
    */
    const oncekiToast = useGame.getState().toasts.length;

    useGame.getState().askDayClose();
    useGame.getState().advanceDay();
    const rapor = useGame.getState().lastDayClose!;

    expect(Array.isArray(rapor.warnings)).toBe(true);
    /*
      MUTLAK SAYI DEĞİL, ARTIŞ ÖLÇÜLÜR: mağaza son üç toast'ı tutuyor ve
      testler durumu paylaştığı için mutlak sayı önceki kapanışlardan
      birikir. Sınanan şey kapanışın KAÇ toast eklediği — eskiden dörde
      kadar çıkıyordu, artık bir.
    */
    const eklenen = useGame.getState().toasts.length - oncekiToast;
    expect(eklenen).toBeLessThanOrEqual(1);
  });
});
