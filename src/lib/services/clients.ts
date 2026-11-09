import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { ValidationError } from "@/lib/errors";

export type AdminClientDto = { id: string; name: string; assignedMasterId: string | null };

export async function createClient(
  actor: User,
  input: { name: string; assignedMasterId: string },
): Promise<{ id: string; name: string }> {
  requireRole(actor, "admin");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Укажите имя клиента");
  const master = await prisma.user.findUnique({ where: { id: input.assignedMasterId } });
  if (!master || master.role !== "master" || !master.active) {
    throw new ValidationError("Закреплённый мастер не найден или отключён");
  }
  const c = await prisma.client.create({ data: { name, assignedMasterId: master.id } });
  return { id: c.id, name: c.name };
}

export async function searchClients(actor: User, q: string): Promise<AdminClientDto[]> {
  requireRole(actor, "admin");
  const rows = await prisma.client.findMany({
    where: { name: { contains: q.trim(), mode: "insensitive" } },
    select: { id: true, name: true, assignedMasterId: true },
    orderBy: { name: "asc" },
    take: 20,
  });
  return rows;
}
