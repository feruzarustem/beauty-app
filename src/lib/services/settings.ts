import type { MasterCategory } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function getMasterSharePercent(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: "master_share_percent" } });
  const n = Number(s?.value ?? "50");
  return Number.isFinite(n) ? n : 50;
}

/** Проценты мастера по специализации. Значения по умолчанию совпадают с договорённостью; их можно менять в таблице Setting. */
export const DEFAULT_SHARE_PERCENT: Record<MasterCategory, number> = { lash: 50, lami_brow: 50, nail: 60, hair: 50 };

/** Процент мастера для специализации; у мастера без специализации — прежняя общая ставка. */
export async function getSharePercent(category: MasterCategory | null): Promise<number> {
  if (!category) return getMasterSharePercent();
  const s = await prisma.setting.findUnique({ where: { key: `share_percent_${category}` } });
  const n = Number(s?.value);
  return s && Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_SHARE_PERCENT[category];
}
