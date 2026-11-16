// Резервная копия всех таблиц в один JSON-файл (даты в ISO). Не меняет базу.
// Запуск: npx tsx --env-file=.env scripts/backup-db.ts /путь/к/файлу.json
import { PrismaClient } from "@prisma/client";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient();
type Delegate = { findMany: () => Promise<unknown[]> };
const delegates = prisma as unknown as Record<string, Delegate>;

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("Укажите путь к файлу копии");
  const models = Object.keys(prisma).filter((k) => !k.startsWith("_") && !k.startsWith("$") && typeof delegates[k]?.findMany === "function");
  const data: Record<string, unknown[]> = {};
  for (const m of models) data[m] = await delegates[m].findMany();
  writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), tables: data }, null, 1), { mode: 0o600 });
  chmodSync(out, 0o600);
  // проверка: файл читается и строк столько же, сколько в базе
  const back = JSON.parse(readFileSync(out, "utf8")).tables as Record<string, unknown[]>;
  const rows = Object.entries(back).map(([t, r]) => `${t}=${r.length}`);
  for (const m of models) if (back[m].length !== data[m].length) throw new Error(`Расхождение в таблице ${m}`);
  console.log("копия проверена:", rows.join(", "));
}
main().finally(() => prisma.$disconnect());
