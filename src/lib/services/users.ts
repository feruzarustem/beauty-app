import type { Role, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/guard";
import { ValidationError } from "@/lib/errors";

export async function createUser(
  actor: User,
  input: { name: string; login: string; password: string; role: Role },
): Promise<User> {
  requireRole(actor, "admin");
  const name = input.name.trim();
  const login = input.login.trim();
  if (!name) throw new ValidationError("Укажите имя");
  if (!login) throw new ValidationError("Укажите логин");
  if (input.password.length < 8) throw new ValidationError("Пароль должен быть не короче 8 символов");
  if (await prisma.user.findUnique({ where: { login } })) throw new ValidationError("Такой логин уже занят");
  return prisma.user.create({
    data: { name, login, passwordHash: await hashPassword(input.password), role: input.role },
  });
}

export async function setUserActive(actor: User, userId: string, active: boolean): Promise<void> {
  requireRole(actor, "admin");
  if (!active && userId === actor.id) throw new ValidationError("Нельзя отключить самого себя");
  await prisma.user.update({ where: { id: userId }, data: { active } });
}

export async function listMasters(actor: User): Promise<{ id: string; name: string }[]> {
  requireRole(actor, "admin");
  return prisma.user.findMany({
    where: { role: "master", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
