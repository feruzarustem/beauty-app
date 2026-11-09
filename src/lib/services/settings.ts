import { prisma } from "@/lib/db";

export async function getMasterSharePercent(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: "master_share_percent" } });
  const n = Number(s?.value ?? "50");
  return Number.isFinite(n) ? n : 50;
}
