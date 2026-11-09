import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { periodFor } from "@/lib/periods";
import { getMasterProfile, listMastersByCategory } from "@/lib/services/masters";
import { createUser } from "@/lib/services/users";
import { createVisit } from "@/lib/services/visits";
import { resetDb } from "./setup/db";

let admin: User;
let dana: User;
let aidana: User;

async function mk(name: string, login: string, role: "admin" | "master", category?: "lash" | "nail" | "lami_brow" | "hair") {
  return prisma.user.create({
    data: { name, login, role, category, passwordHash: await hashPassword("password1") },
  });
}

beforeEach(async () => {
  await resetDb();
  admin = await mk("Админ", "admin", "admin");
  dana = await mk("Дана", "dana", "master", "lash");
  aidana = await mk("Айдана", "aidana", "master", "nail");
  await mk("Акбота", "akbota", "master", "hair");
});

describe("listMastersByCategory", () => {
  test("groups active masters in fixed order lash, nail, lami_brow, hair", async () => {
    const groups = await listMastersByCategory(admin);
    expect(groups.map((g) => g.category)).toEqual(["lash", "nail", "lami_brow", "hair"]);
    expect(groups[0].masters.map((m) => m.name)).toEqual(["Дана"]);
    expect(groups[2].masters).toEqual([]);
  });
  test("master cannot list", async () => {
    await expect(listMastersByCategory(dana)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getMasterProfile", () => {
  test("returns category, period figures and visits of that master only", async () => {
    const c = await prisma.client.create({ data: { name: "Тест Клиент", assignedMasterId: dana.id } });
    await createVisit(admin, { visitDate: "2026-11-02", masterId: dana.id, clientId: c.id, amount: "15001", paymentMethod: "cash" });
    await createVisit(admin, { visitDate: "2026-11-03", masterId: aidana.id, clientId: c.id, amount: "9000", paymentMethod: "cash" });
    const p = await getMasterProfile(admin, dana.id, periodFor("2026-11-02"));
    expect(p.category).toBe("lash");
    expect(p.visits).toHaveLength(1);
    expect(p.revenue).toBe(15001);
    expect(p.calculated).toBe(7500);
  });
  test("unknown id, or a non-master, is NotFound", async () => {
    await expect(getMasterProfile(admin, "nope", periodFor("2026-11-02"))).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMasterProfile(admin, admin.id, periodFor("2026-11-02"))).rejects.toBeInstanceOf(NotFoundError);
  });
  test("master cannot open profiles", async () => {
    await expect(getMasterProfile(dana, dana.id, periodFor("2026-11-02"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("createUser with category", () => {
  test("stores the category for a master", async () => {
    const u = await createUser(admin, { name: "Сабина", login: "sabina", password: "longenough1", role: "master", category: "lami_brow" });
    expect(u.category).toBe("lami_brow");
  });
});
