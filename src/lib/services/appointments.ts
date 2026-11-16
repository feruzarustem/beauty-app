import type { DiscountBearer, PaymentMethod, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { NotFoundError, PeriodPaidError, ValidationError } from "@/lib/errors";
import { periodFor, todayInBusinessTz } from "@/lib/periods";
import { PAYMENT_METHODS, PREPAY_METHODS } from "@/lib/payment";
import { PREPAY_AMOUNT } from "@/lib/split";
import { audit } from "./audit";
import { assertDayOpen, assertEndsInTime, assertNoOverlap, assertNotDayOff, assertWorkingTime, parseDuration } from "./guards";
import { splitData } from "./splitStore";
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
  const v = await prisma.visit.findFirst({ where: { id, ...(onlyMaster ? { masterId: onlyMaster } : {}) }, include: { master: { select: { category: true } } } });
  if (!v) throw new NotFoundError();
  if (v.status !== "scheduled") throw new ValidationError("Запись уже выполнена или отменена");
  return v;
}

/**
 * «Выполнено»: администратор или сам мастер (только свою запись). Сумму не меняет: цену и скидку задаёт администратор.
 * При отметке сохраняются доли мастера и салона. Не раньше дня записи, не в закрытом дне, не в выплаченном периоде.
 */
export async function completeVisit(actor: User, visitId: string): Promise<void> {
  if (actor.role !== "admin" && actor.role !== "master") requireRole(actor, "admin");
  const v = await scheduledVisit(visitId, actor.role === "master" ? actor.id : undefined);
  const date = iso(v.visitDate);
  if (date > todayInBusinessTz(new Date())) throw new ValidationError("Нельзя отметить будущую запись выполненной");
  await assertDayOpen(date);
  await assertPeriodNotPaid(v.masterId, date);
  const { data } = await splitData(
    { listAmount: v.listAmount ?? v.amount, discountPercent: v.discountPercent, discountBearer: v.discountBearer, isBlogger: v.isBlogger, prepaidAmount: v.prepaidAmount, prepaidMethod: v.prepaidMethod },
    v.master.category,
  );
  // Условное обновление: повторное нажатие не пройдёт, начисление за одну процедуру одно.
  const res = await prisma.visit.updateMany({
    where: { id: v.id, status: "scheduled" },
    data: { ...(data as object), status: "done", completedAt: new Date(), completedById: actor.id },
  });
  if (res.count === 0) throw new ValidationError("Запись уже выполнена или отменена");
  await audit(actor, "visit.complete", "Visit", v.id, `${date} ${v.startTime ?? ""}`.trim());
}

export type CloseInput = {
  discountPercent: unknown;
  discountReason?: string;
  discountBearer?: DiscountBearer | null;
  isBlogger?: boolean;
  /** Способ оплаты остатка. */
  paymentMethod: PaymentMethod;
  /** Предоплата 2 000 ₸ получена. Если не указано, остаётся как есть. */
  prepaid?: boolean;
  prepaidMethod?: PaymentMethod;
  /** Подтверждение предупреждения о сокращении долей. */
  acknowledgeWarning?: boolean;
};

/**
 * Закрытие записи администратором: скидка (процент, причина, за чей счёт), «Блогер / Реклама», способ оплаты остатка.
 * Работает для запланированной записи и для уже отмеченной мастером как выполненная (пока день и период открыты).
 */
export async function closeVisit(actor: User, visitId: string, input: CloseInput): Promise<{ warning: string | null }> {
  requireRole(actor, "admin");
  const v = await prisma.visit.findUnique({ where: { id: visitId }, include: { master: { select: { category: true } } } });
  if (!v) throw new NotFoundError();
  if (v.status === "cancelled") throw new ValidationError("Запись отменена");
  const date = iso(v.visitDate);
  if (date > todayInBusinessTz(new Date())) throw new ValidationError("Нельзя закрыть будущую запись");
  await assertDayOpen(date);
  await assertPeriodNotPaid(v.masterId, date);
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) throw new ValidationError("Выберите способ оплаты");

  const percent = typeof input.discountPercent === "number" ? input.discountPercent : Number(String(input.discountPercent ?? "0").trim() || "0");
  if (!Number.isInteger(percent)) throw new ValidationError("Скидка — целое число процентов от 0 до 100");
  const reason = (input.discountReason ?? "").trim();
  if (percent > 0 && reason.length < 3) throw new ValidationError("Укажите причину скидки");
  const bearer = percent > 0 ? (input.discountBearer ?? null) : null;
  const blogger = input.isBlogger === true;

  const prepaidAmount = input.prepaid === undefined ? v.prepaidAmount : input.prepaid ? PREPAY_AMOUNT : 0;
  const prepaidMethod = prepaidAmount > 0 ? (input.prepaidMethod ?? v.prepaidMethod ?? "transfer") : null;
  if (prepaidMethod && !PREPAY_METHODS.includes(prepaidMethod)) throw new ValidationError("Предоплата принимается только безналичной");

  const { result, data } = await splitData(
    { listAmount: v.listAmount ?? v.amount, discountPercent: percent, discountBearer: bearer, isBlogger: blogger, prepaidAmount, prepaidMethod },
    v.master.category,
  );
  if (result.warning && input.acknowledgeWarning !== true) {
    throw new ValidationError(`${result.warning} Подтвердите, чтобы продолжить.`);
  }
  await prisma.$transaction([
    ...(v.status === "done" && v.amount !== result.finalAmount
      ? [prisma.visitAdjustment.create({ data: { visitId, oldAmount: v.amount, newAmount: result.finalAmount, reason: reason || "Пересчёт при закрытии записи", changedById: actor.id } })]
      : []),
    prisma.visit.update({
      where: { id: visitId },
      data: {
        ...(data as object),
        status: "done",
        completedAt: v.completedAt ?? new Date(),
        completedById: v.completedById ?? actor.id,
        paymentMethod: input.paymentMethod,
        discountPercent: percent,
        discountReason: percent > 0 ? reason : null,
        discountBearer: bearer,
        isBlogger: blogger,
        prepaidAmount,
        prepaidMethod,
      },
    }),
  ]);
  await audit(
    actor,
    "visit.close",
    "Visit",
    visitId,
    `${date}: ${v.amount} → ${result.finalAmount}; скидка ${percent}%${bearer ? ` (${bearer})` : ""}${blogger ? "; блогер/реклама" : ""}; мастер ${result.master}, салон ${result.salon}`,
  );
  return { warning: result.warning };
}

