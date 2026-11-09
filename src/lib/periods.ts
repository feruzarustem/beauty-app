const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export type Period = { start: string; end: string };

/** Период расчёта (1–15 или 16–конец месяца) для даты YYYY-MM-DD. */
export function periodFor(isoDate: string): Period {
  const m = ISO.exec(isoDate);
  if (!m) throw new Error(`Неверный формат даты: ${isoDate}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ym = `${m[1]}-${m[2]}`;
  if (day <= 15) return { start: `${ym}-01`, end: `${ym}-15` };
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${ym}-16`, end: `${ym}-${String(lastDay).padStart(2, "0")}` };
}

/** Сегодняшняя дата YYYY-MM-DD по времени Алматы. */
export function todayInBusinessTz(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Соседний период: direction 1 — следующий, -1 — предыдущий. */
export function shiftPeriod(p: Period, direction: 1 | -1): Period {
  const [y, m] = p.start.split("-").map(Number);
  const firstHalf = p.start.endsWith("-01");
  if (direction === 1) {
    return firstHalf ? periodFor(`${p.start.slice(0, 7)}-16`) : periodFor(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
  }
  return firstHalf ? periodFor(new Date(Date.UTC(y, m - 2, 16)).toISOString().slice(0, 10)) : periodFor(`${p.start.slice(0, 7)}-01`);
}
