import type { DayClosing, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { ValidationError } from "@/lib/errors";
import { masterShare } from "@/lib/money";
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
  /** Записи этого дня, которым ещё не присвоен статус «выполнено» или «отменено». */
  unfinished: number;
};

/** Показатели дня по выполненным визитам. Ничего не пишет в базу. */
export async function dayFigures(actor: User, iso: string): Promise<DayFigures> {
  requireRole(actor, "admin");
  const date = toDate(iso);
  const percent = await getMasterSharePercent();
  const [done, unfinished] = await Promise.all([
    prisma.visit.findMany({ where: { visitDate: date, status: "done" }, select: { amount: true, paymentMethod: true } }),
    prisma.visit.count({ where: { visitDate: date, status: "scheduled" } }),
  ]);
  const revenue = done.reduce((s, v) => s + v.amount, 0);
  const mastersTotal = done.reduce((s, v) => s + masterShare(v.amount, percent), 0);
  const by = (m: string) => done.filter((v) => v.paymentMethod === m).reduce((s, v) => s + v.amount, 0);
  return {
    date: iso,
    visitCount: done.length,
    revenue,
    mastersTotal,
    salonShare: revenue - mastersTotal,
    cashTotal: by("cash"),
    kaspiTotal: by("kaspi"),
    transferTotal: by("transfer"),
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
