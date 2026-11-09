// Демо-расписание на ближайшие дни (выдуманные клиенты). Запускать один раз на чистой демо-базе.
// Запуск: npx tsx --env-file=.env scripts/seed-demo-schedule.ts
import { PrismaClient } from "@prisma/client";
import { addDays } from "../src/lib/dates";
import { todayInBusinessTz } from "../src/lib/periods";
import { createVisitWithItems } from "../src/lib/services/visits";
import { addDaysOff } from "../src/lib/services/dayoff";

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin" } });
  const today = todayInBusinessTz(new Date());
  const master = (login: string) => prisma.user.findUniqueOrThrow({ where: { login } });
  const service = (name: string) => prisma.service.findFirstOrThrow({ where: { name } });
  const client = async (name: string, masterId: string) =>
    (await prisma.client.findFirst({ where: { name } })) ?? prisma.client.create({ data: { name, assignedMasterId: masterId } });

  const plan = [
    { login: "dana", svc: "Классическое наращивание", price: 8000, name: "Тестовая Алия", day: 0, time: "10:00", status: "done" as const, method: "cash" as const },
    { login: "gulmira", svc: "Объём 2D, 3D, 4D", price: 9000, name: "Тестовая Мадина", day: 0, time: "12:00", status: "done" as const, method: "kaspi" as const },
    { login: "aidana", svc: "Маникюр", price: 4000, name: "Тестовая Сауле", day: 0, time: "14:00", status: "done" as const, method: "transfer" as const },
    { login: "akbota", svc: "Стрижка", price: 6000, name: "Тестовая Айгерим", day: 1, time: "09:00", status: "scheduled" as const, method: "cash" as const },
    { login: "dana", svc: "Классическое наращивание", price: 8000, name: "Тестовая Алия", day: 1, time: "11:00", status: "scheduled" as const, method: "kaspi" as const },
    { login: "sabina", svc: "Ламинирование ресниц", price: 7000, name: "Тестовая Томирис", day: 1, time: "15:30", status: "scheduled" as const, method: "cash" as const },
    { login: "maria", svc: "Японский маникюр", price: 7000, name: "Тестовая Дарья", day: 2, time: "13:00", status: "scheduled" as const, method: "cash" as const },
    { login: "dana", svc: "Объём от 7D", price: 11000, name: "Тестовая Жанар", day: 3, time: "10:00", status: "scheduled" as const, method: "transfer" as const },
  ];
  for (const p of plan) {
    const m = await master(p.login);
    const c = await client(p.name, m.id);
    const s = await service(p.svc);
    await createVisitWithItems(admin, {
      visitDate: addDays(today, p.day), startTime: p.time, status: p.status, masterId: m.id, clientId: c.id,
      paymentMethod: p.method, confirmDuplicate: true, items: [{ serviceId: s.id, price: p.price }],
    });
  }
  await addDaysOff(admin, (await master("saltanat")).id, [addDays(today, 2), addDays(today, 3)]);
  console.log("демо-расписание создано");
}

main().finally(() => prisma.$disconnect());
