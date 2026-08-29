/**
 * KAÇAN TALEP DEFTERİ — ölçüm katmanının testleri.
 *
 * Defterin varlık sebebi: satın almaya gelen müşterilerin %63'ü uygun stok
 * olmadığı için eli boş dönüyordu ve oyuncunun bunu görebileceği hiçbir
 * yüzey yoktu. Buradaki testler defterin SAYDIĞINI, ekonomiye
 * DOKUNMADIĞINI ve eski kayıtları BOZMADIĞINI tutar.
 */

import { describe, expect, it } from 'vitest';
import {
  createDemandLog,
  missedToday,
  normalizeDemandLog,
  recordMissedDemand,
  rolloverDemandLog,
  topMissedDemand,
} from './demand-log';

describe('kaçan talep defteri', () => {
  it('boş defterle başlar', () => {
    const log = createDemandLog();
    expect(missedToday(log)).toBe(0);
    expect(topMissedDemand(log, 5)).toEqual([]);
  });

  it('aynı talebi üst üste sayar', () => {
    let log = createDemandLog();
    log = recordMissedDemand(log, 'quarter_gold');
    log = recordMissedDemand(log, 'quarter_gold');
    expect(log.today.quarter_gold).toBe(2);
    expect(log.total.quarter_gold).toBe(2);
  });

  it('girdiyi mutasyona uğratmaz', () => {
    const log = createDemandLog();
    recordMissedDemand(log, 'quarter_gold');
    expect(log.today).toEqual({});
  });

  it('boş anahtarı yazmaz', () => {
    const log = recordMissedDemand(createDemandLog(), '');
    expect(missedToday(log)).toBe(0);
  });

  it('gün devrinde bugün sıfırlanır, toplam korunur', () => {
    let log = recordMissedDemand(createDemandLog(), 'half_gold');
    log = rolloverDemandLog(log);
    expect(missedToday(log)).toBe(0);
    expect(log.total.half_gold).toBe(1);
  });

  it('sıralama önce bugüne bakar', () => {
    // Yarınki stok kararını en çok BUGÜNKÜ kaçak ilgilendirir; dünkü birikim
    // eşitlik bozar, sırayı belirlemez.
    let log = createDemandLog();
    for (let i = 0; i < 9; i += 1) log = recordMissedDemand(log, 'eski');
    log = rolloverDemandLog(log);
    log = recordMissedDemand(log, 'bugun');

    const siralı = topMissedDemand(log, 5);
    expect(siralı[0]).toMatchObject({ templateId: 'bugun', today: 1, total: 1 });
  });

  it('limit kadar satır döner', () => {
    let log = createDemandLog();
    for (const id of ['a', 'b', 'c', 'd']) log = recordMissedDemand(log, id);
    expect(topMissedDemand(log, 2)).toHaveLength(2);
  });

  it('eski kayıt (alan yok) boş defterle açılır, çökmez', () => {
    expect(normalizeDemandLog(undefined)).toEqual(createDemandLog());
    expect(normalizeDemandLog(null)).toEqual(createDemandLog());
    expect(normalizeDemandLog({ total: { x: 3 } })).toEqual({ today: {}, total: { x: 3 } });
  });
});
