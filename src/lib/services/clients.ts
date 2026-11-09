import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type AdminClientDto = { id: string; name: string; assignedMasterId: string | null };

export type AdminClientDetailDto = AdminClientDto & { phone: string | null };

function cleanPhone(phone: string): string {
  const p = phone.trim();
  if (!/^\+?[\d\s\-()]+$/.test(p) || p.replace(/\D/g, "").length < 7) {
    throw new ValidationError("Неверный номер телефона");
  }
  return p;
}

export async function createClient(
  actor: User,
  input: { name: string; assignedMasterId: string; phone?: string },
): Promise<{ id: string; name: string }> {
  requireRole(actor, "admin");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Укажите имя клиента");
  const master = await prisma.user.findUnique({ where: { id: input.assignedMasterId } });
  if (!master || master.role !== "master" || !master.active) {
    throw new ValidationError("Закреплённый мастер не найден или отключён");
  }
  const phone = input.phone?.trim() ? cleanPhone(input.phone) : null;
  const c = await prisma.client.create({
    data: {
      name,
      assignedMasterId: master.id,
      ...(phone ? { contact: { create: { phone, consentAt: new Date() } } } : {}),
    },
  });
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

/** Быстрый ввод визита: клиент по имени (без учёта регистра) или новый клиент. */
export async function findOrCreateClientByName(
  actor: User,
  name: string,
  assignedMasterId: string,
): Promise<{ id: string; name: string }> {
  requireRole(actor, "admin");
  const clean = name.trim();
  if (!clean) throw new ValidationError("Укажите имя клиента");
  const existing = await prisma.client.findFirst({
    where: { name: { equals: clean, mode: "insensitive" } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  return existing ?? createClient(actor, { name: clean, assignedMasterId });
}

export async function updateClientContact(actor: User, clientId: string, phone: string): Promise<void> {
  requireRole(actor, "admin");
  const clean = cleanPhone(phone);
  if (!(await prisma.client.findUnique({ where: { id: clientId } }))) throw new NotFoundError("Клиент не найден");
  await prisma.clientContact.upsert({
    where: { clientId },
    update: { phone: clean },
    create: { clientId, phone: clean, consentAt: new Date() },
  });
}

export async function getClientForAdmin(actor: User, clientId: string): Promise<AdminClientDetailDto> {
  requireRole(actor, "admin");
  const c = await prisma.client.findUnique({ where: { id: clientId }, include: { contact: true } });
  if (!c) throw new NotFoundError("Клиент не найден");
  return { id: c.id, name: c.name, assignedMasterId: c.assignedMasterId, phone: c.contact?.phone ?? null };
}

/** Удаляет клиента и его контакты; визиты остаются без привязки к клиенту. */
export async function deleteClient(actor: User, clientId: string): Promise<void> {
  requireRole(actor, "admin");
  await prisma.client.delete({ where: { id: clientId } });
}
