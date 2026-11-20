import type { DiscountBearer, PaymentMethod, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { almatyDayBounds } from "@/lib/dates";
import { masterShareOf } from "@/lib/money";
import { todayInBusinessTz } from "@/lib/periods";
import { paymentBreakdown } from "@/lib/split";
import { getMasterSharePercent } from "./settings";
import { toDate } from "./visits";

export type MethodTotals = Record<PaymentMethod, number>;

export type RangeReport = {
  start: string;
  end: string;
  visitCount: number;
  /** Итоговые суммы выполненных записей + предоплаты, удержанные при отмене. Предоплата внутри суммы, не сверх неё. */
  revenue: number;
  mastersTotal: number;
  /** Доход салона: доли салона по выполненным записям + удержанные предоплаты. */
  salonShare: number;
  byMethod: MethodTotals;
  masters: { masterId: string; masterName: string; visitCount: number; revenue: number; earned: number }[];
  prepayments: { applied: number; forfeited: number; refunded: number };
  discounts: {
    visitId: string;
    date: string;
    clientName: string | null;
    masterName: string;
    listAmount: number;
    percent: number;
    amount: number;
    reason: string | null;
    bearer: DiscountBearer | null;
    finalAmount: number;
    master: number;
    salon: number;
  }[];
  discountTotal: number;
  /** «Блогер / Реклама» — отдельная категория, не скидка. */
  blogger: { count: number; total: number; masterEarned: number };
  /** Закрытые дни периода с расхождением: берутся из сохранённых закрытий. */
  closings: { date: string; difference: number; comment: string | null }[];
  closedDays: number;
  /** Дни с выполненными визитами, которые ещё не закрыты (до сегодняшнего включительно). */
  unclosedDays: string[];
};

const zeroMethods = (): MethodTotals => ({ cash: 0, kaspi: 0, kaspi_red: 0, halyk: 0, transfer: 0 });

/**
 * Отчёт за любой диапазон дат. Только читает выполненные визиты и сохранённые закрытия дней,
 * ничего не начисляет и не пересчитывает, поэтому повторный запрос даёт тот же результат.
 */
export async function reportForRange(actor: User, start: string, end: string): Promise<RangeReport> {
  requireRole(actor, "admin");
  const range = { gte: toDate(start), lte: toDate(end) };
  const percent = await getMasterSharePercent();
  const bounds = { from: almatyDayBounds(start).from, to: almatyDayBounds(end).to };
  const [visits, closings, cancelled] = await Promise.all([
    prisma.visit.findMany({
      where: { visitDate: range, status: "done" },
      select: {
        id: true, visitDate: true, amount: true, listAmount: true, paymentMethod: true, masterId: true,
        masterAmount: true, salonAmount: true, prepaidAmount: true, prepaidMethod: true,
        discountPercent: true, discountAmount: true, discountReason: true, discountBearer: true, isBlogger: true,
        master: { select: { name: true } }, client: { select: { name: true } },
      },
      orderBy: [{ visitDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.dayClosing.findMany({ where: { closingDate: range }, orderBy: { closingDate: "asc" } }),
    prisma.visit.findMany({ where: { status: "cancelled", prepaidAmount: { gt: 0 }, cancelledAt: { gte: bounds.from, lt: bounds.to } }, select: { prepaidAmount: true, prepaidMethod: true } }),
  ]);
  const byMaster = new Map<string, RangeReport["masters"][number]>();
  const byMethod = zeroMethods();
  const discounts: RangeReport["discounts"] = [];
  const blogger = { count: 0, total: 0, masterEarned: 0 };
  const prepay = { applied: 0, forfeited: 0, refunded: 0 };
  let revenue = 0;
  let mastersTotal = 0;
  let salonTotal = 0;
  for (const v of visits) {
    const master = masterShareOf(v, percent);
    const salon = v.salonAmount ?? v.amount - master;
    revenue += v.amount;
    mastersTotal += master;
    salonTotal += salon;
    for (const part of paymentBreakdown({ finalAmount: v.amount, prepaid: v.prepaidAmount, prepaidMethod: v.prepaidMethod, method: v.paymentMethod })) byMethod[part.method] += part.amount;
    const applied = v.prepaidMethod ? Math.min(v.prepaidAmount, v.amount) : 0;
    prepay.applied += applied;
    prepay.refunded += v.prepaidMethod ? v.prepaidAmount - applied : 0;
    const m = byMaster.get(v.masterId) ?? { masterId: v.masterId, masterName: v.master.name, visitCount: 0, revenue: 0, earned: 0 };
    m.visitCount += 1;
    m.revenue += v.amount;
    m.earned += master;
    byMaster.set(v.masterId, m);
    if (v.discountPercent > 0) {
      discounts.push({
        visitId: v.id, date: v.visitDate.toISOString().slice(0, 10), clientName: v.client?.name ?? null, masterName: v.master.name,
        listAmount: v.listAmount ?? v.amount, percent: v.discountPercent, amount: v.discountAmount, reason: v.discountReason,
        bearer: v.discountBearer, finalAmount: v.amount, master, salon,
      });
    }
    if (v.isBlogger) {
      blogger.count += 1;
      blogger.total += v.amount;
      blogger.masterEarned += master;
    }
  }
  for (const c of cancelled) {
    prepay.forfeited += c.prepaidAmount;
    byMethod[c.prepaidMethod ?? "transfer"] += c.prepaidAmount;
  }
  const closedSet = new Set(closings.filter((c) => c.isClosed).map((c) => c.closingDate.toISOString().slice(0, 10)));
  const today = todayInBusinessTz(new Date());
  const unclosedDays = [...new Set(visits.map((v) => v.visitDate.toISOString().slice(0, 10)))]
    .filter((d) => d <= today && !closedSet.has(d))
    .sort();
  return {
    start,
    end,
    visitCount: visits.length,
    revenue: revenue + prepay.forfeited,
    mastersTotal,
    salonShare: salonTotal + prepay.forfeited,
    byMethod,
    masters: [...byMaster.values()].sort((a, b) => a.masterName.localeCompare(b.masterName, "ru")),
    prepayments: prepay,
    discounts,
    discountTotal: discounts.reduce((s, d) => s + d.amount, 0),
    blogger,
    closings: closings
      .filter((c) => c.isClosed && c.difference !== 0)
      .map((c) => ({ date: c.closingDate.toISOString().slice(0, 10), difference: c.difference, comment: c.comment })),
    closedDays: closedSet.size,
    unclosedDays,
  };
}

/** Календарный месяц, в который входит дата. */
export function monthRange(iso: string): { start: string; end: string } {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ym = `${y}-${String(m).padStart(2, "0")}`;
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}

export function previousMonthRange(iso: string): { start: string; end: string } {
  const [y, m] = iso.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return monthRange(`${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`);
}
