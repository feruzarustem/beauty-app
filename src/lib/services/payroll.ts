import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { NotFoundError, PeriodPaidError, ValidationError } from "@/lib/errors";
import { masterShare, parseAmount } from "@/lib/money";
import { periodFor, type Period } from "@/lib/periods";
import { getMasterSharePercent } from "./settings";
import { toDate } from "./visits";

export type PayrollLine = {
  masterId: string;
  masterName: string;
  visitCount: number;
  revenue: number;
  calculated: number;
  adjustment: number;
  adjustmentReason: string | null;
  final: number;
  status: "pending" | "paid";
};

function assertPeriod(p: Period): { start: Date; end: Date } {
  const expected = periodFor(p.start);
  if (expected.start !== p.start || expected.end !== p.end) {
    throw new ValidationError("Период должен быть 1–15 или 16–конец месяца");
  }
  return { start: toDate(p.start), end: toDate(p.end) };
}

/** Доля мастера: сумма долей по каждому визиту (округление вниз у каждого). */
function figures(amounts: number[], percent: number) {
  return {
    visitCount: amounts.length,
    revenue: amounts.reduce((s, a) => s + a, 0),
    calculated: amounts.reduce((s, a) => s + masterShare(a, percent), 0),
  };
}

export async function computePayroll(actor: User, period: Period): Promise<PayrollLine[]> {
  requireRole(actor, "admin");
  const { start, end } = assertPeriod(period);
  const percent = await getMasterSharePercent();
  const visits = await prisma.visit.findMany({
    where: { visitDate: { gte: start, lte: end } },
    select: { masterId: true, amount: true },
  });
  const payouts = await prisma.payout.findMany({ where: { periodStart: start, periodEnd: end } });
  const withVisits = [...new Set(visits.map((v) => v.masterId))];
  const masters = await prisma.user.findMany({
    where: { role: "master", OR: [{ active: true }, { id: { in: withVisits } }] },
    orderBy: { name: "asc" },
  });
  return masters.map((m) => {
    const f = figures(visits.filter((v) => v.masterId === m.id).map((v) => v.amount), percent);
    const payout = payouts.find((p) => p.masterId === m.id);
    const paid = payout?.status === "paid";
    const calculated = paid ? payout.calculatedAmount : f.calculated;
    const adjustment = payout?.adjustmentAmount ?? 0;
    return {
      masterId: m.id,
      masterName: m.name,
      visitCount: f.visitCount,
      revenue: f.revenue,
      calculated,
      adjustment,
      adjustmentReason: payout?.adjustmentReason ?? null,
      final: calculated + adjustment,
      status: paid ? "paid" : "pending",
    };
  });
}

async function liveCalculated(masterId: string, start: Date, end: Date): Promise<number> {
  const percent = await getMasterSharePercent();
  const visits = await prisma.visit.findMany({
    where: { masterId, visitDate: { gte: start, lte: end } },
    select: { amount: true },
  });
  return figures(visits.map((v) => v.amount), percent).calculated;
}

async function requireMaster(masterId: string) {
  const m = await prisma.user.findUnique({ where: { id: masterId } });
  if (!m || m.role !== "master") throw new ValidationError("Мастер не найден");
}

export async function markPaid(actor: User, masterId: string, period: Period): Promise<void> {
  requireRole(actor, "admin");
  const { start, end } = assertPeriod(period);
  await requireMaster(masterId);
  const key = { masterId_periodStart_periodEnd: { masterId, periodStart: start, periodEnd: end } };
  const existing = await prisma.payout.findUnique({ where: key });
  if (existing?.status === "paid") throw new ValidationError("Этот период уже отмечен как выплаченный");
  const calculated = await liveCalculated(masterId, start, end);
  const adjustment = existing?.adjustmentAmount ?? 0;
  const data = {
    calculatedAmount: calculated,
    finalAmount: calculated + adjustment,
    status: "paid" as const,
    paidAt: new Date(),
    paidById: actor.id,
  };
  await prisma.payout.upsert({
    where: key,
    update: data,
    create: { masterId, periodStart: start, periodEnd: end, adjustmentAmount: 0, ...data },
  });
}

export async function adjustPayout(
  actor: User,
  masterId: string,
  period: Period,
  adjustment: number,
  reason: string,
): Promise<void> {
  requireRole(actor, "admin");
  const { start, end } = assertPeriod(period);
  await requireMaster(masterId);
  const clean = reason.trim();
  if (!clean) throw new ValidationError("Укажите причину корректировки");
  if (!Number.isInteger(adjustment)) throw new ValidationError("Корректировка должна быть целым числом тенге");
  const key = { masterId_periodStart_periodEnd: { masterId, periodStart: start, periodEnd: end } };
  const existing = await prisma.payout.findUnique({ where: key });
  const calculated =
    existing?.status === "paid" ? existing.calculatedAmount : await liveCalculated(masterId, start, end);
  const final = calculated + adjustment;
  if (final < 0) throw new ValidationError("Итог выплаты не может быть отрицательным");
  await prisma.payout.upsert({
    where: key,
    update: { adjustmentAmount: adjustment, adjustmentReason: clean, calculatedAmount: calculated, finalAmount: final },
    create: {
      masterId,
      periodStart: start,
      periodEnd: end,
      calculatedAmount: calculated,
      adjustmentAmount: adjustment,
      adjustmentReason: clean,
      finalAmount: final,
      status: "pending",
    },
  });
}

export async function adjustVisitAmount(
  actor: User,
  visitId: string,
  newAmount: unknown,
  reason: string,
): Promise<void> {
  requireRole(actor, "admin");
  const clean = reason.trim();
  if (!clean) throw new ValidationError("Укажите причину изменения");
  const amount = parseAmount(newAmount);
  const visit = await prisma.visit.findUnique({ where: { id: visitId } });
  if (!visit) throw new NotFoundError("Визит не найден");
  const p = periodFor(visit.visitDate.toISOString().slice(0, 10));
  const paid = await prisma.payout.findFirst({
    where: { masterId: visit.masterId, periodStart: toDate(p.start), periodEnd: toDate(p.end), status: "paid" },
  });
  if (paid) throw new PeriodPaidError();
  await prisma.$transaction([
    prisma.visitAdjustment.create({
      data: { visitId, oldAmount: visit.amount, newAmount: amount, reason: clean, changedById: actor.id },
    }),
    prisma.visit.update({ where: { id: visitId }, data: { amount } }),
  ]);
}
