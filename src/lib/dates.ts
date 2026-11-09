const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export const addDays = (iso: string, n: number) => new Date(at(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const weekdayShort = (iso: string) => WD[at(iso).getUTCDay()];
/** «пн 12.11» */
export const fmtDay = (iso: string) => `${weekdayShort(iso)} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
/** Понедельник недели, в которую входит дата. */
export function startOfWeek(iso: string): string {
  const d = at(iso).getUTCDay();
  return addDays(iso, d === 0 ? -6 : 1 - d);
}
export const eachDay = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));
export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(at(v).getTime()) && at(v).toISOString().slice(0, 10) === v;
}
