import type { DayClosing, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { ValidationError } from "@/lib/errors";
import { masterShareOf } from "@/lib/money";
import { paymentBreakdown } from "@/lib/split";
import { almatyDayBounds } from "@/lib/dates";
import { todayInBusinessTz } from "@/lib/periods";
import { audit } from "./audit";
import { getMasterSharePercent } from "./settings";
import { toDate } from "./visits";

export type DayFigures = {
  date: string;
  visitCount: number;
  revenue: number;
  mastersTotal: number;
  salonShare: number;
  cashTotal: number;
  kaspiTotal: number;
  transferTotal: number;
  kaspiRedTotal: number;
  halykTotal: number;
  /** Предоплаты отменённых сегодня записей: не возвращаются клиенту и остаются салону. */
  forfeitedPrepay: number;
  /** Записи этого дня, которым ещё не присвоен статус «выполнено» или «отменено». */
  unfinished: number;
};

/**
 * Показатели дня по выполненным визитам (доли берутся из сохранённых при закрытии записи).
 * Выручка = итоговые суммы выполненных записей + предоплаты, удержанные при отмене в этот день.
 * Наличные по системе — только остатки, оплаченные наличными: предоплата безналичная.
 */
export async function dayFigures(actor: User, iso: string): Promise<DayFigures> {
  requireRole(actor, "admin");
  const date = toDate(iso);
  const percent = await getMasterSharePercent();
  const { from, to } = almatyDayBounds(iso);
  const [done, unfinished, cancelled] = await Promise.all([
    prisma.visit.findMany({
      where: { visitDate: date, status: "done" },
      select: { amount: true, masterAmount: true, salonAmount: true, paymentMethod: true, prepaidAmount: true, prepaidMethod: true },
    }),
    prisma.visit.count({ where: { visitDate: date, status: "scheduled" } }),
    prisma.visit.findMany({ where: { status: "cancelled", prepaidAmount: { gt: 0 }, cancelledAt: { gte: from, lt: to } }, select: { prepaidAmount: true, prepaidMethod: true } }),
  ]);
  const by: Record<string, number> = { cash: 0, kaspi: 0, kaspi_red: 0, halyk: 0, transfer: 0 };
  for (const v of done) {
    for (const part of paymentBreakdown({ finalAmount: v.amount, prepaid: v.prepaidAmount, prepaidMethod: v.prepaidMethod, method: v.paymentMethod })) by[part.method] += part.amount;
  }
  let forfeited = 0;
  for (const c of cancelled) {
    forfeited += c.prepaidAmount;
    by[c.prepaidMethod ?? "transfer"] += c.prepaidAmount;
  }
  const doneRevenue = done.reduce((s, v) => s + v.amount, 0);
  const mastersTotal = done.reduce((s, v) => s + masterShareOf(v, percent), 0);
  const salonDone = done.reduce((s, v) => s + (v.salonAmount ?? v.amount - masterShareOf(v, percent)), 0);
  return {
    date: iso,
    visitCount: done.length,
    revenue: doneRevenue + forfeited,
    mastersTotal,
    salonShare: salonDone + forfeited,
    cashTotal: by.cash,
    kaspiTotal: by.kaspi,
    transferTotal: by.transfer,
    kaspiRedTotal: by.kaspi_red,
    halykTotal: by.halyk,
    forfeitedPrepay: forfeited,
    unfinished,
  };
}

export async function getClosing(actor: User, iso: string): Promise<DayClosing | null> {
  requireRole(actor, "admin");
  return prisma.dayClosing.findUnique({ where: { closingDate: toDate(iso) } });
}

function parseCash(input: unknown): number {
  const n = typeof input === "number" ? input : typeof input === "string" && /^\d+$/.test(input) ? Number(input) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000) throw new ValidationError("Фактическая сумма в кассе — целое число тенге, от 0");
  return n;
}

/**
 * Закрытие дня (рекомендуемое время 22:30–00:00, жёстко не ограничено). Фиксирует показатели.
 * Расхождение (факт − наличные по системе) требует комментария и не «исправляется» автоматически.
 */
export async function closeDay(actor: User, iso: string, actualCash: unknown, comment?: string): Promise<void> {
  requireRole(actor, "admin");
  if (iso > todayInBusinessTz(new Date())) throw new ValidationError("Нельзя закрыть день, который ещё не наступил");
  const existing = await prisma.dayClosing.findUnique({ where: { closingDate: toDate(iso) } });
  if (existing?.isClosed) throw new ValidationError("День уже закрыт");
  const f = await dayFigures(actor, iso);
  if (f.unfinished > 0) {
    throw new ValidationError(`Есть записи без статуса (${f.unfinished}). Отметьте их выполненными или отмените.`);
  }
  const actual = parseCash(actualCash);
  const difference = actual - f.cashTotal;
  const note = (comment ?? "").trim();
  if (difference !== 0 && note.length < 3) throw new ValidationError("Есть расхождение с кассой. Укажите комментарий.");
  const data = {
    expectedCash: f.cashTotal,
    actualCash: actual,
    difference,
    closedById: actor.id,
    closedAt: new Date(),
    comment: note || null,
    visitCount: f.visitCount,
    revenue: f.revenue,
    mastersTotal: f.mastersTotal,
    salonShare: f.salonShare,
    cashTotal: f.cashTotal,
    kaspiTotal: f.kaspiTotal,
    transferTotal: f.transferTotal,
    kaspiRedTotal: f.kaspiRedTotal,
    halykTotal: f.halykTotal,
    forfeitedPrepay: f.forfeitedPrepay,
    isClosed: true,
  };
  await prisma.dayClosing.upsert({ where: { closingDate: toDate(iso) }, create: { closingDate: toDate(iso), ...data }, update: data });
  await audit(actor, "day.close", "DayClosing", iso, `выручка ${f.revenue}, касса ${actual}, расхождение ${difference}${note ? `: ${note}` : ""}`);
}

/** Повторное открытие закрытого дня: только администратор, причина обязательна. */
export async function reopenDay(actor: User, iso: string, reason: string): Promise<void> {
  requireRole(actor, "admin");
  const clean = reason.trim();
  if (clean.length < 3) throw new ValidationError("Укажите причину повторного открытия");
  const existing = await prisma.dayClosing.findUnique({ where: { closingDate: toDate(iso) } });
  if (!existing?.isClosed) throw new ValidationError("День не закрыт");
  await prisma.dayClosing.update({
    where: { closingDate: toDate(iso) },
    data: { isClosed: false, reopenedAt: new Date(), reopenedById: actor.id, reopenReason: clean },
  });
  await audit(actor, "day.reopen", "DayClosing", iso, clean);
}
