import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { createClient, searchClients } from "@/lib/services/clients";
import { resetDb } from "./setup/db";

let admin: User, master: User, inactive: User;

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master", active = true) =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role, active } });
  admin = await mk("admin", "admin");
  master = await mk("m1", "master");
  inactive = await mk("m2", "master", false);
});

describe("createClient", () => {
  test("admin creates a client assigned to a master", async () => {
    const c = await createClient(admin, { name: "Айгуль", assignedMasterId: master.id });
    const row = await prisma.client.findUnique({ where: { id: c.id } });
    expect(row?.name).toBe("Айгуль");
    expect(row?.assignedMasterId).toBe(master.id);
  });
  test("master cannot create clients", async () => {
    await expect(createClient(master, { name: "X", assignedMasterId: master.id })).rejects.toThrow(ForbiddenError);
  });
  test("empty name is rejected", async () => {
    await expect(createClient(admin, { name: "  ", assignedMasterId: master.id })).rejects.toThrow(ValidationError);
  });
  test("assigned master must be an active master", async () => {
    await expect(createClient(admin, { name: "X", assignedMasterId: inactive.id })).rejects.toThrow(ValidationError);
    await expect(createClient(admin, { name: "X", assignedMasterId: admin.id })).rejects.toThrow(ValidationError);
  });
});

describe("searchClients", () => {
  test("finds by part of the name, case-insensitive", async () => {
    await createClient(admin, { name: "Айгуль Ким", assignedMasterId: master.id });
    await createClient(admin, { name: "Мадина", assignedMasterId: master.id });
    const found = await searchClients(admin, "гуль");
    expect(found.map((c) => c.name)).toEqual(["Айгуль Ким"]);
  });
  test("master cannot search clients", async () => {
    await expect(searchClients(master, "a")).rejects.toThrow(ForbiddenError);
  });
});
