/**
 * MIHENKAYNAK — Kayıt / yükleme
 * Kaynak: GDD 28.1 "kayıt sistemi", 28.3 determinizm;
 *         Ekonomi Ara Düzeltmesi v1.0 · §11 "Kaydet/yükle".
 *
 * §11 DEĞİŞMEZ: "Kaydet/yükle: REJİM, RNG STATE/SEED YAKLAŞIMI, AÇIK
 * BORÇLAR, VADELER, LİMİTLER ve POZİSYONLAR tutarlı biçimde geri yüklenir."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN TÜRETİLEBİLİR ALANLAR KAYDEDİLMEZ
 *
 * Bu oyunda piyasa, müşteri ve gün karakteri (seed, gün) ikilisinden
 * TÜRETİLİR (GDD 13.4 / 28.3). Türetilebilir bir şeyi kaydetmek iki kopya
 * yaratır ve bir gün ikisi ayrışır — o an oyuncu kaydı yükleyip farklı bir
 * piyasa görür, yani reload avantajı doğar.
 *
 * Bu yüzden kayıt yalnız TÜRETİLEMEYEN şeyi taşır: oyuncunun kararlarının
 * biriktirdiği durum. Piyasa ve gün karakteri yüklemede seed'den yeniden
 * kurulur; §11'in "rejim tutarlı geri yüklenir" şartı bu yolla, kopya
 * tutarak değil, YENİDEN TÜRETEREK karşılanır.
 *
 * KAYDEDİLMEYEN, BİLEREK: aktif müşteri ve yarım kalan pazarlık. Yarım bir
 * pazarlığı kaydetmek, oyuncuya "beğenmediğim teklifi geri al" kapısı
 * açardı — GDD 34.3'ün kapattığı şey.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createMarketForDay } from '@domain/market';
import { dayCharacter, emptyTelemetry } from '@domain/intent';
import { createLedger, type Ledger } from '@domain/settlement';
import type { GameState } from './gameStore';
import type { CustomerRegistry } from '@domain/customer-memory';
import type {
  InventoryPosition,
  ItemInstance,
  ServiceJob,
  StoreState,
  TradeNetworkMember,
} from '@domain/types';

/** Kayıt formatı sürümü. Artırıldığında migrate() bir adım daha kazanır. */
export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;
  /** GDD 28.3 — RNG'nin tek kaynağı. Seed olmadan hiçbir şey türetilemez. */
  seed: number;
  /** Türetim anahtarının ikinci yarısı. */
  day: number;
  clockMinutes: number;
  /** Deterministik spawn zinciri kaldığı yerden devam etsin diye. */
  spawnCounter: number;
  jobCounter: number;

  /** Limitler, vadeler ve açık borçlar burada (§11). */
  store: StoreState;
  /** Pozisyonlar (§11). */
  inventory: InventoryPosition[];
  items: Record<string, ItemInstance>;
  ledger: Ledger;
  jobs: ServiceJob[];
  /** §8 ağı: üye ilişkileri, kasaları ve açık borçları. */
  network: TradeNetworkMember[];
  /**
   * GDD 10 — müşteri hafızası. Kaydedilmezse her yüklemede tüm müşteriler
   * yeniden yabancı olurdu ve güven "ekonomik varlık" olmaktan çıkardı.
   */
  customers: CustomerRegistry;

  speed4xUnlocked: boolean;

  /**
   * GDD 25 — görülmüş öğretim dersleri. Taşınmasaydı her yüklemede oyuncuya
   * bildiği şey yeniden anlatılırdı.
   */
  seenLessons?: string[];
}

/**
 * Durumu kayda çevirir.
 *
 * Aktif işlem BİLEREK dışarıda bırakılır: kaydederken açık olan pazarlık,
 * yüklendiğinde kapanmış sayılır.
 */
export function serialize(state: GameState): SaveFile {
  return {
    version: SAVE_VERSION,
    seed: state.seed,
    day: state.market.day,
    clockMinutes: state.market.clockMinutes,
    spawnCounter: state.spawnCounter,
    jobCounter: state.jobCounter,
    store: state.store,
    inventory: state.inventory,
    items: state.items,
    ledger: state.ledger,
    jobs: state.jobs,
    network: state.network,
    customers: state.customers,
    speed4xUnlocked: state.speed4xUnlocked,
    seenLessons: state.seenLessons,
  };
}

