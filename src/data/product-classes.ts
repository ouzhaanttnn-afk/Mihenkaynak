/**
 * MIHENKAYNAK — Ürün sınıfı → izin verilen özellik / test / servis eşlemesi
 *
 * NEDEN VAR: filtreleme daha önce her tüketicide ayrı ayrı, ürünün
 * NEGATİF özelliklerinden ("taşı yoksa taş alanı çıkmasın") türetiliyordu.
 * Negatif türetme yalnız düşünülmüş vakayı kapatır; düşünülmemiş vaka
 * sızar — servis tarafında olan buydu: `diagnose` yalnız kondisyona ve
 * `requiresStone` bayrağına bakıyordu, ürünün NE OLDUĞUNA bakmıyordu, bu
 * yüzden kusursuz bir Gram Altın'a "Yüzük Ölçüsü" servisi önerilebiliyordu.
 *
 * Bu dosya o kararı tersine çevirir: her ürün sınıfı için İZİN VERİLEN
 * alanlar açıkça sayılır (whitelist). Sayılmayan hiçbir şey gösterilmez.
 * Yeni bir şablon eklendiğinde sınıfı belirlenmediyse en dar sınıfa düşer,
 * fazla alan açılmaz.
 *
 * Kaynak kurallar:
 *   İşlem Akışı ve Terminoloji Ara Düzeltmesi v1.1 §3 — "Bir test ürün
 *   hakkında ANLAMLI YENİ BİLGİ ÜRETMİYORSA varsayılan akışta
 *   gösterilmemeli veya zorunlu tutulmamalıdır." Örnekleri birebir:
 *   "Çeyrek altına yüzük ölçüsü, gram altına taş kontrolü, standart
 *   sarrafiyeye alakasız kondisyon/ölçü alanları."
 *   GDD 5.1 ürün aileleri, GDD 7.1 bilgi alanı ilkesi, GDD 17.1 servis türleri.
 *
 * KAPSAM SINIRI: Bu dosya NE gösterileceğini söyler; hiçbir fiyat, HAS/ayar,
 * değerleme, settlement veya ekonomi kuralına dokunmaz. Saf veri + sınıf
 * çözümlemesidir (GDD 28.1).
 *
 * İKİ KATMAN: whitelist "bu sınıfta gösterilebilir" der; anlamlılık
 * süzgeci (transaction-class.ts) "bu üründe şu an anlamlı" der. Bir alan
 * ancak İKİSİ birden evet derse çizilir. Whitelist üst sınırdır — anlamlılık
 * süzgeci onu genişletemez.
 */

import type { InfoField, ItemFamily } from '@domain/types';
import type { ItemTemplate } from './item-templates';

/**
 * Ürün sınıfları. Aile (GDD 5.1) tek başına yetmez: `classic` ailesinde
 * hem yüzük hem bilezik hem kolye var ve üçünün servis/ölçü ihtiyacı
 * farklı. Bu yüzden sınıf, aile ve silüetin birlikte okunmasıyla çıkar.
 */
export type ProductClass =
  /** Gram altın, külçe — standart külçe sarrafiye. */
  | 'bullionBar'
  /** Çeyrek, yarım, tam, Cumhuriyet, Ata — standart ziynet sarrafiye. */
  | 'bullionCoin'
  /** Yüzük — tek "yüzük ölçüsü" anlamlı olan sınıf. */
  | 'ring'
  /** Bilezik, bangle, set parçası. */
  | 'bracelet'
  /** Zincir, kolye, küpe — kilit/halka taşıyan takı. */
  | 'chainwork'
  /** Obje, dekoratif gümüş — takı değil. */
  | 'decorative'
  /** Koleksiyon / vintage — ekspertiz ürünü. */
  | 'collectible';

