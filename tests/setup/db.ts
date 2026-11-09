import { prisma } from "@/lib/db";

/** Очищает все таблицы и возвращает настройку доли мастера = 50. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "VisitAdjustment","VisitItem","Visit","ClientContact","Client","Payout","DayClosing","Setting","Service","User" RESTART IDENTITY CASCADE',
  );
  await prisma.setting.create({ data: { key: "master_share_percent", value: "50" } });
}
