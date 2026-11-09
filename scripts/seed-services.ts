// Загружает прайс-лист в справочник услуг. Безопасно запускать повторно (обновляет по категории+группе+названию).
// Запуск: npx tsx --env-file=.env scripts/seed-services.ts
import { PrismaClient } from "@prisma/client";
import { SERVICES } from "../src/lib/priceList";

const prisma = new PrismaClient();

async function main() {
  for (const [i, s] of SERVICES.entries()) {
    const data = { priceMin: s.priceMin, priceMax: s.priceMax ?? null, openEnded: s.openEnded ?? false, details: s.details ?? null, sortOrder: i, kind: s.kind ?? "main" };
    await prisma.service.upsert({
      where: { category_groupName_name: { category: s.category, groupName: s.groupName, name: s.name } },
      create: { category: s.category, groupName: s.groupName, name: s.name, ...data },
      update: data,
    });
  }
  console.log(`услуг в справочнике: ${await prisma.service.count()}`);
}

main().finally(() => prisma.$disconnect());
