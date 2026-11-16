import { prisma } from "@/lib/db";
import { DayClosedError, ValidationError } from "@/lib/errors";

export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 23; // запись и завершение процедур — до 23:00

const dateOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Закрытый день заморожен: визиты этого дня менять нельзя. */
export async function assertDayOpen(iso: string): Promise<void> {
  const closing = await prisma.dayClosing.findUnique({ where: { closingDate: dateOf(iso) } });
  if (closing?.isClosed) throw new DayClosedError();
}

/** Время начала записи: «ЧЧ:ММ» с 08:00 до 22:59 (процедура должна закончиться до 23:00). */
export function assertWorkingTime(time: unknown): string {
  const m = typeof time === "string" ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new ValidationError("Укажите время в формате ЧЧ:ММ");
  const hour = Number(m[1]);
  if (hour < OPEN_HOUR || hour >= CLOSE_HOUR) throw new ValidationError("Запись возможна с 08:00 до 23:00");
  return time as string;
}

export async function assertNotDayOff(masterId: string, iso: string): Promise<void> {
  const off = await prisma.dayOff.findUnique({ where: { masterId_date: { masterId, date: dateOf(iso) } } });
  if (off) throw new ValidationError("У мастера в этот день выходной");
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Длительность вручную: целое число минут от 10 до 600. */
export function parseDuration(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 10 || n > 600) throw new ValidationError("Длительность — от 10 минут до 10 часов");
  return n;
}

/** Процедура должна закончиться не позже 23:00. */
export function assertEndsInTime(startTime: string, durationMin: number): void {
  if (toMinutes(startTime) + durationMin > CLOSE_HOUR * 60) throw new ValidationError("Процедура должна закончиться до 23:00");
}

/**
 * Один мастер не может быть записан на два пересекающихся интервала. Встык (конец = начало) можно.
 * Учитываются запланированные и выполненные записи с временем и длительностью; отменённые и старые без времени — нет.
 */
export async function assertNoOverlap(masterId: string, dateIso: string, startTime: string, durationMin: number, excludeId?: string): Promise<void> {
  const start = toMinutes(startTime);
  const end = start + durationMin;
  const others = await prisma.visit.findMany({
    where: { masterId, visitDate: dateOf(dateIso), status: { in: ["scheduled", "done"] }, startTime: { not: null }, durationMin: { not: null }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { startTime: true, durationMin: true },
  });
  for (const o of others) {
    const os = toMinutes(o.startTime as string);
    const oe = os + (o.durationMin as number);
    if (start < oe && os < end) throw new ValidationError(`Мастер занят с ${fromMinutes(os)} до ${fromMinutes(oe)}. Выберите другое время.`);
  }
}
