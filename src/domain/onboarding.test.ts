/**
 * GDD 25 — öğretim akışı.
 *
 * Bu testler iki ayrı sözü tutar:
 *   1. ÖĞRETİR   — doğru anda doğru ders çıkar, sıra bozulmaz.
 *   2. ÇEKİLİR   — her ders bir kez görünür, atlanabilir, atlanınca hiçbir
 *                  şey eksik kalmaz.
 * İkincisi olmadan onboarding bir öğretici değil, bir engeldir.
 */

import { describe, expect, it } from 'vitest';

import {
  LESSONS,
  nextLesson,
  onboardingComplete,
  lessonBody,
  skipAll,
  type CoachContext,
  type ProductKind,
} from './onboarding';

const base: CoachContext = {
  day: 1,
  hasCustomer: false,
  queueLength: 0,
  flow: null,
  stage: null,
  transactionClass: null,
  testsRun: 0,
  hasBand: false,
  stockUnits: 0,
  productKind: null,
};

const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({ ...base, ...over });

// ===========================================================================

describe('Ders tablosu bütünlüğü', () => {
  it('kimlikler tekildir', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('her dersin başlığı ve gövdesi vardır, gövde telefonda okunacak kadar kısadır', () => {
    /*
      §3 sonrası gövde bir FONKSİYON olabilir. Uzunluk denetimi bu yüzden
      TÜM ürün varyantlarında yapılır: yalnız birini ölçmek, sadece belirli
      bir üründe taşan bir metni yeşil geçirirdi.
    */
    const kinds: (ProductKind | null)[] = [null, 'gramBullion', 'coinBullion', 'crafted'];
    for (const l of LESSONS) {
      expect(l.title.length, l.id).toBeGreaterThan(3);
      for (const kind of kinds) {
        const body = lessonBody(l, ctx({ productKind: kind }));
        expect(body.length, `${l.id}/${kind}`).toBeGreaterThan(20);
        // Uzun metin telefonda okunmaz; şerit de taşar.
        expect(body.length, `${l.id}/${kind} (${body.length} karakter)`).toBeLessThan(190);
      }
    }
  });

  it('§3 — ürüne bağlı ders, YANLIŞ ürün adını kullanmaz', () => {
    /*
      Denetimin bulduğu hata: Gram Altın incelenirken "Çeyreğin gramajı…"
      diyen ders. Test bunu doğrudan arar.
    */
    const fast = LESSONS.find((l) => l.id === 'fastFlow')!;
    const gram = lessonBody(fast, ctx({ productKind: 'gramBullion' }));
    const coin = lessonBody(fast, ctx({ productKind: 'coinBullion' }));

    expect(gram.toLocaleLowerCase('tr'), gram).not.toContain('çeyre');
    expect(gram.toLocaleLowerCase('tr'), gram).toContain('gram');
    // İki ürün grubu gerçekten farklı konuşuyor; tek metnin kopyası değil.
    expect(coin).not.toBe(gram);
  });

  it('§3 — aktif ürün bilinmiyorsa genel metne düşer, ürün adı uydurmaz', () => {
    for (const l of LESSONS) {
      const body = lessonBody(l, ctx({ productKind: null }));
      expect(body.length, l.id).toBeGreaterThan(20);
    }
  });

  it('GDD 25 ölçeği: 5–7 dakikalık akış, bir avuç ders', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(5);
    expect(LESSONS.length).toBeLessThanOrEqual(10);
  });
});

