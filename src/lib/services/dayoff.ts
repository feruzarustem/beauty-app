import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { ValidationError } from "@/lib/errors";
import { todayInBusinessTz } from "@/lib/periods";
import { audit } from "./audit";
import { toDate } from "./visits";

export async function listDaysOff(actor: User, fromIso: string, toIso: string): Promise<{ masterId: string; date: string }[]> {
  requireRole(actor, "admin");
  const rows = await prisma.dayOff.findMany({
    where: { date: { gte: toDate(fromIso), lte: toDate(toIso) } },
    orderBy: [{ date: "asc" }, { masterId: "asc" }],
  });
  return rows.map((r) => ({ masterId: r.masterId, date: r.date.toISOString().slice(0, 10) }));
}

/** Выходные мастера на выбранные даты (сегодня и будущие). Повторная отметка той же даты игнорируется. */
export async function addDaysOff(actor: User, masterId: string, dates: string[]): Promise<void> {
  requireRole(actor, "admin");
  const master = await prisma.user.findFirst({ where: { id: masterId, role: "master" } });
  if (!master) throw new ValidationError("Мастер не найден");
  if (dates.length === 0) throw new ValidationError("Выберите хотя бы одну дату");
  const today = todayInBusinessTz(new Date());
  const unique = [...new Set(dates)];
  for (const d of unique) {
    toDate(d);
    if (d < today) throw new ValidationError("Выходные ставятся только на сегодня и будущие даты");
    const booked = await prisma.visit.count({ where: { masterId, visitDate: toDate(d), status: "scheduled" } });
    if (booked > 0) throw new ValidationError(`${d}: уже есть записи (${booked}). Сначала перенесите или отмените их.`);
  }
  await prisma.dayOff.createMany({
    data: unique.map((d) => ({ masterId, date: toDate(d), createdById: actor.id })),
    skipDuplicates: true,
  });
  await audit(actor, "dayoff.add", "DayOff", masterId, unique.join(", "));
}

export async function removeDayOff(actor: User, masterId: string, date: string): Promise<void> {
  requireRole(actor, "admin");
  await prisma.dayOff.deleteMany({ where: { masterId, date: toDate(date) } });
  await audit(actor, "dayoff.remove", "DayOff", masterId, date);
}
