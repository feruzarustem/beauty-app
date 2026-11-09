import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, PeriodPaidError, ValidationError } from "@/lib/errors";
import { AmountError } from "@/lib/money";
import {
  adjustPayout,
  adjustVisitAmount,
  computePayroll,
  markPaid,
} from "@/lib/services/payroll";
import { resetDb } from "./setup/db";

let admin: User, masterA: User, masterB: User;
const P1 = { start: "2026-03-01", end: "2026-03-15" };
const P2 = { start: "2026-03-16", end: "2026-03-31" };

async function visit(master: User, date: string, amount: number) {
  return prisma.visit.create({
    data: {
      visitDate: new Date(`${date}T00:00:00.000Z`),
      masterId: master.id,
      amount,
      paymentMethod: "cash",
      createdById: admin.id,
    },
  });
}
const lineOf = async (m: User, p = P1) =>
  (await computePayroll(admin, p)).find((l) => l.masterId === m.id)!;

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master", active = true) =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role, active } });
  admin = await mk("admin", "admin");
  masterA = await mk("masterA", "master");
  masterB = await mk("masterB", "master");
  await mk("old", "master", false);
});

describe("computePayroll", () => {
  test("demo case: 100 000 + 80 000 gives 90 000 to the master", async () => {
    await visit(masterA, "2026-03-05", 100_000);
    await visit(masterA, "2026-03-12", 80_000);
    expect(await lineOf(masterA)).toMatchObject({
      visitCount: 2,
      revenue: 180_000,
      calculated: 90_000,
      adjustment: 0,
      final: 90_000,
      status: "pending",
    });
  });
  test("visit on the 16th is not in period 1–15", async () => {
    await visit(masterA, "2026-03-16", 50_000);
    expect((await lineOf(masterA, P1)).revenue).toBe(0);
    expect((await lineOf(masterA, P2)).revenue).toBe(50_000);
  });
  test("share is rounded down per visit", async () => {
    await visit(masterA, "2026-03-05", 15_001);
    await visit(masterA, "2026-03-06", 15_001);
    expect((await lineOf(masterA)).calculated).toBe(15_000);
  });
  test("active masters with no visits show zeros; inactive without visits are hidden", async () => {
    const lines = await computePayroll(admin, P1);
    expect(lines.map((l) => l.masterId).sort()).toEqual([masterA.id, masterB.id].sort());
    expect(lines.every((l) => l.final === 0)).toBe(true);
  });
  test("only the master's own visits count", async () => {
    await visit(masterA, "2026-03-05", 10_000);
    await visit(masterB, "2026-03-05", 30_000);
    expect((await lineOf(masterA)).revenue).toBe(10_000);
  });
});

describe("markPaid", () => {
  test("freezes the amount; later visits do not change the paid sum", async () => {
    await visit(masterA, "2026-03-05", 100_000);
    await markPaid(admin, masterA.id, P1);
    await visit(masterA, "2026-03-07", 40_000);
    const l = await lineOf(masterA);
    expect(l.status).toBe("paid");
    expect(l.calculated).toBe(50_000);
    expect(l.final).toBe(50_000);
  });
  test("paying twice is rejected", async () => {
    await markPaid(admin, masterA.id, P1);
    await expect(markPaid(admin, masterA.id, P1)).rejects.toThrow(ValidationError);
  });
  test("a period that is not 1–15 or 16–end is rejected", async () => {
    await expect(markPaid(admin, masterA.id, { start: "2026-03-02", end: "2026-03-20" })).rejects.toThrow(ValidationError);
  });
  test("pending adjustment is included in the paid final", async () => {
    await visit(masterA, "2026-03-05", 100_000);
    await adjustPayout(admin, masterA.id, P1, -5_000, "аванс");
    await markPaid(admin, masterA.id, P1);
    expect((await lineOf(masterA)).final).toBe(45_000);
  });
});

describe("adjustPayout", () => {
  test("requires a reason", async () => {
    await expect(adjustPayout(admin, masterA.id, P1, 1000, "  ")).rejects.toThrow(ValidationError);
  });
  test("rejects fractional adjustment and one that makes the total negative", async () => {
    await visit(masterA, "2026-03-05", 10_000);
    await expect(adjustPayout(admin, masterA.id, P1, 1.5, "x")).rejects.toThrow(ValidationError);
    await expect(adjustPayout(admin, masterA.id, P1, -5_001, "x")).rejects.toThrow(ValidationError);
  });
  test("pending adjustment follows new visits", async () => {
    await visit(masterA, "2026-03-05", 10_000);
    await adjustPayout(admin, masterA.id, P1, 2_000, "премия");
    await visit(masterA, "2026-03-06", 10_000);
    expect(await lineOf(masterA)).toMatchObject({ calculated: 10_000, adjustment: 2_000, adjustmentReason: "премия", final: 12_000 });
  });
  test("after payment the final changes but status stays paid", async () => {
    await visit(masterA, "2026-03-05", 100_000);
    await markPaid(admin, masterA.id, P1);
    await adjustPayout(admin, masterA.id, P1, 3_000, "доплата");
    expect(await lineOf(masterA)).toMatchObject({ status: "paid", calculated: 50_000, final: 53_000 });
  });
});

describe("adjustVisitAmount", () => {
  test("changes the amount, stores old and new value and reason, payroll follows", async () => {
    const v = await visit(masterA, "2026-03-05", 20_000);
    await adjustVisitAmount(admin, v.id, 25_000, "ошибка ввода");
    const adj = await prisma.visitAdjustment.findFirstOrThrow({ where: { visitId: v.id } });
    expect(adj).toMatchObject({ oldAmount: 20_000, newAmount: 25_000, reason: "ошибка ввода", changedById: admin.id });
    expect((await lineOf(masterA)).calculated).toBe(12_500);
  });
  test("requires a reason and a valid amount", async () => {
    const v = await visit(masterA, "2026-03-05", 20_000);
    await expect(adjustVisitAmount(admin, v.id, 25_000, "")).rejects.toThrow(ValidationError);
    await expect(adjustVisitAmount(admin, v.id, "1 5", "x")).rejects.toThrow(AmountError);
  });
  test("is blocked in a paid period", async () => {
    const v = await visit(masterA, "2026-03-05", 20_000);
    await markPaid(admin, masterA.id, P1);
    await expect(adjustVisitAmount(admin, v.id, 25_000, "x")).rejects.toThrow(PeriodPaidError);
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).amount).toBe(20_000);
  });
  test("paid period of another master does not block", async () => {
    const v = await visit(masterA, "2026-03-05", 20_000);
    await markPaid(admin, masterB.id, P1);
    await adjustVisitAmount(admin, v.id, 21_000, "x");
  });
});

describe("permissions", () => {
  test("master is forbidden everywhere", async () => {
    const v = await visit(masterA, "2026-03-05", 20_000);
    await expect(computePayroll(masterA, P1)).rejects.toThrow(ForbiddenError);
    await expect(markPaid(masterA, masterA.id, P1)).rejects.toThrow(ForbiddenError);
    await expect(adjustPayout(masterA, masterA.id, P1, 1, "x")).rejects.toThrow(ForbiddenError);
    await expect(adjustVisitAmount(masterA, v.id, 1000, "x")).rejects.toThrow(ForbiddenError);
  });
});
