import type { User } from "@prisma/client";
import { ForbiddenError } from "@/lib/errors";

export { ForbiddenError };

export function requireRole(user: User | null, role: "admin" | "master"): User {
  if (!user || user.role !== role) throw new ForbiddenError();
  return user;
}