/** Yüklendiğinde doğrudan store'a yazılabilecek alanlar. */
export type LoadedState = Pick<
  GameState,
  | 'seed'
  | 'spawnCounter'
  | 'jobCounter'
  | 'market'
  | 'store'
  | 'inventory'
  | 'items'
  | 'ledger'
  | 'jobs'
  | 'network'
  | 'customers'
  | 'dayCharacter'
  | 'intentTelemetry'
  | 'speed4xUnlocked'
  | 'seenLessons'
  | 'queue'
  | 'activeCustomer'
  | 'activeDeal'
  | 'overnight'
  | 'lastOvernight'
>;

/**
 * Kaydı duruma çevirir.
 *
 * Piyasa ve gün karakteri seed'den YENİDEN TÜRETİLİR. Aynı (seed, gün) her
 * zaman aynı rejimi, trendi ve olayı verdiği için §11'in "rejim tutarlı geri
 * yüklenir" şartı sağlanır — üstelik kaydedilmiş bir kopyanın bozulma
 * ihtimali olmadan.
 *
 * Rejim geçiş zinciri gün 1'den itibaren yeniden koşturulur: rejim artık bir
 * DURUM olduğu için (§5.1) yalnız o günün seed'ini kullanmak, zincirin
 * geçmişini yok saymak olurdu.
 */
export function deserialize(file: SaveFile): LoadedState {
  const save = migrate(file);
  const market = rebuildMarket(save.seed, save.day, save.clockMinutes);

  return {
    seed: save.seed,
    spawnCounter: save.spawnCounter,
    jobCounter: save.jobCounter,
    market,
    store: save.store,
    inventory: save.inventory,
    items: save.items,
    ledger: save.ledger,
    jobs: save.jobs,
    network: save.network,
    // Eski kayıtta defter yoksa boş başlar; çökmez.
    customers: save.customers ?? {},
    dayCharacter: dayCharacter(save.seed, save.day, market),
    // Telemetri bir ÖLÇÜMdür, bir durum değil: yüklemede sıfırlanır ve
    // yeni örneklem penceresi başlar (§3 "uygun örneklem penceresinde").
    intentTelemetry: emptyTelemetry(),
    speed4xUnlocked: save.speed4xUnlocked,
    // Eski kayıtlarda alan yok; boş liste öğretimi baştan başlatır ki
    // sürüm atlayan oyuncu sessizce derssiz kalmasın.
    seenLessons: save.seenLessons ?? [],
    // Yarım işlem taşınmaz.
    queue: [],
    activeCustomer: null,
    activeDeal: null,
    overnight: null,
    lastOvernight: null,
  };
}

/**
 * Rejim zincirini gün 1'den yeniden kurar (§5.1 — rejim bir durumdur).
 * Yalnız hedef günün seed'iyle üretmek, önceki günlerin geçiş zincirini
 * atlayıp farklı bir rejim vermek olurdu.
 */
export function rebuildMarket(seed: number, day: number, clockMinutes: number) {
  let market = createMarketForDay(seed, 1);
  for (let d = 2; d <= day; d += 1) market = createMarketForDay(seed, d, market);
  return { ...market, clockMinutes };
}

/** Sürüm geçişleri. Bilinmeyen/ileri sürüm güvenle reddedilir. */
export function migrate(file: SaveFile): SaveFile {
  if (file.version > SAVE_VERSION) {
    throw new Error(`Kayıt sürümü desteklenmiyor: ${file.version}`);
  }
  // v1 ilk sürüm; ileride her adım burada zincirlenir.
  return file;
}

const STORAGE_KEY = 'mihenkaynak.save.v1';

/** Tarayıcı deposuna yazar. Depo yoksa sessizce atlar (SSR / test). */
export function writeSave(state: GameState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(state)));
    return true;
  } catch {
    return false;
  }
}

/** Depodan okur. Bozuk veya ileri sürümlü kayıt null döner — çökme yok. */
export function readSave(): LoadedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserialize(JSON.parse(raw) as SaveFile);
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Depo yoksa yapacak bir şey yok.
  }
}

/** Boş defter — testlerde ve yeni oyunda kullanılır. */
export function emptyLedger(): Ledger {
  return createLedger();
}
