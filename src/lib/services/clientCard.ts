import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { NotFoundError } from "@/lib/errors";
import { todayInBusinessTz } from "@/lib/periods";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

export type ClientListItem = {
  id: string;
  name: string;
  masterName: string | null;
  phone: string | null;
  lastVisit: string | null;
  daysSince: number | null;
  totalVisits: number;
};

/** Клиенты с последним визитом. inactiveDays: только те, кто не был БОЛЕЕ N дней (кто ни разу не был — не включается). Только администратор. */
export async function listClientsWithHistory(actor: User, opts: { inactiveDays?: 30 | 45 | 60 | 90 }): Promise<ClientListItem[]> {
  requireRole(actor, "admin");
  const today = todayInBusinessTz(new Date());
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      name: true,
      assignedMaster: { select: { name: true } },
      contact: { select: { phone: true } },
      visits: { where: { status: "done" }, select: { visitDate: true } },
    },
    orderBy: { name: "asc" },
  });
  const rows = clients.map((c) => {
    const last = c.visits.map((v) => iso(v.visitDate)).sort().at(-1) ?? null;
    return {
      id: c.id,
      name: c.name,
      masterName: c.assignedMaster?.name ?? null,
      phone: c.contact?.phone ?? null,
      lastVisit: last,
      daysSince: last ? daysBetween(last, today) : null,
      totalVisits: c.visits.length,
    };
  });
  const n = opts.inactiveDays;
  return n ? rows.filter((r) => r.daysSince !== null && r.daysSince > n) : rows;
}

export type ClientCard = {
  id: string;
  name: string;
  phone: string | null;
  masterName: string | null;
  lastVisit: string | null;
  daysSince: number | null;
  totalVisits: number;
  history: { id: string; date: string; time: string | null; masterName: string; services: string[]; amount: number }[];
  nextAppointment: { id: string; date: string; time: string | null; masterName: string; services: string[] } | null;
  /** Для приглашения на повторную запись. */
  lastService: string | null;
  lastMasterName: string | null;
};

/** Карточка клиента для администратора: телефон, история процедур, ближайшая запись. История строится по выполненным записям и обновляется при закрытии записи. */
export async function getClientCard(actor: User, clientId: string): Promise<ClientCard> {
  requireRole(actor, "admin");
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      assignedMaster: { select: { name: true } },
      contact: { select: { phone: true } },
      visits: {
        where: { status: { in: ["done", "scheduled"] } },
        include: { master: { select: { name: true } }, items: { select: { name: true }, orderBy: { createdAt: "asc" } } },
        orderBy: [{ visitDate: "desc" }, { startTime: "desc" }],
      },
    },
  });
  if (!c) throw new NotFoundError();
  const today = todayInBusinessTz(new Date());
  const done = c.visits.filter((v) => v.status === "done");
  const upcoming = c.visits
    .filter((v) => v.status === "scheduled" && iso(v.visitDate) >= today)
    .sort((a, b) => (iso(a.visitDate) + (a.startTime ?? "")).localeCompare(iso(b.visitDate) + (b.startTime ?? "")))[0];
  const last = done[0];
  return {
    id: c.id,
    name: c.name,
    phone: c.contact?.phone ?? null,
    masterName: c.assignedMaster?.name ?? null,
    lastVisit: last ? iso(last.visitDate) : null,
    daysSince: last ? daysBetween(iso(last.visitDate), today) : null,
    totalVisits: done.length,
    history: done.map((v) => ({ id: v.id, date: iso(v.visitDate), time: v.startTime, masterName: v.master.name, services: v.items.map((i) => i.name), amount: v.amount })),
    nextAppointment: upcoming
      ? { id: upcoming.id, date: iso(upcoming.visitDate), time: upcoming.startTime, masterName: upcoming.master.name, services: upcoming.items.map((i) => i.name) }
      : null,
    lastService: last && last.items.length > 0 ? last.items.map((i) => i.name).join(", ") : null,
    lastMasterName: last?.master.name ?? null,
  };
}
