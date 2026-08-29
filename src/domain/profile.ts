/**
 * Oyuncu profili — GÖRSEL KİMLİK, oyun mekaniği DEĞİL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * KAPSAM SINIRI — bilerek dar tutulmuştur.
 *
 * Bu modül yalnız iki şey tutar: kuyumcunun adı ve seçtiği portre.
 * Karakterlerin seviyesi, XP'si, özelliği, yeteneği, test başarısı ya da
 * herhangi bir karar etkisi YOKTUR ve olmamalıdır. Avatar seçmek bir
 * oyun kararı değil, bir görünüm tercihidir.
 *
 * Pratik sonucu: bu dosya hiçbir ekonomi, değerleme, pazarlık veya
 * ilerleme fonksiyonunu import ETMEZ ve etmemelidir. Böyle bir import
 * belirse, profil sessizce bir mekaniğe dönüşmüş demektir.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Asetv2 paketindeki 11 portre. Sıra paketin manifest.json sırasıdır. */
export const AVATAR_IDS = [
  'male-01', 'male-02', 'male-03', 'male-04', 'male-05', 'male-06',
  'male-07', 'male-08', 'male-09', 'male-10', 'male-11',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export const DEFAULT_AVATAR_ID: AvatarId = 'male-01';

/**
 * UPDATEv3 §2 — DÜKKÂN ADININ TEMEL PARÇASI.
 *
 * Bu alan artık hem kuyumcunun hem dükkânın adıdır ve YALNIZ TEMEL İSMİ
 * tutar: "Alvera". Ekranda görünen "Alvera Kuyumculuk" ondan TÜRETİLİR
 * (`shopDisplayName`), saklanmaz — §2: "save/state tarafında yalnız temel
 * isim saklansın."
 *
 * Varsayılan 'Kuyumcu' değil 'MIHENKAYNAK': türetilmiş hâli
 * "MIHENKAYNAK Kuyumculuk" olur, yani yeni oyunda ve eski kayıtta ekran
 * bugünküyle birebir aynı kalır. ('Kuyumcu' kalsaydı "Kuyumcu Kuyumculuk"
 * yazardı.) Bu, oyunun global markasını değiştirmez — MIHENKAYNAK oyunun
 * adı olmayı sürdürür; burada yalnız oyuncunun dükkânının varsayılanıdır.
 */
export const DEFAULT_JEWELER_NAME = 'MIHENKAYNAK';

/**
 * Dükkân adının sistem tarafından eklenen sabit eki (§2).
 * Oyuncu bunu yazmaz, silemez ve iki kez alamaz.
 */
export const SHOP_SUFFIX = 'Kuyumculuk';

export interface PlayerProfile {
  jewelerName: string;
  avatarId: AvatarId;
}

export function defaultProfile(): PlayerProfile {
  return { jewelerName: DEFAULT_JEWELER_NAME, avatarId: DEFAULT_AVATAR_ID };
}

export const NAME_MIN = 2;
export const NAME_MAX = 24;

export type NameCheck =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Kuyumcu adını doğrular ve temizler.
 *
 * Kurallar tek yerde: baş/son boşluk kırpılır, araya sıkışmış tekrar eden
 * boşluklar teke iner, uzunluk 2–24 arasında olmalıdır.
 *
 * NEDEN İÇ BOŞLUK DA SADELEŞİYOR: "Ahmet      Usta" 24 karakter sınırını
 * boşlukla doldurup arayüzde tek kelimeymiş gibi uzayabiliyordu. Kırpma
 * yalnız uçlardan yapılsaydı sınır anlamını yitirirdi.
 */
export function checkJewelerName(raw: string): NameCheck {
  const value = stripShopSuffix(raw.trim().replace(/\s+/g, ' '));

  if (value.length === 0) {
    return { ok: false, error: 'Kuyumcu adı boş bırakılamaz.' };
  }
  if (value.length < NAME_MIN) {
    return { ok: false, error: `Kuyumcu adı en az ${NAME_MIN} karakter olmalı.` };
  }
  if (value.length > NAME_MAX) {
    return { ok: false, error: `Kuyumcu adı en fazla ${NAME_MAX} karakter olabilir.` };
  }
  return { ok: true, value };
}

/**
 * Sondaki "Kuyumculuk" ekini kırpar (§2).
 *
 * NEDEN GEREKLİ: alan artık dükkân adını soruyor ve yer tutucu örneği
 * "Alvera Kuyumculuk". Oyuncunun eki de yazması çok olası; kırpmasaydık
 * gösterim "Alvera Kuyumculuk Kuyumculuk" olurdu.
 *
 * KIRPMA DOĞRULAMADAN ÖNCE: "Alvera Kuyumculuk" 17 karakter, temel isim 6.
 * Sonra kırpsaydık 24 karakterlik sınır ekin ağırlığını da sayar ve
 * "Abdurrahman Kuyumculuk" gibi meşru bir giriş reddedilirdi.
 *
 * BÜYÜK/KÜÇÜK HARF DUYARSIZ ve Türkçe: 'KUYUMCULUK' ile 'kuyumculuk' aynı
 * ektir; 'I/i' dönüşümü için `toLocaleLowerCase('tr')` kullanılır.
 *
 * TEK SEFER kırpar: "Alvera Kuyumculuk Kuyumculuk" girildiğinde döngüyle
 * hepsini silmek "Kuyumculuk Kuyumculuk" adını da boşaltırdı. Bir ek yeter;
 * kalan metin zaten oyuncunun yazdığı isimdir.
 */
export function stripShopSuffix(value: string): string {
  const lower = value.toLocaleLowerCase('tr');
  const suffix = ` ${SHOP_SUFFIX.toLocaleLowerCase('tr')}`;

  if (lower.endsWith(suffix)) {
    return value.slice(0, value.length - suffix.length).trim();
  }
  // Yalnız ekin kendisi yazıldıysa geriye isim kalmaz; doğrulama yakalar.
  if (lower === SHOP_SUFFIX.toLocaleLowerCase('tr')) return '';
  return value;
}

/**
 * Ekranda görünen dükkân adı: temel isim + sabit ek (§2).
 *
 * Tek kapı olması bilinçli — iki ekranda (Dükkan başlığı, İşletme alt
 * satırı) ayrı ayrı birleştirmek, birinin ekini alıp diğerinin almadığı bir
 * durumu er geç doğururdu.
 */
export function shopDisplayName(baseName: string): string {
  const base = stripShopSuffix(baseName.trim().replace(/\s+/g, ' '));
  return base.length > 0 ? `${base} ${SHOP_SUFFIX}` : `${DEFAULT_JEWELER_NAME} ${SHOP_SUFFIX}`;
}

/** Bilinmeyen avatar kimliğini varsayılana çeker — bozuk kayıt çökertmez. */
export function normalizeAvatarId(id: unknown): AvatarId {
  return AVATAR_IDS.includes(id as AvatarId) ? (id as AvatarId) : DEFAULT_AVATAR_ID;
}

/**
 * Kaydedilmiş (veya eksik / bozuk) profili güvenli hâle getirir.
 * Eski kayıtlarda profil alanı hiç yoktur; o durumda varsayılanlar döner
 * ve kaydın geri kalanına dokunulmaz.
 */
export function normalizeProfile(raw: unknown): PlayerProfile {
  /*
    PARAMETRE `unknown`, `Partial<PlayerProfile>` DEĞİL — bilerek.
    Bu fonksiyonun girdisi diskten okunmuş JSON'dur; orada her şey olabilir
    (elle düzenlenmiş kayıt, eski sürüm, yarım yazılmış dosya). Girdiyi
    `Partial<PlayerProfile>` diye tiplemek, derleyiciye asla doğrulayamadığı
    bir söz verdirmek olurdu; nitekim testte 'yok' gibi geçersiz bir avatar
    kimliğini denemek derlemeyi kırdı — hata testte değil, imzadaydı.
  */
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const name = checkJewelerName(typeof source.jewelerName === 'string' ? source.jewelerName : '');
  return {
    jewelerName: name.ok ? name.value : DEFAULT_JEWELER_NAME,
    avatarId: normalizeAvatarId(source.avatarId),
  };
}