/** Отмена записи. Предоплата при отмене клиенту не возвращается и остаётся салону (доход в день отмены). */
export async function cancelVisit(actor: User, visitId: string, reason: string): Promise<void> {
  requireRole(actor, "admin");
  const clean = reason.trim();
  if (!clean) throw new ValidationError("Укажите причину отмены");
  const v = await scheduledVisit(visitId);
  await assertDayOpen(iso(v.visitDate));
  if (v.prepaidAmount > 0) await assertDayOpen(todayInBusinessTz(new Date()));
  await prisma.visit.update({ where: { id: v.id }, data: { status: "cancelled", cancelledReason: clean, cancelledAt: new Date() } });
  await audit(actor, "visit.cancel", "Visit", v.id, v.prepaidAmount > 0 ? `${clean}; предоплата ${v.prepaidAmount} остаётся салону` : clean);
}

export async function moveVisit(
  actor: User,
  visitId: string,
  to: { date: string; time: string; durationMin?: unknown },
): Promise<void> {
  requireRole(actor, "admin");
  const v = await scheduledVisit(visitId);
  const time = assertWorkingTime(to.time);
  const date = toDate(to.date);
  const hasDuration = to.durationMin !== undefined && to.durationMin !== null && to.durationMin !== "";
  const duration = hasDuration ? parseDuration(to.durationMin) : (v.durationMin ?? 60);
  assertEndsInTime(time, duration);
  await assertDayOpen(iso(v.visitDate));
  await assertDayOpen(to.date);
  await assertNotDayOff(v.masterId, to.date);
  await assertPeriodNotPaid(v.masterId, to.date);
  await assertNoOverlap(v.masterId, to.date, time, duration, v.id);
  await prisma.visit.update({ where: { id: v.id }, data: { visitDate: date, startTime: time, durationMin: duration } });
  await audit(actor, "visit.move", "Visit", v.id, `${iso(v.visitDate)} ${v.startTime} → ${to.date} ${time}`);
}

/** Редактирование записи на будущее: мастер, клиент, услуги, длительность, предоплата, оплата. Сумму считает сервер. */
export async function updateScheduledVisit(
  actor: User,
  visitId: string,
  input: {
    masterId: string;
    clientId: string;
    paymentMethod: PaymentMethod;
    items: { serviceId: string; price: unknown; belowMinReason?: string }[];
    durationMin?: unknown;
    prepaid?: boolean;
    prepaidMethod?: PaymentMethod;
  },
): Promise<void> {
  requireRole(actor, "admin");
  const v = await scheduledVisit(visitId);
  const date = iso(v.visitDate);
  await assertDayOpen(date);
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) throw new ValidationError("Выберите способ оплаты");
  if (!(await prisma.client.findUnique({ where: { id: input.clientId } }))) throw new ValidationError("Клиент не найден");
  if (input.masterId !== v.masterId) await assertNotDayOff(input.masterId, date);
  const hasDuration = input.durationMin !== undefined && input.durationMin !== null && input.durationMin !== "";
  const duration = hasDuration ? parseDuration(input.durationMin) : (v.durationMin ?? 60);
  if (v.startTime) {
    assertEndsInTime(v.startTime, duration);
    await assertNoOverlap(input.masterId, date, v.startTime, duration, v.id);
  }
  const prepaidAmount = input.prepaid === undefined ? v.prepaidAmount : input.prepaid ? PREPAY_AMOUNT : 0;
  const prepaidMethod = prepaidAmount > 0 ? (input.prepaidMethod ?? v.prepaidMethod ?? "transfer") : null;
  if (prepaidMethod && !PREPAY_METHODS.includes(prepaidMethod)) throw new ValidationError("Предоплата принимается только безналичной");
  const { items, total } = await buildItems(actor, input.masterId, input.items);
  await prisma.$transaction([
    prisma.visitItem.deleteMany({ where: { visitId } }),
    prisma.visit.update({
      where: { id: visitId },
      data: {
        masterId: input.masterId,
        clientId: input.clientId,
        paymentMethod: input.paymentMethod,
        amount: total,
        listAmount: total,
        durationMin: duration,
        prepaidAmount,
        prepaidMethod,
        items: { create: items },
      },
    }),
  ]);
  await audit(actor, "visit.update", "Visit", visitId, `сумма ${v.amount} → ${total}`);
}
