import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Запись в журнал аудита: кто, что и когда изменил. */
export async function audit(actor: User, action: string, entity: string, entityId: string | null, details?: string): Promise<void> {
  await prisma.auditLog.create({ data: { actorId: actor.id, action, entity, entityId, details: details ?? null } });
}
