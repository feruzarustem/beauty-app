import type { MasterCategory, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { NotFoundError } from "@/lib/errors";
import { CATEGORY_ORDER } from "@/lib/categories";
import type { Period } from "@/lib/periods";
import { computePayroll } from "./payroll";
import { toDate } from "./visits";

export type MasterCard = { id: string; name: string; login: string };
export type CategoryGroup = { category: MasterCategory; masters: MasterCard[] };

/** Active masters grouped by category, in a fixed order. Admin only. */
export async function listMastersByCategory(actor: User): Promise<CategoryGroup[]> {
  requireRole(actor, "admin");
  const masters = await prisma.user.findMany({
    where: { role: "master", active: true, category: { not: null } },
    select: { id: true, name: true, login: true, category: true },
    orderBy: { name: "asc" },
  });
  return CATEGORY_ORDER.map((category) => ({
    category,
    masters: masters.filter((m) => m.category === category).map(({ id, name, login }) => ({ id, name, login })),
  }));
}

export type MasterProfile = {
  id: string;
  name: string;
  login: string;
  category: MasterCategory | null;
  active: boolean;
  visitCount: number;
  revenue: number;
  calculated: number;
  final: number;
  status: "pending" | "paid";
  visits: { id: string; visitDate: string; clientName: string | null; amount: number }[];
};

/** Admin view of one master: figures come from computePayroll, so the money rules stay in one place. */
export async function getMasterProfile(actor: User, masterId: string, period: Period): Promise<MasterProfile> {
  requireRole(actor, "admin");
  const master = await prisma.user.findFirst({ where: { id: masterId, role: "master" } });
  if (!master) throw new NotFoundError();
  const lines = await computePayroll(actor, period);
  const line = lines.find((l) => l.masterId === master.id);
  const visits = await prisma.visit.findMany({
    where: { masterId: master.id, status: "done", visitDate: { gte: toDate(period.start), lte: toDate(period.end) } },
    select: { id: true, visitDate: true, amount: true, client: { select: { name: true } } },
    orderBy: { visitDate: "desc" },
  });
  return {
    id: master.id,
    name: master.name,
    login: master.login,
    category: master.category,
    active: master.active,
    visitCount: line?.visitCount ?? 0,
    revenue: line?.revenue ?? 0,
    calculated: line?.calculated ?? 0,
    final: line?.final ?? 0,
    status: line?.status ?? "pending",
    visits: visits.map((v) => ({
      id: v.id,
      visitDate: v.visitDate.toISOString().slice(0, 10),
      clientName: v.client?.name ?? null,
      amount: v.amount,
    })),
  };
}
