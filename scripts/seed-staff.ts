// Приводит мастеров к окончательному списку LASH GOLDEN. Безопасно запускать повторно.
// Пароль новых мастеров берётся из переменной SEED_PASSWORD (в коде его нет).
// Запуск: SEED_PASSWORD=... npx tsx scripts/seed-staff.ts
import { PrismaClient, type MasterCategory } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

const ROSTER: { name: string; login: string; category: MasterCategory }[] = [
  { name: "Дана", login: "dana", category: "lash" },
  { name: "Жансая", login: "zhansaya", category: "lash" },
  { name: "Гульмира", login: "gulmira", category: "lash" },
  { name: "Ардак", login: "ardak", category: "lash" },
  { name: "Айдана", login: "aidana", category: "nail" },
  { name: "Мария", login: "maria", category: "nail" },
  { name: "Салтанат", login: "saltanat", category: "nail" },
  { name: "Сабина", login: "sabina", category: "lami_brow" },
  { name: "Акбота", login: "akbota", category: "hair" },
];

// Прежние демо-мастера, которых нет в списке: переименовываем карточку (id, визиты и выплаты сохраняются).
const RENAMES: Record<string, string> = { aruzhan: "zhansaya" };

async function main() {
  const password = process.env.SEED_PASSWORD;
  for (const [oldLogin, newLogin] of Object.entries(RENAMES)) {
    const old = await prisma.user.findUnique({ where: { login: oldLogin } });
    const target = ROSTER.find((r) => r.login === newLogin)!;
    if (old && !(await prisma.user.findUnique({ where: { login: newLogin } }))) {
      await prisma.user.update({ where: { id: old.id }, data: { login: newLogin, name: target.name, category: target.category } });
      console.log(`переименован: ${oldLogin} → ${target.name}`);
    }
  }
  for (const r of ROSTER) {
    const existing = await prisma.user.findUnique({ where: { login: r.login } });
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { name: r.name, category: r.category, role: "master", active: true } });
      console.log(`обновлён: ${r.name}`);
    } else {
      if (!password) throw new Error("Задайте SEED_PASSWORD для создания новых мастеров");
      await prisma.user.create({
        data: { name: r.name, login: r.login, role: "master", category: r.category, passwordHash: await hashPassword(password) },
      });
      console.log(`создан: ${r.name}`);
    }
  }
  const total = await prisma.user.count({ where: { role: "master" } });
  console.log(`мастеров в базе: ${total}`);
}

main().finally(() => prisma.$disconnect());