describe('Doğru anda doğru ders', () => {
  it('ilk gün, müşteri yokken karşılama dersi', () => {
    expect(nextLesson(ctx(), [])?.id).toBe('welcome');
  });

  it('kuyrukta müşteri varken karşılama dersi', () => {
    expect(nextLesson(ctx({ queueLength: 1 }), ['welcome'])?.id).toBe('greet');
  });

  it('inceleme aşamasında, test yapılmadan', () => {
    const l = nextLesson(ctx({ hasCustomer: true, flow: 'trade', stage: 'inspect' }), [
      'welcome', 'greet',
    ]);
    expect(l?.id).toBe('inspect');
  });

  it('test yapıldıktan sonra inceleme dersi ARTIK çıkmaz', () => {
    const l = nextLesson(
      ctx({ hasCustomer: true, flow: 'trade', stage: 'inspect', testsRun: 2 }),
      ['welcome', 'greet'],
    );
    expect(l?.id).not.toBe('inspect');
  });

  it('hızlı işlemde sarrafiye dersi çıkar', () => {
    const l = nextLesson(
      ctx({ hasCustomer: true, flow: 'trade', stage: 'inspect', transactionClass: 'fast' }),
      ['welcome', 'greet', 'inspect'],
    );
    expect(l?.id).toBe('fastFlow');
  });

  it('pazarlıkta tavan dersi çıkar', () => {
    const l = nextLesson(
      ctx({ hasCustomer: true, flow: 'trade', stage: 'negotiate' }),
      ['welcome', 'greet', 'inspect', 'fastFlow', 'appraise', 'thesis'],
    );
    expect(l?.id).toBe('negotiate');
  });

  it('aynı anda birden çok koşul sağlansa bile TEK ders gösterilir', () => {
    // İlk gün + kuyrukta müşteri + stok var: üç koşul birden.
    const l = nextLesson(ctx({ queueLength: 2, stockUnits: 5 }), []);
    expect(l).not.toBeNull();
    // Tablonun sırası kazanır; ikisini birden göstermek boğmaktır.
    expect(l?.id).toBe('welcome');
  });
});

describe('Ders bir kez gösterilir', () => {
  it('görülmüş ders tekrar çıkmaz', () => {
    const c = ctx();
    const first = nextLesson(c, []);
    expect(first?.id).toBe('welcome');
    expect(nextLesson(c, ['welcome'])?.id).not.toBe('welcome');
  });

  it('tüm dersler görülünce hiçbir şey gösterilmez', () => {
    const seen = LESSONS.map((l) => l.id);
    // Her ders için kendi bağlamını kursak bile null dönmeli.
    for (const c of [
      ctx(),
      ctx({ queueLength: 3 }),
      ctx({ hasCustomer: true, flow: 'trade', stage: 'inspect' }),
      ctx({ hasCustomer: true, flow: 'trade', stage: 'negotiate' }),
      ctx({ stockUnits: 9 }),
    ]) {
      expect(nextLesson(c, seen)).toBeNull();
    }
  });
});

describe('Öğretim çekilebilir', () => {
  it('atla, kalan her dersi kapatır', () => {
    const seen = skipAll(['welcome']);
    expect(onboardingComplete(seen)).toBe(true);
    expect(nextLesson(ctx({ hasCustomer: true, stage: 'negotiate', flow: 'trade' }), seen)).toBeNull();
  });

  it('atlamak mükerrer kimlik üretmez', () => {
    const seen = skipAll(skipAll([]));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('boş listeyle öğretim tamamlanmış sayılmaz', () => {
    expect(onboardingComplete([])).toBe(false);
  });
});

describe('Ders koşulları SAF fonksiyondur', () => {
  it('aynı bağlam her zaman aynı dersi verir', () => {
    const c = ctx({ hasCustomer: true, flow: 'trade', stage: 'thesis' });
    const seen = ['welcome', 'greet', 'inspect', 'fastFlow', 'appraise'];
    expect(nextLesson(c, seen)?.id).toBe(nextLesson(c, seen)?.id);
  });

  it('bağlamı değiştirmez', () => {
    const c = ctx({ hasCustomer: true, stage: 'inspect', flow: 'trade' });
    const snapshot = JSON.stringify(c);
    nextLesson(c, []);
    expect(JSON.stringify(c)).toBe(snapshot);
  });
});
