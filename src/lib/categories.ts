import type { MasterCategory } from "@prisma/client";

export const CATEGORY_ORDER: MasterCategory[] = ["lash", "nail", "lami_brow", "hair"];

export const CATEGORY_INFO: Record<MasterCategory, { title: string; description: string }> = {
  lash: { title: "Lash Masters", description: "Наращивание ресниц" },
  nail: { title: "Nail Masters", description: "Ногтевой сервис" },
  lami_brow: { title: "Lami & Brow Master", description: "Ламинирование ресниц и оформление бровей" },
  hair: { title: "Hair Master", description: "Работа с волосами" },
};
