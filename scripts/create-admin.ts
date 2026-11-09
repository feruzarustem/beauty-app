// Создаёт первого администратора на чистой базе. Пароль берётся из переменной окружения, в коде его нет.
// Запуск: ADMIN_LOGIN=owner ADMIN_NAME="Имя" ADMIN_PASSWORD='длинный-пароль' npx tsx --env-file=.env scripts/create-admin.ts
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const login = process.env.ADMIN_LOGIN?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Администратор";
  if (!login || !password) throw new Error("Задайте ADMIN_LOGIN и ADMIN_PASSWORD");
  if (password.length < 12) throw new Error("Пароль администратора — не короче 12 символов");
  if (await prisma.user.findUnique({ where: { login } })) {
    console.log(`Пользователь «${login}» уже существует, ничего не изменено`);
    return;
  }
  await prisma.user.create({ data: { name, login, role: "admin", passwordHash: await hashPassword(password) } });
  await prisma.setting.upsert({ where: { key: "master_share_percent" }, update: {}, create: { key: "master_share_percent", value: "50" } });
  console.log(`Администратор «${login}» создан`);
}

main().finally(() => prisma.$disconnect());
