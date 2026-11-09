// Единственный слой данных для роли «мастер». Он отдаёт только явно перечисленные поля
// (никаких объектов Prisma целиком) и отбирает данные по идентификатору самого мастера.
import type { PaymentMethod, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { masterShare } from "@/lib/money";
import { todayInBusinessTz, type Period } from "@/lib/periods";
import { assertPeriod, figures } from "@/lib/services/payroll";
import { getMasterSharePercent } from "@/lib/services/settings";
import { recordVisit } from "@/lib/services/visits";

export type MasterClientDto = { id: string; name: string };
export type MasterVisitDto = {
  id: string;
  visitDate: string;
  clientName: string | null;
  amount: number;
  myShare: number;
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
} as const;

type VisitRow = { id: string; visitDate: Date; amount: number; client: { name: string } | null };

function toDto(v: VisitRow, percent: number): MasterVisitDto {
  return {
    id: v.id,
    visitDate: v.visitDate.toISOString().slice(0, 10),
    clientName: v.client?.name ?? null,
    amount: v.amount,
    myShare: masterShare(v.amount, percent),
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
    where: { masterId: actor.id, visitDate: { gte: start, lte: end } },
    select: visitSelect,
    orderBy: [{ visitDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((v) => toDto(v, percent));
}

/** Чужой и несуществующий визит неотличимы: в обоих случаях NotFoundError. */
export async function masterVisit(actor: User, visitId: string): Promise<MasterVisitDto> {
  requireRole(actor, "master");
  const v = await prisma.visit.findFirst({
    where: { id: visitId, masterId: actor.id },
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
    where: { masterId: actor.id, visitDate: { gte: start, lte: end } },
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

export type MasterServiceDto = {
  id: string;
  groupName: string;
  name: string;
  priceMin: number;
  priceMax: number | null;
  openEnded: boolean;
};

/** Прайс только по её направлению: нужен, чтобы подставить цену в форму. */
export async function masterServices(actor: User): Promise<MasterServiceDto[]> {
  requireRole(actor, "master");
  if (!actor.category) return [];
  return prisma.service.findMany({
    where: { category: actor.category },
    select: { id: true, groupName: true, name: true, priceMin: true, priceMax: true, openEnded: true },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Мастер записывает свой визит в конце процедуры. Мастер всегда она сама, дата всегда сегодня.
 * Клиент ищется только среди её клиентов по имени; чужих клиентов она не находит и не получает.
 */
export async function createMyVisit(
  actor: User,
  input: { clientName: string; amount: unknown; paymentMethod: PaymentMethod; confirmDuplicate?: boolean },
): Promise<{ id: string }> {
  requireRole(actor, "master");
  const name = String(input.clientName ?? "").trim();
  if (!name) throw new ValidationError("Укажите имя клиента");
  if (name.length > 100) throw new ValidationError("Слишком длинное имя клиента");
  const own = await prisma.client.findFirst({
    where: { assignedMasterId: actor.id, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  const clientId = own?.id ?? (await prisma.client.create({ data: { name, assignedMasterId: actor.id }, select: { id: true } })).id;
  return recordVisit(actor, {
    visitDate: todayInBusinessTz(new Date()),
    masterId: actor.id,
    clientId,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    confirmDuplicate: input.confirmDuplicate,
  });
}
