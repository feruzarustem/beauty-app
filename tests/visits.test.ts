import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DuplicateWarning, ForbiddenError, ValidationError } from "@/lib/errors";
import { AmountError } from "@/lib/money";
import { createVisit, listVisitsForDay } from "@/lib/services/visits";
import { resetDb } from "./setup/db";

let admin: User, masterA: User, masterB: User, inactive: User;
let clientId: string;

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master", active = true) =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role, active } });
  admin = await mk("admin", "admin");
  masterA = await mk("masterA", "master");
  masterB = await mk("masterB", "master");
  inactive = await mk("old", "master", false);
  clientId = (await prisma.client.create({ data: { name: "Айгуль", assignedMasterId: masterA.id } })).id;
});

const base = () => ({
  visitDate: "2026-03-10",
  masterId: masterA.id,
  clientId,
  amount: 15000 as unknown,
  paymentMethod: "cash" as const,
});

describe("createVisit", () => {
  test("admin creates a visit", async () => {
    const { id } = await createVisit(admin, base());
    const v = await prisma.visit.findUnique({ where: { id } });
    expect(v?.amount).toBe(15000);
    expect(v?.paymentMethod).toBe("cash");
    expect(v?.createdById).toBe(admin.id);
    expect(v?.visitDate.toISOString().slice(0, 10)).toBe("2026-03-10");
  });
  test("master cannot create a visit", async () => {
    await expect(createVisit(masterA, base())).rejects.toThrow(ForbiddenError);
  });
  test.each(["15 000", 1.5, 0, -5, 1e12, "abc"])("amount %s is not saved", async (bad) => {
    await expect(createVisit(admin, { ...base(), amount: bad })).rejects.toThrow(AmountError);
    expect(await prisma.visit.count()).toBe(0);
  });
  test("inactive master and unknown client are rejected", async () => {
    await expect(createVisit(admin, { ...base(), masterId: inactive.id })).rejects.toThrow(ValidationError);
    await expect(createVisit(admin, { ...base(), clientId: "nope" })).rejects.toThrow(ValidationError);
  });
  test("malformed date is rejected", async () => {
    await expect(createVisit(admin, { ...base(), visitDate: "10.03.2026" })).rejects.toThrow(ValidationError);
  });
  test("same master+client+amount within 10 minutes warns, confirmDuplicate saves", async () => {
    await createVisit(admin, base());
    await expect(createVisit(admin, base())).rejects.toThrow(DuplicateWarning);
    await createVisit(admin, { ...base(), confirmDuplicate: true });
    expect(await prisma.visit.count()).toBe(2);
  });
  test("different amount is not a duplicate", async () => {
    await createVisit(admin, base());
    await createVisit(admin, { ...base(), amount: 16000 });
    expect(await prisma.visit.count()).toBe(2);
  });
});

describe("listVisitsForDay", () => {
  test("returns only that day with share and names", async () => {
    await createVisit(admin, { ...base(), amount: 15001 });
    await createVisit(admin, { ...base(), visitDate: "2026-03-11", masterId: masterB.id });
    const list = await listVisitsForDay(admin, "2026-03-10");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      masterName: "masterA",
      clientName: "Айгуль",
      amount: 15001,
      masterShare: 7500,
      paymentMethod: "cash",
      visitDate: "2026-03-10",
    });
  });
  test("master cannot list all visits", async () => {
    await expect(listVisitsForDay(masterA, "2026-03-10")).rejects.toThrow(ForbiddenError);
  });
});
