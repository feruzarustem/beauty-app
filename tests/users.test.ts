import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createUser, listMasters, setUserActive } from "@/lib/services/users";
import { resetDb } from "./setup/db";

let admin: User;
let master: User;

beforeEach(async () => {
  await resetDb();
  admin = await prisma.user.create({
    data: { name: "Админ", login: "admin", passwordHash: await hashPassword("password1"), role: "admin" },
  });
  master = await prisma.user.create({
    data: { name: "Мастер", login: "m1", passwordHash: await hashPassword("password1"), role: "master" },
  });
});

const input = { name: "Айгуль", login: "aigul", password: "longenough1", role: "master" as const };

describe("createUser", () => {
  test("admin creates a master with a hashed password", async () => {
    const u = await createUser(admin, input);
    expect(u.role).toBe("master");
    expect(u.passwordHash).not.toContain("longenough1");
  });
  test("master cannot create users", async () => {
    await expect(createUser(master, { ...input, login: "x" })).rejects.toThrow(ForbiddenError);
  });
  test("duplicate login is rejected", async () => {
    await createUser(admin, input);
    await expect(createUser(admin, input)).rejects.toThrow(ValidationError);
  });
  test("password shorter than 8 characters is rejected", async () => {
    await expect(createUser(admin, { ...input, password: "short" })).rejects.toThrow(ValidationError);
  });
  test("empty name is rejected", async () => {
    await expect(createUser(admin, { ...input, name: "  " })).rejects.toThrow(ValidationError);
  });
});

describe("setUserActive and listMasters", () => {
  test("listMasters excludes admins and inactive users", async () => {
    const m2 = await createUser(admin, input);
    await setUserActive(admin, m2.id, false);
    const list = await listMasters(admin);
    expect(list.map((m) => m.id)).toEqual([master.id]);
  });
  test("master cannot deactivate anyone", async () => {
    await expect(setUserActive(master, admin.id, false)).rejects.toThrow(ForbiddenError);
  });
  test("master cannot list masters", async () => {
    await expect(listMasters(master)).rejects.toThrow(ForbiddenError);
  });
  test("admin cannot deactivate themselves", async () => {
    await expect(setUserActive(admin, admin.id, false)).rejects.toThrow(ValidationError);
  });
});
