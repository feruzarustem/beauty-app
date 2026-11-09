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

export type AppointmentDetail = CalendarEntry & {
  clientId: string | null;
  clientPhone: string | null;
  cancelledReason: string | null;
  items: { id: string; serviceId: string | null; name: string; price: number; priceMin: number; belowMinReason: string | null }[];
};

/** Карточка записи для администратора (с телефоном клиента). */
export async function getAppointment(actor: User, id: string): Promise<AppointmentDetail | null> {
  requireRole(actor, "admin");
  const v = await prisma.visit.findUnique({
    where: { id },
    include: {
      master: { select: { name: true } },
      client: { select: { name: true, contact: { select: { phone: true } } } },
      items: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!v) return null;
  return {
    id: v.id,
    date: v.visitDate.toISOString().slice(0, 10),
    time: v.startTime,
    masterId: v.masterId,
    masterName: v.master.name,
    clientId: v.clientId,
    clientName: v.client?.name ?? null,
    clientPhone: v.client?.contact?.phone ?? null,
    services: v.items.map((i) => i.name),
    status: v.status,
    amount: v.amount,
    paymentMethod: v.paymentMethod,
    cancelledReason: v.cancelledReason,
    items: v.items.map((i) => ({ id: i.id, serviceId: i.serviceId, name: i.name, price: i.price, priceMin: i.priceMin, belowMinReason: i.belowMinReason })),
  };
}
