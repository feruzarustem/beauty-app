import { prisma } from "@/lib/db";
import { DayClosedError, ValidationError } from "@/lib/errors";

export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 20;

const dateOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Закрытый день заморожен: визиты этого дня менять нельзя. */
export async function assertDayOpen(iso: string): Promise<void> {
  const closing = await prisma.dayClosing.findUnique({ where: { closingDate: dateOf(iso) } });
  if (closing?.isClosed) throw new DayClosedError();
}

/** Время записи: «ЧЧ:ММ» с 08:00 до 19:59 (салон работает 08:00–20:00 ежедневно). */
export function assertWorkingTime(time: unknown): string {
  const m = typeof time === "string" ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new ValidationError("Укажите время в формате ЧЧ:ММ");
  const hour = Number(m[1]);
  if (hour < OPEN_HOUR || hour >= CLOSE_HOUR) throw new ValidationError("Салон работает с 08:00 до 20:00");
  return time as string;
}

export async function assertNotDayOff(masterId: string, iso: string): Promise<void> {
  const off = await prisma.dayOff.findUnique({ where: { masterId_date: { masterId, date: dateOf(iso) } } });
  if (off) throw new ValidationError("У мастера в этот день выходной");
}
