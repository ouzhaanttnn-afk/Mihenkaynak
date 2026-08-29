/**
 * KARŞILANAMAYAN TALEP DEFTERİ
 *
 * NEDEN VAR: ölçüldü — satın almaya gelen müşterilerin %63'ü, dükkânda
 * talebine uyan HİÇBİR kalem olmadığı için eli boş dönüyordu (40 günde
 * 760/1214). Oyunun bunu oyuncuya söyleyen tek bir yüzeyi yoktu: kaçan
 * talep hiçbir yere yazılmıyordu. Oyuncu "bugün ne istediler de bende
 * yoktu" sorusunu soramadığı için stok kararını körlemesine veriyordu.
 *
 * NE DEĞİL: bu bir ekonomi sistemi değildir. Para, stok, güven, itibar ve
 * XP'ye DOKUNMAZ; yalnız sayar. Yeni bir talep havuzu, yeni bir fiyat ya da
 * yeni bir kanal üretmez — var olan talebin kaçanını görünür kılar.
 *
 * Sayaç gün bazlı DEĞİL kümülatiftir ama gün devrinde "bugünkü" pencere
 * sıfırlanır: oyuncunun bugün ne kaçırdığı ile toplamda neyi sürekli
 * kaçırdığı ayrı sorulardır ve ikisi de stok kararını besler.
 */

export interface DemandLog {
  /** Şablon kimliği → bugün kaç kez karşılanamadı. */
  today: Record<string, number>;
  /** Şablon kimliği → oyun boyunca kaç kez karşılanamadı. */
  total: Record<string, number>;
}

export function createDemandLog(): DemandLog {
  return { today: {}, total: {} };
}

/** Eski kayıtta alan yoksa boş defterle devam edilir; çökmez. */
export function normalizeDemandLog(log: Partial<DemandLog> | undefined | null): DemandLog {
  return {
    today: { ...(log?.today ?? {}) },
    total: { ...(log?.total ?? {}) },
  };
}

/** Karşılanamayan bir talebi deftere yazar. Saf: girdi mutasyona uğramaz. */
export function recordMissedDemand(log: DemandLog, templateId: string): DemandLog {
  if (!templateId) return log;
  return {
    today: { ...log.today, [templateId]: (log.today[templateId] ?? 0) + 1 },
    total: { ...log.total, [templateId]: (log.total[templateId] ?? 0) + 1 },
  };
}

/** Gün devri — "bugün" penceresi sıfırlanır, toplam korunur. */
export function rolloverDemandLog(log: DemandLog): DemandLog {
  return { today: {}, total: { ...log.total } };
}

export interface MissedDemandRow {
  templateId: string;
  today: number;
  total: number;
}

/**
 * En çok kaçırılan talepler — çoktan aza. Sıralama önce BUGÜNE, sonra
 * toplama bakar: oyuncunun yarın vereceği stok kararını en çok bugünkü
 * kaçak ilgilendirir.
 */
export function topMissedDemand(log: DemandLog, limit: number): MissedDemandRow[] {
  const ids = new Set([...Object.keys(log.today), ...Object.keys(log.total)]);
  return [...ids]
    .map((templateId) => ({
      templateId,
      today: log.today[templateId] ?? 0,
      total: log.total[templateId] ?? 0,
    }))
    .sort((a, b) => b.today - a.today || b.total - a.total || a.templateId.localeCompare(b.templateId))
    .slice(0, limit);
}

/** Bugün toplam kaç talep karşılanamadı. */
export function missedToday(log: DemandLog): number {
  return Object.values(log.today).reduce((n, v) => n + v, 0);
}
