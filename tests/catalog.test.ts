import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ForbiddenError } from "@/lib/errors";
import { formatPrice } from "@/lib/price";
import { listCatalog } from "@/lib/services/catalog";
import { SERVICES } from "@/lib/priceList";
import { resetDb } from "./setup/db";

// toLocaleString("ru-RU") ставит неразрывный пробел; сравниваем с обычным.
const plain = (t: string) => t.replace(/\s/g, " ");

describe("formatPrice", () => {
  test("exact price", () => expect(plain(formatPrice({ priceMin: 6000, priceMax: null, openEnded: false }))).toBe("6 000 ₸"));
  test("range", () => expect(plain(formatPrice({ priceMin: 1000, priceMax: 2000, openEnded: false }))).toBe("1 000–2 000 ₸"));
  test("open-ended 'from'", () => expect(plain(formatPrice({ priceMin: 3000, priceMax: null, openEnded: true }))).toBe("от 3 000 ₸"));
});

describe("price list data", () => {
  test("has no duplicate (category, group, name) and sane prices", () => {
    const keys = SERVICES.map((s) => `${s.category}|${s.groupName}|${s.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SERVICES) {
      expect(s.priceMin).toBeGreaterThan(0);
      if (s.priceMax != null) expect(s.priceMax).toBeGreaterThan(s.priceMin);
    }
  });
  test("add-on groups are marked as add-ons, the rest are main services", () => {
    expect(SERVICES.find((s) => s.name === "Мокрый эффект")?.kind).toBe("addon");
    expect(SERVICES.find((s) => s.name === "Стрижка")?.kind).toBe("main");
  });
  test("covers all four categories", () => {
    expect(new Set(SERVICES.map((s) => s.category))).toEqual(new Set(["lash", "nail", "lami_brow", "hair"]));
  });
});

describe("listCatalog", () => {
  let admin: User;
  let master: User;
  beforeEach(async () => {
    await resetDb();
    const passwordHash = await hashPassword("password1");
    admin = await prisma.user.create({ data: { name: "А", login: "a", role: "admin", passwordHash } });
    master = await prisma.user.create({ data: { name: "М", login: "m", role: "master", passwordHash } });
    await prisma.service.create({ data: { category: "hair", groupName: "Стрижки", name: "Стрижка", priceMin: 6000 } });
  });
  test("admin gets services grouped by category in fixed order", async () => {
    const c = await listCatalog(admin);
    expect(c.map((g) => g.category)).toEqual(["lash", "nail", "lami_brow", "hair"]);
    expect(c[3].groups[0]).toMatchObject({ groupName: "Стрижки" });
    expect(c[3].groups[0].items[0].name).toBe("Стрижка");
  });
  test("master is refused", async () => {
    await expect(listCatalog(master)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