export interface ProductClassRules {
  id: ProductClass;
  label: string;
  /**
   * Bu sınıfta GÖSTERİLEBİLİR bilgi alanları. Listede olmayan alan hiçbir
   * koşulda çizilmez, hiçbir araçla açılmaz.
   */
  attributes: InfoField[];
  /**
   * Bu sınıfta KULLANILABİLİR test araçları (tools.ts id'leri). Araç bu
   * listede olsa bile, okuduğu alanların hiçbiri o üründe anlamlı değilse
   * yine gösterilmez.
   */
  tests: string[];
  /**
   * Bu sınıfta UYGULANABİLİR servis türleri (service-types.ts id'leri).
   * Boş liste = bu ürün atölye işi almaz.
   */
  services: string[];
  /**
   * PAZARLIK PAYI (0–1) — kapanış eşiğinin adil değerden ne kadar
   * sapabileceğinin çarpanı.
   *
   *   1    = tam band. Pazarlık bugünkü genişliğinde kalır.
   *   0,15 = eşiğin adil değerden sapması %15'ine iner.
   *
   * NEDEN VAR: pazarlık modeli rezervasyon oranını ARKETİPTEN alıyor ve
   * ürüne kör. İkinci el bir bilezikte %15'lik makas gerçektir — sahibi de
   * alıcı da tam değerini bilmez. Standart sarrafiyede DEĞİLDİR: çeyreğin
   * fiyatını herkes kuruşu kuruşuna bilir. Ölçüm bunu doğruladı — Ata Lira
   * getiren müşteri gerçek değerinin %76'sına razı olabiliyordu, yani
   * dükkânın brüt marjı %13,8 çıkıyordu. Gerçek sektörde gram başı ~100 ₺,
   * yani ~%2,3'lük TUR farkı var.
   *
   * DİKKAT — bu bir "pazarlığı kapat" anahtarı DEĞİLDİR. Güven, aciliyet,
   * gerekçe ve jest hamlelerinin hepsi aynen çalışmaya devam eder; yalnız
   * hepsinin birlikte açabildiği aralık ürünün gerçek makasına oturur.
   * Sarrafiyede gram başına 5–10 ₺ için pazarlık edilir, 500 ₺ için değil.
   */
  haggleRoom: number;

  /** Sınıfın neden bu sınırlara sahip olduğunu anlatan tasarım notu. */
  note: string;
}

/** Sarrafiyede ölçülen tek şey ağırlık ve ayardır; gerisi ürünün tanımında sabittir. */
const BULLION_ATTRIBUTES: InfoField[] = ['weight', 'purity', 'coreIntegrity', 'condition'];

/**
 * Sarrafiyede lup YOKTUR: aracın işi taş ve gizli kondisyon hasarıdır,
 * standart sarrafiyede ikisi de yoktur. §3'ün "gram altına taş kontrolü"
 * yasağı tam olarak bu aracı kapsar.
 */
const BULLION_TESTS = ['scale', 'touchstone', 'density', 'magnet', 'spectrometer'];

