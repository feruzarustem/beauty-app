import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { masterShare } from "@/lib/money";
import { todayInBusinessTz } from "@/lib/periods";
import { getMasterSharePercent } from "./settings";
import { toDate } from "./visits";

export type RangeReport = {
  start: string;
  end: string;
  visitCount: number;
  revenue: number;
  mastersTotal: number;
  salonShare: number;
  byMethod: { cash: number; kaspi: number; transfer: number };
  masters: { masterId: string; masterName: string; visitCount: number; revenue: number; earned: number }[];
  /** Закрытые дни периода с расхождением: берутся из сохранённых закрытий. */
  closings: { date: string; difference: number; comment: string | null }[];
  closedDays: number;
  /** Дни с выполненными визитами, которые ещё не закрыты (до сегодняшнего включительно). */
  unclosedDays: string[];
};

/**
 * Отчёт за любой диапазон дат. Только читает выполненные визиты и сохранённые закрытия дней,
 * ничего не начисляет и не пересчитывает, поэтому повторный запрос даёт тот же результат.
 */
export async function reportForRange(actor: User, start: string, end: string): Promise<RangeReport> {
  requireRole(actor, "admin");
  const range = { gte: toDate(start), lte: toDate(end) };
  const percent = await getMasterSharePercent();
  const [visits, closings] = await Promise.all([
    prisma.visit.findMany({
      where: { visitDate: range, status: "done" },
      select: { visitDate: true, amount: true, paymentMethod: true, masterId: true, master: { select: { name: true } } },
    }),
    prisma.dayClosing.findMany({ where: { closingDate: range }, orderBy: { closingDate: "asc" } }),
  ]);
  const byMaster = new Map<string, RangeReport["masters"][number]>();
  const byMethod = { cash: 0, kaspi: 0, transfer: 0 };
  let revenue = 0;
  let mastersTotal = 0;
  for (const v of visits) {
    const share = masterShare(v.amount, percent);
    revenue += v.amount;
    mastersTotal += share;
    byMethod[v.paymentMethod] += v.amount;
    const m = byMaster.get(v.masterId) ?? { masterId: v.masterId, masterName: v.master.name, visitCount: 0, revenue: 0, earned: 0 };
    m.visitCount += 1;
    m.revenue += v.amount;
    m.earned += share;
    byMaster.set(v.masterId, m);
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
    revenue,
    mastersTotal,
    salonShare: revenue - mastersTotal,
    byMethod,
    masters: [...byMaster.values()].sort((a, b) => a.masterName.localeCompare(b.masterName, "ru")),
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
