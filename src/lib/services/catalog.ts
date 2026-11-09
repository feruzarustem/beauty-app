import type { MasterCategory, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { CATEGORY_ORDER } from "@/lib/categories";

export type CatalogItem = { id: string; name: string; priceMin: number; priceMax: number | null; openEnded: boolean; details: string | null };
export type CatalogGroup = { groupName: string; items: CatalogItem[] };
export type CatalogCategory = { category: MasterCategory; groups: CatalogGroup[] };

/** Price list grouped by category and group, in a fixed order. Admin only for now. */
export async function listCatalog(actor: User): Promise<CatalogCategory[]> {
  requireRole(actor, "admin");
  const rows = await prisma.service.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return CATEGORY_ORDER.map((category) => {
    const groups: CatalogGroup[] = [];
    for (const r of rows.filter((x) => x.category === category)) {
      let g = groups.find((x) => x.groupName === r.groupName);
      if (!g) groups.push((g = { groupName: r.groupName, items: [] }));
      g.items.push({ id: r.id, name: r.name, priceMin: r.priceMin, priceMax: r.priceMax, openEnded: r.openEnded, details: r.details });
    }
    return { category, groups };
  });
}
