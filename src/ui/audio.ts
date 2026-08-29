/**
 * SES MOTORU — dosya gelince çalar, gelmeyince sessizce susar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BUGÜNKÜ DURUM
 *
 * Projede henüz ses dosyası YOK (`public/assets/audio/` boş). Bu dosya
 * motoru kurar ve kayıt defterini tanımlar; dosyalar eklendiğinde tek satır
 * değişiklik gerekmeden çalmaya başlar.
 *
 * DOSYA YOKKEN NE OLUR: hiçbir şey. Ne konsol hatası, ne kırık istek, ne
 * bekleyen bir promise. Aynı ilke `Art` bileşeninde de var — varlık yoksa
 * kırık ikon değil, sessiz bir alternatif. Sesin "kırık ikonu" ise
 * yakalanmamış bir hata olurdu.
 *
 * NEDEN <audio> DEĞİL DE AudioContext:
 * Efektler üst üste binebilir (art arda iki tık). `<audio>` öğesi çalarken
 * yeniden tetiklenirse ya baştan başlar ya birikir; WebAudio her tetiklemede
 * ayrı bir kaynak düğümü açar ve karışım motorun işidir.
 *
 * OTOMATİK OYNATMA KİLİDİ: tarayıcılar kullanıcı bir şeye dokunmadan ses
 * açtırmaz. Bağlam ilk kullanıcı etkileşiminde açılır (`unlock`), o ana
 * kadar çalma istekleri sessizce düşer — hata değil, tarayıcı kuralı.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { effectiveVolume, type GameSettings } from '@domain/settings';

/**
 * Efekt kimlikleri ve dosya yolları.
 *
 * KİMLİKLER ŞİMDİDEN SABİT: çağıran taraf `play('offerAccepted')` yazar ve
 * dosya adı değişse bile o satır değişmez. Yol `null` olan efekt henüz
 * teslim edilmemiştir; motor onu sessizce atlar.
 */
export const SFX = {
  tap: 'assets/audio/sfx/tap.mp3',
  offerSent: 'assets/audio/sfx/offer-sent.mp3',
  offerAccepted: 'assets/audio/sfx/offer-accepted.mp3',
  offerRejected: 'assets/audio/sfx/offer-rejected.mp3',
  cashRegister: 'assets/audio/sfx/cash-register.mp3',
  testDone: 'assets/audio/sfx/test-done.mp3',
  customerArrive: 'assets/audio/sfx/customer-arrive.mp3',
  dayEnd: 'assets/audio/sfx/day-end.mp3',
  error: 'assets/audio/sfx/error.mp3',
} as const;

export type SfxId = keyof typeof SFX;

/** Arka plan müziği — tek parça, döngüyle çalar. */
export const MUSIC_TRACK = 'assets/audio/music/shop-ambience.mp3';

let ctx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicSource: AudioBufferSourceNode | null = null;
let unlocked = false;

/** Çözülmüş tamponlar. `null` = dosya yok, bir daha denenmez. */
const buffers = new Map<string, AudioBuffer | null>();
let current: GameSettings | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.connect(ctx.destination);
    sfxGain.connect(ctx.destination);
    if (current) applyVolumes(current);
    return ctx;
  } catch {
    // Ses desteklenmiyor (eski tarayıcı, kısıtlı ortam). Oyun sessiz çalışır.
    return null;
  }
}

/**
 * Bir dosyayı çözer. Yoksa `null` kaydeder ve BİR DAHA DENEMEZ.
 *
 * Tekrar denemek, ses dosyası olmayan bir kurulumda her tıkta bir 404
 * üretirdi — konsolu doldurup gerçek hataları görünmez yapan tam olarak bu.
 */
async function buffer(url: string): Promise<AudioBuffer | null> {
  if (buffers.has(url)) return buffers.get(url) ?? null;

  const audio = context();
  if (!audio) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      buffers.set(url, null);
      return null;
    }
    const decoded = await audio.decodeAudioData(await res.arrayBuffer());
    buffers.set(url, decoded);
    return decoded;
  } catch {
    buffers.set(url, null);
    return null;
  }
}

function applyVolumes(settings: GameSettings): void {
  if (musicGain) musicGain.gain.value = effectiveVolume(settings, 'music');
  if (sfxGain) sfxGain.gain.value = effectiveVolume(settings, 'sfx');
}

/**
 * Ayarları motora bildirir.
 *
 * Müzik açılıp kapanması ANINDA etkili olmalı: oyuncu kapattığında sesin
 * parçanın bitmesini beklemesi kabul edilemez. Seviye değişimi ise yalnız
 * kazanç düğümüne yazılır — parça kesilmez.
 */
export function syncAudioSettings(settings: GameSettings): void {
  current = settings;
  applyVolumes(settings);

  if (settings.music) {
    if (unlocked) void startMusic();
  } else {
    stopMusic();
  }
}

/**
 * Ses bağlamını açar. İLK KULLANICI ETKİLEŞİMİNDE çağrılmalı — tarayıcılar
 * dokunmadan önce ses açtırmaz ve `resume()` sessizce reddedilir.
 */
export function unlockAudio(): void {
  const audio = context();
  if (!audio) return;
  unlocked = true;
  if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
  if (current?.music) void startMusic();
}

async function startMusic(): Promise<void> {
  const audio = context();
  if (!audio || !musicGain || musicSource) return;

  const buf = await buffer(MUSIC_TRACK);
  // Parça yoksa sessizlik; ayar açık kalır, dosya gelince kendiliğinden çalar.
  if (!buf || musicSource) return;

  const source = audio.createBufferSource();
  source.buffer = buf;
  source.loop = true;
  source.connect(musicGain);
  source.start();
  musicSource = source;
}

function stopMusic(): void {
  if (!musicSource) return;
  try {
    musicSource.stop();
  } catch {
    // Zaten durmuş olabilir; durdurulamaması bir hata değil.
  }
  musicSource.disconnect();
  musicSource = null;
}

/**
 * Bir efekt çalar. Kapalıysa, bağlam açılmadıysa veya dosya yoksa sessizce
 * hiçbir şey yapmaz — çağıran tarafın kontrol etmesi gerekmez.
 */
export function playSfx(id: SfxId): void {
  if (!current?.sfx || !unlocked) return;

  void buffer(SFX[id]).then((buf) => {
    const audio = ctx;
    if (!buf || !audio || !sfxGain) return;
    const source = audio.createBufferSource();
    source.buffer = buf;
    source.connect(sfxGain);
    source.start();
  });
}

/** Testler ve ekran değişimleri için — motoru başlangıç hâline döndürür. */
export function resetAudioForTest(): void {
  stopMusic();
  buffers.clear();
  unlocked = false;
  current = null;
}
