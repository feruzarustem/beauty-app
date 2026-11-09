import fs from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { masterClients, masterEarnings, masterVisit, masterVisits } from "@/lib/access/master";
import { adjustPayout, markPaid } from "@/lib/services/payroll";
import { resetDb } from "./setup/db";

const PHONE = "+7 700 123 45 67";
const P1 = { start: "2026-03-01", end: "2026-03-15" };
let admin: User, masterA: User, masterB: User;
let clientA: string, clientB: string, visitA: string, visitB: string;

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master") =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role } });
  admin = await mk("admin", "admin");
  masterA = await mk("masterA", "master");
  masterB = await mk("masterB", "master");
  clientA = (await prisma.client.create({
    data: { name: "Айгуль", assignedMasterId: masterA.id, contact: { create: { phone: PHONE, consentAt: new Date() } } },
  })).id;
  clientB = (await prisma.client.create({
    data: { name: "Мадина", assignedMasterId: masterB.id, contact: { create: { phone: "+7 701 999 99 99", consentAt: new Date() } } },
  })).id;
  const v = (masterId: string, clientId: string, date: string, amount: number) =>
    prisma.visit.create({
      data: { visitDate: new Date(`${date}T00:00:00Z`), masterId, clientId, amount, paymentMethod: "transfer", createdById: admin.id },
    });
  visitA = (await v(masterA.id, clientA, "2026-03-05", 15_001)).id;
  visitB = (await v(masterB.id, clientB, "2026-03-06", 40_000)).id;
});

describe("master data layer never exposes contacts", () => {
  test("source of access/master.ts does not touch contacts or phones", () => {
    const src = fs.readFileSync("src/lib/access/master.ts", "utf8");
    expect(src).not.toMatch(/clientContact/i);
    expect(src).not.toMatch(/phone/i);
    expect(src).not.toMatch(/contact/i);
  });
  test("no response contains the phone as key or value", async () => {
    const all = JSON.stringify([
      await masterClients(masterA),
      await masterVisits(masterA, P1),
      await masterVisit(masterA, visitA),
      await masterEarnings(masterA, P1),
    ]);
    expect(all).not.toContain(PHONE);
    expect(all.toLowerCase()).not.toContain("phone");
    expect(all.toLowerCase()).not.toContain("contact");
  });
});

describe("masterClients", () => {
  test("returns only own assigned clients as {id, name}", async () => {
    expect(await masterClients(masterA)).toEqual([{ id: clientA, name: "Айгуль" }]);
  });
  test("an admin or null cannot use the master layer", async () => {
    await expect(masterClients(admin)).rejects.toThrow(ForbiddenError);
  });
});

describe("masterVisits / masterVisit", () => {
  test("own visits only, with exact safe fields and 50% share rounded down", async () => {
    const list = await masterVisits(masterA, P1);
    expect(list).toEqual([{ id: visitA, visitDate: "2026-03-05", clientName: "Айгуль", amount: 15_001, myShare: 7_500 }]);
  });
  test("visits outside the range are not returned", async () => {
    expect(await masterVisits(masterA, { start: "2026-03-16", end: "2026-03-31" })).toEqual([]);
  });
  test("another master's visit by id is NotFound, same as a nonexistent id", async () => {
    await expect(masterVisit(masterA, visitB)).rejects.toThrow(NotFoundError);
    await expect(masterVisit(masterA, "nope")).rejects.toThrow(NotFoundError);
  });
  test("own visit by id works", async () => {
    expect((await masterVisit(masterA, visitA)).myShare).toBe(7_500);
  });
  test("a deleted client gives clientName null, not a crash", async () => {
    await prisma.client.delete({ where: { id: clientA } });
    expect((await masterVisit(masterA, visitA)).clientName).toBeNull();
  });
  test("malformed range is rejected", async () => {
    await expect(masterVisits(masterA, { start: "x", end: "2026-03-15" })).rejects.toThrow(ValidationError);
  });
  test("admin cannot use the master layer", async () => {
    await expect(masterVisits(admin, P1)).rejects.toThrow(ForbiddenError);
    await expect(masterVisit(admin, visitA)).rejects.toThrow(ForbiddenError);
  });
});

describe("masterEarnings", () => {
  test("counts only own visits; pending by default", async () => {
    expect(await masterEarnings(masterA, P1)).toEqual({ calculated: 7_500, adjustment: 0, final: 7_500, status: "pending" });
  });
  test("includes adjustment and shows paid status after payment", async () => {
    await adjustPayout(admin, masterA.id, P1, 500, "премия");
    expect((await masterEarnings(masterA, P1)).final).toBe(8_000);
    await markPaid(admin, masterA.id, P1);
    expect(await masterEarnings(masterA, P1)).toEqual({ calculated: 7_500, adjustment: 500, final: 8_000, status: "paid" });
  });
  test("another master's payout does not leak", async () => {
    await markPaid(admin, masterB.id, P1);
    expect((await masterEarnings(masterA, P1)).status).toBe("pending");
  });
});
