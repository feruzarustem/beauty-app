import type { PaymentMethod, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { DuplicateWarning, PeriodPaidError, ValidationError } from "@/lib/errors";
import { periodFor } from "@/lib/periods";
import { masterShare, parseAmount } from "@/lib/money";
import { getMasterSharePercent } from "./settings";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export type AdminVisitDto = {
  id: string;
  visitDate: string;
  masterId: string;
  masterName: string;
  clientId: string | null;
  clientName: string | null;
  amount: number;
  masterShare: number;
  paymentMethod: PaymentMethod;
};

export function toDate(iso: string): Date {
  if (!ISO_DATE.test(iso) || Number.isNaN(Date.parse(iso))) throw new ValidationError("Неверная дата");
  return new Date(`${iso}T00:00:00.000Z`);
}

export async function createVisit(
  actor: User,
  input: {
    visitDate: string;
    masterId: string;
    clientId: string;
    amount: unknown;
    paymentMethod: PaymentMethod;
    confirmDuplicate?: boolean;
  },
): Promise<{ id: string }> {
  requireRole(actor, "admin");
  const visitDate = toDate(input.visitDate);
  const amount = parseAmount(input.amount);
  if (input.paymentMethod !== "cash" && input.paymentMethod !== "transfer") {
    throw new ValidationError("Выберите способ оплаты");
  }
  const master = await prisma.user.findUnique({ where: { id: input.masterId } });
  if (!master || master.role !== "master" || !master.active) {
    throw new ValidationError("Мастер не найден или отключён");
  }
  const client = await prisma.client.findUnique({ where: { id: input.clientId } });
  if (!client) throw new ValidationError("Клиент не найден");

  const period = periodFor(input.visitDate);
  const paid = await prisma.payout.findFirst({
    where: { masterId: master.id, periodStart: toDate(period.start), periodEnd: toDate(period.end), status: "paid" },
  });
  if (paid) throw new PeriodPaidError();

  if (!input.confirmDuplicate) {
    const dup = await prisma.visit.findFirst({
      where: {
        masterId: master.id,
        clientId: client.id,
        amount,
        createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
    });
    if (dup) throw new DuplicateWarning();
  }

  const v = await prisma.visit.create({
    data: {
      visitDate,
      masterId: master.id,
      clientId: client.id,
      amount,
      paymentMethod: input.paymentMethod,
      createdById: actor.id,
    },
  });
  return { id: v.id };
}

export async function listVisitsForDay(actor: User, isoDate: string): Promise<AdminVisitDto[]> {
  requireRole(actor, "admin");
  const percent = await getMasterSharePercent();
  const rows = await prisma.visit.findMany({
    where: { visitDate: toDate(isoDate) },
    include: { master: { select: { name: true } }, client: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((v) => ({
    id: v.id,
    visitDate: v.visitDate.toISOString().slice(0, 10),
    masterId: v.masterId,
    masterName: v.master.name,
    clientId: v.clientId,
    clientName: v.client?.name ?? null,
    amount: v.amount,
    masterShare: masterShare(v.amount, percent),
    paymentMethod: v.paymentMethod,
  }));
}
