/**
 * AYARLAR — kapsam sınırı ve bozuk veriye dayanıklılık.
 *
 * Bu testlerin ASIL işi düğmelerin çalıştığını göstermek değil; ayarların
 * OYUNA KARIŞMADIĞINI ve bozuk bir tercih dosyasının oyunu çökertmediğini
 * göstermek.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  LOCALES,
  effectiveVolume,
  normalizeLocale,
  normalizeSettings,
} from './settings';
import { useGame } from '@state/gameStore';
import { getLocale, localeKeys, missingKeys, setLocale, t } from '@ui/i18n';

describe('Bozuk veya eksik tercih oyunu çökertmez', () => {
  it('hiçbir şey verilmezse varsayılanlar döner', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('bozuk')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('EKSİK alan varsayılana düşer, kayıt REDDEDİLMEZ', () => {
    /*
      İleride yeni bir ayar eklendiğinde eski tercih dosyası o alanı
      taşımayacak. Tamamını reddetmek, oyuncunun kaydettiği dili ve ses
      seviyesini yeni sürümde silmek olurdu.
    */
    const kismi = normalizeSettings({ music: false, locale: 'en' });
    expect(kismi.music).toBe(false);
    expect(kismi.locale).toBe('en');
    expect(kismi.sfx).toBe(DEFAULT_SETTINGS.sfx);
    expect(kismi.sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
    expect(kismi.haptics).toBe(DEFAULT_SETTINGS.haptics);
  });

  it('ses seviyesi 0-1 dışına çıkamaz', () => {
    expect(normalizeSettings({ musicVolume: 9 }).musicVolume).toBe(1);
    expect(normalizeSettings({ musicVolume: -3 }).musicVolume).toBe(0);
    expect(normalizeSettings({ sfxVolume: Number.NaN }).sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
    expect(normalizeSettings({ sfxVolume: Number.POSITIVE_INFINITY }).sfxVolume).toBe(
      DEFAULT_SETTINGS.sfxVolume,
    );
  });

  it('bilinmeyen dil varsayılana çekilir', () => {
    expect(normalizeLocale('klingon')).toBe(DEFAULT_SETTINGS.locale);
    expect(normalizeLocale(7)).toBe(DEFAULT_SETTINGS.locale);
    for (const code of LOCALES) expect(normalizeLocale(code)).toBe(code);
  });

  it('kapalı kanal SIFIR ses verir — seviye ne olursa olsun', () => {
    const kapali = normalizeSettings({ music: false, musicVolume: 1, sfx: false, sfxVolume: 1 });
    expect(effectiveVolume(kapali, 'music')).toBe(0);
    expect(effectiveVolume(kapali, 'sfx')).toBe(0);

    const acik = normalizeSettings({ music: true, musicVolume: 0.4 });
    expect(effectiveVolume(acik, 'music')).toBeCloseTo(0.4, 6);
  });
});

describe('Ayarlar OYUNA karışmaz', () => {
  beforeEach(() => {
    useGame.getState().resetGame();
    useGame.setState({ pauseDepth: 0 });
  });

  it('ayar değiştirmek nakde, stoğa, güne, XPye ve deftere dokunmaz', () => {
    const before = useGame.getState();
    const snapshot = {
      cash: before.store.cash,
      xp: before.store.xp,
      level: before.store.level,
      reputation: before.store.reputation,
      day: before.market.day,
      seed: before.seed,
      spawnCounter: before.spawnCounter,
      inventory: JSON.stringify(before.inventory),
      applied: before.ledger.appliedTxIds.length,
      realized: before.ledger.realizedProfitTotal,
    };

    useGame.getState().updateSettings({ music: false });
    useGame.getState().updateSettings({ sfxVolume: 0.1 });
    useGame.getState().updateSettings({ haptics: false });
    useGame.getState().updateSettings({ locale: 'en' });

    const after = useGame.getState();
    expect(after.store.cash).toBe(snapshot.cash);
    expect(after.store.xp).toBe(snapshot.xp);
    expect(after.store.level).toBe(snapshot.level);
    expect(after.store.reputation).toBe(snapshot.reputation);
    expect(after.market.day).toBe(snapshot.day);
    expect(after.seed).toBe(snapshot.seed);
    expect(after.spawnCounter).toBe(snapshot.spawnCounter);
    expect(JSON.stringify(after.inventory)).toBe(snapshot.inventory);
    expect(after.ledger.appliedTxIds.length).toBe(snapshot.applied);
    expect(after.ledger.realizedProfitTotal).toBe(snapshot.realized);
  });

  it('değişiklik durumda tutulur ve normalize edilir', () => {
    useGame.getState().updateSettings({ musicVolume: 5, locale: 'yok' as never });
    const s = useGame.getState().settings;
    expect(s.musicVolume).toBe(1);
    expect(s.locale).toBe(DEFAULT_SETTINGS.locale);
  });
});

describe('Dil katmanı', () => {
  beforeEach(() => setLocale('tr'));

  it('Türkçede metin ÇAĞRI YERİNDEKİ varsayılandır', () => {
    // Türkçe sözlüğü boştur ve boş kalmalıdır: metni iki yerde tutmak,
    // birinin diğerinden sapmasına izin vermektir.
    expect(localeKeys('tr')).toHaveLength(0);
    expect(t('nav.shop', 'Dükkan')).toBe('Dükkan');
  });

  it('İngilizcede sözlük kazanır', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('nav.shop', 'Dükkan')).toBe('Shop');
    expect(t('settings.title', 'Ayarlar')).toBe('Settings');
  });

  it('SÖZLÜKTE OLMAYAN anahtar ekranı boşaltmaz, Türkçesine düşer', () => {
    /*
      En önemli güvenlik özelliği bu: 356 arayüz metni tek seferde
      taşınmadığı için sözlükte olmayan anahtarlar VAR ve olmaya devam
      edecek. Oyuncunun 'shop.someKey' gibi bir kimlik görmesi kabul edilemez.
    */
    setLocale('en');
    expect(t('bu.anahtar.yok', 'Türkçe karşılık')).toBe('Türkçe karşılık');
  });

  it('şu an kullanılan anahtarların hepsi İngilizce sözlükte var', () => {
    const used = [
      'nav.shop', 'nav.stock', 'nav.workshop', 'nav.market', 'nav.business',
      'strip.day', 'strip.cash', 'strip.speed', 'strip.editProfile',
      'settings.title', 'settings.subtitle', 'settings.audio', 'settings.music',
      'settings.musicVolume', 'settings.sfx', 'settings.sfxVolume', 'settings.haptics',
      'settings.hapticsNote', 'settings.hapticsUnsupported', 'settings.language',
      'settings.languageNote', 'settings.audioPending', 'settings.on', 'settings.off',
    ];
    expect(missingKeys('en', used)).toEqual([]);
  });
});
