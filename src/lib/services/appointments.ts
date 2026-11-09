import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { NotFoundError, PeriodPaidError, ValidationError } from "@/lib/errors";
import { periodFor, todayInBusinessTz } from "@/lib/periods";
import type { PaymentMethod } from "@prisma/client";
import { PAYMENT_METHODS } from "@/lib/payment";
import { audit } from "./audit";
import { assertDayOpen, assertNotDayOff, assertWorkingTime } from "./guards";
import { buildItems, toDate } from "./visits";

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function assertPeriodNotPaid(masterId: string, dateIso: string): Promise<void> {
  const p = periodFor(dateIso);
  const paid = await prisma.payout.findFirst({
    where: { masterId, periodStart: toDate(p.start), periodEnd: toDate(p.end), status: "paid" },
  });
  if (paid) throw new PeriodPaidError();
}

async function scheduledVisit(id: string, onlyMaster?: string) {
  const v = await prisma.visit.findFirst({ where: { id, ...(onlyMaster ? { masterId: onlyMaster } : {}) } });
  if (!v) throw new NotFoundError();
  if (v.status !== "scheduled") throw new ValidationError("Запись уже выполнена или отменена");
  return v;
}

/**
 * «Выполнено»: администратор или сам мастер (только свою запись). Сумму не меняет:
 * она установлена администратором. Не раньше дня записи, не в закрытом дне, не в выплаченном периоде.
 */
export async function completeVisit(actor: User, visitId: string): Promise<void> {
  if (actor.role !== "admin" && actor.role !== "master") requireRole(actor, "admin");
  const v = await scheduledVisit(visitId, actor.role === "master" ? actor.id : undefined);
  const date = iso(v.visitDate);
  if (date > todayInBusinessTz(new Date())) throw new ValidationError("Нельзя отметить будущую запись выполненной");
  await assertDayOpen(date);
  await assertPeriodNotPaid(v.masterId, date);
  // Условное обновление: повторное нажатие не пройдёт, начисление за одну процедуру одно.
  const res = await prisma.visit.updateMany({
    where: { id: v.id, status: "scheduled" },
    data: { status: "done", completedAt: new Date(), completedById: actor.id },
  });
  if (res.count === 0) throw new ValidationError("Запись уже выполнена или отменена");
  await audit(actor, "visit.complete", "Visit", v.id, `${date} ${v.startTime ?? ""}`.trim());
}

export async function cancelVisit(actor: User, visitId: string, reason: string): Promise<void> {
  requireRole(actor, "admin");
  const clean = reason.trim();
  if (!clean) throw new ValidationError("Укажите причину отмены");
  const v = await scheduledVisit(visitId);
  await assertDayOpen(iso(v.visitDate));
  await prisma.visit.update({ where: { id: v.id }, data: { status: "cancelled", cancelledReason: clean } });
  await audit(actor, "visit.cancel", "Visit", v.id, clean);
}

export async function moveVisit(actor: User, visitId: string, to: { date: string; time: string }): Promise<void> {
  requireRole(actor, "admin");
  const v = await scheduledVisit(visitId);
  const time = assertWorkingTime(to.time);
  const date = toDate(to.date);
  await assertDayOpen(iso(v.visitDate));
  await assertDayOpen(to.date);
  await assertNotDayOff(v.masterId, to.date);
  await assertPeriodNotPaid(v.masterId, to.date);
  await prisma.visit.update({ where: { id: v.id }, data: { visitDate: date, startTime: time } });
  await audit(actor, "visit.move", "Visit", v.id, `${iso(v.visitDate)} ${v.startTime} → ${to.date} ${time}`);
}

/** Редактирование записи на будущее: мастер, клиент, услуги, оплата. Сумму считает сервер. */
export async function updateScheduledVisit(
  actor: User,
  visitId: string,
  input: {
    masterId: string;
    clientId: string;
    paymentMethod: PaymentMethod;
    items: { serviceId: string; price: unknown; belowMinReason?: string }[];
  },
): Promise<void> {
  requireRole(actor, "admin");
  const v = await scheduledVisit(visitId);
  const date = iso(v.visitDate);
  await assertDayOpen(date);
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) throw new ValidationError("Выберите способ оплаты");
  if (!(await prisma.client.findUnique({ where: { id: input.clientId } }))) throw new ValidationError("Клиент не найден");
  if (input.masterId !== v.masterId) await assertNotDayOff(input.masterId, date);
  const { items, total } = await buildItems(actor, input.masterId, input.items);
  await prisma.$transaction([
    prisma.visitItem.deleteMany({ where: { visitId } }),
    prisma.visit.update({
      where: { id: visitId },
      data: { masterId: input.masterId, clientId: input.clientId, paymentMethod: input.paymentMethod, amount: total, items: { create: items } },
    }),
  ]);
  await audit(actor, "visit.update", "Visit", visitId, `сумма ${v.amount} → ${total}`);
}
