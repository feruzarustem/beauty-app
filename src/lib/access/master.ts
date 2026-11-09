// Единственный слой данных для роли «мастер». Он отдаёт только явно перечисленные поля
// (никаких объектов Prisma целиком) и отбирает данные по идентификатору самого мастера.
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { masterShare } from "@/lib/money";
import type { Period } from "@/lib/periods";
import { assertPeriod, figures } from "@/lib/services/payroll";
import { getMasterSharePercent } from "@/lib/services/settings";

export type MasterClientDto = { id: string; name: string };
export type MasterVisitDto = {
  id: string;
  visitDate: string;
  clientName: string | null;
  amount: number;
  myShare: number;
  services: string[];
};
export type MasterEarningsDto = {
  calculated: number;
  adjustment: number;
  final: number;
  status: "pending" | "paid";
};

const visitSelect = {
  id: true,
  visitDate: true,
  amount: true,
  client: { select: { name: true } },
  items: { select: { name: true } },
} as const;

type VisitRow = { id: string; visitDate: Date; amount: number; client: { name: string } | null; items: { name: string }[] };

function toDto(v: VisitRow, percent: number): MasterVisitDto {
  return {
    id: v.id,
    visitDate: v.visitDate.toISOString().slice(0, 10),
    clientName: v.client?.name ?? null,
    amount: v.amount,
    myShare: masterShare(v.amount, percent),
    services: v.items.map((i) => i.name),
  };
}

export async function masterClients(actor: User): Promise<MasterClientDto[]> {
  requireRole(actor, "master");
  return prisma.client.findMany({
    where: { assignedMasterId: actor.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function masterVisits(actor: User, range: Period): Promise<MasterVisitDto[]> {
  requireRole(actor, "master");
  const { start, end } = rangeDates(range);
  const percent = await getMasterSharePercent();
  const rows = await prisma.visit.findMany({
    where: { masterId: actor.id, visitDate: { gte: start, lte: end }, status: "done" },
    select: visitSelect,
    orderBy: [{ visitDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((v) => toDto(v, percent));
}

/** Чужой и несуществующий визит неотличимы: в обоих случаях NotFoundError. */
export async function masterVisit(actor: User, visitId: string): Promise<MasterVisitDto> {
  requireRole(actor, "master");
  const v = await prisma.visit.findFirst({
    where: { id: visitId, masterId: actor.id, status: "done" },
    select: visitSelect,
  });
  if (!v) throw new NotFoundError();
  return toDto(v, await getMasterSharePercent());
}

export async function masterEarnings(actor: User, period: Period): Promise<MasterEarningsDto> {
  requireRole(actor, "master");
  const { start, end } = assertPeriod(period);
  const percent = await getMasterSharePercent();
  const visits = await prisma.visit.findMany({
    where: { masterId: actor.id, visitDate: { gte: start, lte: end }, status: "done" },
    select: { amount: true },
  });
  const payout = await prisma.payout.findUnique({
    where: { masterId_periodStart_periodEnd: { masterId: actor.id, periodStart: start, periodEnd: end } },
  });
  const paid = payout?.status === "paid";
  const calculated = paid ? payout.calculatedAmount : figures(visits.map((v) => v.amount), percent).calculated;
  const adjustment = payout?.adjustmentAmount ?? 0;
  return { calculated, adjustment, final: calculated + adjustment, status: paid ? "paid" : "pending" };
}

function rangeDates(range: Period): { start: Date; end: Date } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(range.start) || !iso.test(range.end) || range.start > range.end) {
    throw new ValidationError("Неверный диапазон дат");
  }
  return { start: new Date(`${range.start}T00:00:00.000Z`), end: new Date(`${range.end}T00:00:00.000Z`) };
}

export type MasterScheduleItem = {
  id: string;
  time: string;
  clientName: string | null;
  services: string[];
  status: "scheduled" | "done" | "cancelled";
};
export type MasterScheduleDay = { date: string; dayOff: boolean; items: MasterScheduleItem[]; freeHours: number[] };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Личное расписание мастера на N дней (до 14) вперёд от даты. Только её записи, без сумм и без контактов.
 * Свободные часы: рабочие часы салона 08:00–20:00, в которых у неё не начинается ни одна запись.
 */
export async function masterSchedule(actor: User, fromIso: string, days: number): Promise<MasterScheduleDay[]> {
  requireRole(actor, "master");
  if (!Number.isInteger(days) || days < 1 || days > 14) throw new ValidationError("Можно смотреть расписание не более чем на 14 дней");
  const start = new Date(`${fromIso}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || Number.isNaN(start.getTime())) throw new ValidationError("Неверная дата");
  const toIso = addDays(fromIso, days - 1);
  const range = { gte: start, lte: new Date(`${toIso}T00:00:00.000Z`) };
  const [rows, off] = await Promise.all([
    prisma.visit.findMany({
      where: { masterId: actor.id, visitDate: range, status: { in: ["scheduled", "done", "cancelled"] }, startTime: { not: null } },
      select: { id: true, visitDate: true, startTime: true, status: true, client: { select: { name: true } }, items: { select: { name: true } } },
      orderBy: [{ startTime: "asc" }, { createdAt: "asc" }],
    }),
    prisma.dayOff.findMany({ where: { masterId: actor.id, date: range }, select: { date: true } }),
  ]);
  const offSet = new Set(off.map((d) => d.date.toISOString().slice(0, 10)));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(fromIso, i);
    const items = rows
      .filter((r) => r.visitDate.toISOString().slice(0, 10) === date)
      .map((r) => ({ id: r.id, time: r.startTime as string, clientName: r.client?.name ?? null, services: r.items.map((x) => x.name), status: r.status }));
    const dayOff = offSet.has(date);
    const busy = new Set(items.filter((x) => x.status !== "cancelled").map((x) => Number(x.time.slice(0, 2))));
    const freeHours = dayOff ? [] : Array.from({ length: 12 }, (_, h) => h + 8).filter((h) => !busy.has(h));
    return { date, dayOff, items, freeHours };
  });
}