export const PRODUCT_CLASS_RULES: Record<ProductClass, ProductClassRules> = {
  bullionBar: {
    id: 'bullionBar',
    label: 'Külçe sarrafiye',
    attributes: BULLION_ATTRIBUTES,
    tests: BULLION_TESTS,
    // Standart külçe atölye işi almaz: temizlenmez, ölçülendirilmez,
    // gravürlenmez. Ambalajı bozulursa değeri düşer, artmaz.
    services: [],
    // Külçe sarrafiyede fiyat kamuya açık; pazarlık kanal makasına sıkışır.
    haggleRoom: 0.12,
    note: 'Gram altın ve külçe. Ağırlık + ayar dışında ölçülecek bir şey yok.',
  },

  bullionCoin: {
    id: 'bullionCoin',
    label: 'Ziynet sarrafiye',
    attributes: BULLION_ATTRIBUTES,
    tests: BULLION_TESTS,
    services: [],
    // Çeyreğin fiyatını herkes bilir. Ölçüm: eski hâlde dükkânın marjı
    // %2–14 arası oynuyordu; artık kanal makasının etrafında kalır.
    haggleRoom: 0.12,
    note: 'Çeyrek/yarım/tam/Cumhuriyet/Ata. Gramajı ve tipi standarttır.',
  },

  ring: {
    id: 'ring',
    label: 'Yüzük',
    attributes: ['weight', 'purity', 'coreIntegrity', 'stone', 'condition'],
    tests: ['scale', 'touchstone', 'density', 'magnet', 'loupe', 'spectrometer'],
    // "Yüzük ölçüsü" YALNIZ burada. Zincir/kilit tamiri yüzükte yok.
    services: ['clean', 'ringSize', 'engraving', 'stoneSet', 'restoration', 'appraisalReport'],
    // İkinci el takı: alıcı da satıcı da tam değerini bilmez. Band aynen kalır.
    haggleRoom: 1,
    note: 'Ölçü servisinin tek geçerli olduğu sınıf; taşlıysa taş testleri açılır.',
  },

  bracelet: {
    id: 'bracelet',
    label: 'Bilezik',
    // §3 — bilezikte yüzük ölçüsü ve taş alanı yok; ölçülen ağırlık, ayar,
    // kondisyon ve (kaplama şüphesinde) iç yapıdır.
    attributes: ['weight', 'purity', 'coreIntegrity', 'condition'],
    tests: ['scale', 'touchstone', 'density', 'magnet', 'loupe', 'spectrometer'],
    services: ['clean', 'chainRepair', 'engraving', 'restoration', 'appraisalReport'],
    haggleRoom: 1,
    note: 'Ağırlık, ayar, kondisyon. Kilidi olduğu için tamir alır; ölçü servisi almaz.',
  },

  chainwork: {
    id: 'chainwork',
    label: 'Zincir / kolye / küpe',
    attributes: ['weight', 'purity', 'coreIntegrity', 'stone', 'condition'],
    tests: ['scale', 'touchstone', 'density', 'magnet', 'loupe', 'spectrometer'],
    services: ['clean', 'chainRepair', 'engraving', 'stoneSet', 'restoration', 'appraisalReport'],
    haggleRoom: 1,
    note: 'Kilit ve halka taşır; uzunluk/kilit tamiri burada anlamlı, yüzük ölçüsü değil.',
  },

  decorative: {
    id: 'decorative',
    label: 'Obje',
    attributes: ['weight', 'purity', 'coreIntegrity', 'condition'],
    tests: ['scale', 'touchstone', 'density', 'magnet', 'loupe', 'spectrometer'],
    // Takı değil: ne ölçüsü ne kilidi var.
    services: ['clean', 'engraving', 'restoration', 'appraisalReport'],
    haggleRoom: 1,
    note: 'Dekoratif gümüş/obje. Takı servisleri uygulanmaz.',
  },

  collectible: {
    id: 'collectible',
    label: 'Koleksiyon',
    attributes: ['weight', 'purity', 'coreIntegrity', 'stone', 'condition'],
    tests: ['scale', 'touchstone', 'density', 'magnet', 'loupe', 'spectrometer'],
    // Koleksiyon parçasında değer özgünlükte: gravür ve ölçü değiştirmek
    // değeri düşürür. Kalanlar belgeleme ve kurtarma işleridir.
    services: ['clean', 'stoneSet', 'restoration', 'appraisalReport'],
    // Tek parça, referans fiyat yok — pazarlık en geniş burada anlamlı.
    haggleRoom: 1,
    note: 'Vintage/koleksiyon. Özgünlüğü bozan servisler kapalı.',
  },
};

/**
 * Şablondan ürün sınıfı. Sıralama önemlidir: sarrafiye ailesi silüetiyle
 * ikiye ayrılır, sonra koleksiyon, en sonda silüete göre takı sınıfları.
 * Eşleşmeyen her şey en dar takı sınıfına düşer — whitelist mantığında
 * belirsizlik daima DAHA AZ alan demektir.
 */
export function productClassOf(template: {
  family: ItemFamily;
  silhouette: ItemTemplate['silhouette'];
}): ProductClass {
  if (template.family === 'bullion') {
    return template.silhouette === 'coin' ? 'bullionCoin' : 'bullionBar';
  }

  if (template.family === 'collectible') return 'collectible';

  switch (template.silhouette) {
    case 'ring':
      return 'ring';
    case 'bracelet':
      return 'bracelet';
    case 'chain':
    case 'necklace':
    case 'earring':
      return 'chainwork';
    case 'object':
    case 'brooch':
      return 'decorative';
    // Sarrafiye dışında külçe/sikke silüeti bir şablon hatasıdır; onu takı
    // gibi açmaktansa en dar sınıfta tutmak doğrudur.
    case 'bar':
    case 'coin':
      return 'decorative';
  }
}

export function rulesFor(template: {
  family: ItemFamily;
  silhouette: ItemTemplate['silhouette'];
}): ProductClassRules {
  return PRODUCT_CLASS_RULES[productClassOf(template)];
}
