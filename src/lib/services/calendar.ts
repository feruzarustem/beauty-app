import type { User, VisitStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { toDate } from "./visits";

export type CalendarEntry = {
  id: string;
  date: string;
  time: string | null;
  masterId: string;
  masterName: string;
  clientName: string | null;
  services: string[];
  status: VisitStatus;
  amount: number;
  paymentMethod: PaymentMethod;
};

/** Единый календарь салона: те же визиты, что видит мастер, но без ограничения по мастеру. */
export async function calendarRange(actor: User, fromIso: string, toIso: string) {
  requireRole(actor, "admin");
  const range = { gte: toDate(fromIso), lte: toDate(toIso) };
  const [visits, off] = await Promise.all([
    prisma.visit.findMany({
      where: { visitDate: range },
      include: { master: { select: { name: true } }, client: { select: { name: true } }, items: { select: { name: true } } },
      orderBy: [{ visitDate: "asc" }, { startTime: "asc" }, { createdAt: "asc" }],
    }),
    prisma.dayOff.findMany({ where: { date: range }, orderBy: { date: "asc" } }),
  ]);
  const entries: CalendarEntry[] = visits.map((v) => ({
    id: v.id,
    date: v.visitDate.toISOString().slice(0, 10),
    time: v.startTime,
    masterId: v.masterId,
    masterName: v.master.name,
    clientName: v.client?.name ?? null,
    services: v.items.map((i) => i.name),
    status: v.status,
    amount: v.amount,
    paymentMethod: v.paymentMethod,
  }));
  return { entries, daysOff: off.map((d) => ({ masterId: d.masterId, date: d.date.toISOString().slice(0, 10) })) };
}
