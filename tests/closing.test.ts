import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DayClosedError, ForbiddenError, ValidationError } from "@/lib/errors";
import { todayInBusinessTz } from "@/lib/periods";
import { adjustVisitAmount } from "@/lib/services/payroll";
import { closeDay, dayFigures, reopenDay } from "@/lib/services/closing";
import { createVisit, createVisitWithItems } from "@/lib/services/visits";
import { resetDb } from "./setup/db";

let admin: User, master: User, other: User, clientId: string;
const today = () => todayInBusinessTz(new Date());

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master") => prisma.user.create({ data: { name: login, login, passwordHash: "x", role, category: role === "master" ? "hair" : undefined } });
  admin = await mk("admin", "admin");
  master = await mk("m1", "master");
  other = await mk("m2", "master");
  clientId = (await prisma.client.create({ data: { name: "К", assignedMasterId: master.id } })).id;
});

const visit = (amount: number, paymentMethod: "cash" | "kaspi" | "transfer", masterId = master.id) =>
  createVisit(admin, { visitDate: today(), masterId, clientId, amount, paymentMethod, confirmDuplicate: true });

describe("dayFigures", () => {
  test("counts only done visits: totals, masters' share (floor per visit), salon share, by method", async () => {
    await visit(15001, "cash");
    await visit(10000, "kaspi", other.id);
    await visit(4001, "transfer");
    const svc = (await prisma.service.create({ data: { category: "hair", groupName: "Г", name: "С", priceMin: 6000 } })).id;
    await createVisitWithItems(admin, { visitDate: today(), startTime: "10:00", status: "scheduled", masterId: master.id, clientId, paymentMethod: "cash", items: [{ serviceId: svc, price: 6000 }] });
    const f = await dayFigures(admin, today());
    expect(f).toMatchObject({ visitCount: 3, revenue: 29002, mastersTotal: 7500 + 5000 + 2000, cashTotal: 15001, kaspiTotal: 10000, transferTotal: 4001, unfinished: 1 });
    expect(f.salonShare).toBe(29002 - 14500);
  });
  test("master cannot read it", async () => {
    await expect(dayFigures(master, today())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("closeDay", () => {
  test("stores the frozen figures and the difference against cash", async () => {
    await visit(15000, "cash");
    await visit(10000, "kaspi");
    await closeDay(admin, today(), 15000);
    const c = await prisma.dayClosing.findFirstOrThrow();
    expect(c).toMatchObject({ visitCount: 2, revenue: 25000, cashTotal: 15000, kaspiTotal: 10000, actualCash: 15000, difference: 0, isClosed: true, closedById: admin.id });
  });
  test("a discrepancy needs a comment and is stored, not corrected", async () => {
    await visit(15000, "cash");
    await expect(closeDay(admin, today(), 14000)).rejects.toBeInstanceOf(ValidationError);
    await closeDay(admin, today(), 14000, "Выдали сдачу вручную");
    const c = await prisma.dayClosing.findFirstOrThrow();
    expect(c).toMatchObject({ difference: -1000, comment: "Выдали сдачу вручную" });
    expect((await prisma.visit.findFirstOrThrow()).amount).toBe(15000);
  });
  test("zero cash is a valid count; negatives and junk are not", async () => {
    await visit(5000, "kaspi");
    await expect(closeDay(admin, today(), -1)).rejects.toBeInstanceOf(ValidationError);
    await expect(closeDay(admin, today(), "abc")).rejects.toBeInstanceOf(ValidationError);
    await closeDay(admin, today(), 0);
    expect((await prisma.dayClosing.findFirstOrThrow()).difference).toBe(0);
  });
  test("cannot close twice, close the future, or close with unresolved appointments", async () => {
    await closeDay(admin, today(), 0);
    await expect(closeDay(admin, today(), 0)).rejects.toBeInstanceOf(ValidationError);
    const tomorrow = new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await expect(closeDay(admin, tomorrow, 0)).rejects.toBeInstanceOf(ValidationError);
  });
  test("unresolved scheduled visits block closing", async () => {
    const svc = (await prisma.service.create({ data: { category: "hair", groupName: "Г", name: "С", priceMin: 6000 } })).id;
    await createVisitWithItems(admin, { visitDate: today(), startTime: "10:00", status: "scheduled", masterId: master.id, clientId, paymentMethod: "cash", items: [{ serviceId: svc, price: 6000 }] });
    await expect(closeDay(admin, today(), 0)).rejects.toBeInstanceOf(ValidationError);
  });
  test("a master cannot close the day", async () => {
    await expect(closeDay(master, today(), 0)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("a closed day is frozen; reopening needs a reason and is audited", () => {
  test("freezes visit amounts, then reopen allows the change and re-closing refreshes figures", async () => {
    const { id } = await visit(15000, "cash");
    await closeDay(admin, today(), 15000);
    await expect(adjustVisitAmount(admin, id, 16000, "ошибка")).rejects.toBeInstanceOf(DayClosedError);
    await expect(reopenDay(admin, today(), " ")).rejects.toBeInstanceOf(ValidationError);
    await expect(reopenDay(master, today(), "хочу")).rejects.toBeInstanceOf(ForbiddenError);
    await reopenDay(admin, today(), "Ошибка в сумме");
    await adjustVisitAmount(admin, id, 16000, "ошибка");
    await closeDay(admin, today(), 16000);
    const c = await prisma.dayClosing.findFirstOrThrow();
    expect(c).toMatchObject({ revenue: 16000, cashTotal: 16000, isClosed: true, reopenReason: "Ошибка в сумме" });
    const actions = (await prisma.auditLog.findMany({ orderBy: { at: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["day.close", "day.reopen", "visit.adjust"]));
  });
  test("cannot reopen a day that is not closed", async () => {
    await expect(reopenDay(admin, today(), "зачем")).rejects.toBeInstanceOf(ValidationError);
  });
});
