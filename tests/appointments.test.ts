import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DayClosedError, ForbiddenError, NotFoundError, PeriodPaidError, ValidationError } from "@/lib/errors";
import { periodFor, todayInBusinessTz } from "@/lib/periods";
import { cancelVisit, completeVisit, moveVisit, updateScheduledVisit } from "@/lib/services/appointments";
import { computePayroll } from "@/lib/services/payroll";
import { createVisit, createVisitWithItems } from "@/lib/services/visits";
import { resetDb } from "./setup/db";

let admin: User, akbota: User, aidana: User, clientId: string, cut: string, style: string;
const today = () => todayInBusinessTz(new Date());
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master", category?: "hair" | "nail") =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role, category } });
  admin = await mk("admin", "admin");
  akbota = await mk("akbota", "master", "hair");
  aidana = await mk("aidana", "master", "nail");
  clientId = (await prisma.client.create({ data: { name: "Клиентка", assignedMasterId: akbota.id } })).id;
  cut = (await prisma.service.create({ data: { category: "hair", groupName: "Г", name: "Стрижка", priceMin: 6000 } })).id;
  style = (await prisma.service.create({ data: { category: "hair", groupName: "Г", name: "Укладка", priceMin: 5000 } })).id;
});

const appt = (o: Record<string, unknown> = {}) => ({
  visitDate: plusDays(today(), 1),
  startTime: "11:30",
  durationMin: 30,
  status: "scheduled" as const,
  masterId: akbota.id,
  clientId,
  paymentMethod: "cash" as const,
  items: [{ serviceId: cut, price: 6000 }],
  ...o,
});
const payrollOf = async (m: User, date = today()) =>
  (await computePayroll(admin, periodFor(date))).find((l) => l.masterId === m.id)!;

describe("creating appointments", () => {
  test("a scheduled visit keeps time and status and is NOT counted in payroll until done", async () => {
    const date = today();
    const { id } = await createVisitWithItems(admin, appt({ visitDate: date }));
    const v = await prisma.visit.findUniqueOrThrow({ where: { id } });
    expect(v).toMatchObject({ status: "scheduled", startTime: "11:30", amount: 6000 });
    expect((await payrollOf(akbota)).calculated).toBe(0);
    await completeVisit(akbota, id);
    expect((await payrollOf(akbota)).calculated).toBe(3000);
  });
  test("time must be HH:MM from 08:00; the procedure must end by 23:00 (not by 20:00)", async () => {
    for (const t of ["07:59", "23:00", "9:30", "", "ab:cd"]) {
      await expect(createVisitWithItems(admin, appt({ startTime: t }))).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(createVisitWithItems(admin, appt({ startTime: "08:00" }))).resolves.toBeTruthy();
    await expect(createVisitWithItems(admin, appt({ startTime: "21:30", durationMin: 90, items: [{ serviceId: style, price: 5000 }] }))).resolves.toBeTruthy();
    await expect(createVisitWithItems(admin, appt({ startTime: "22:00", durationMin: 90, items: [{ serviceId: cut, price: 6000 }] }))).rejects.toBeInstanceOf(ValidationError);
  });
  test("duration is required for appointments and must be 10–600 minutes", async () => {
    await expect(createVisitWithItems(admin, appt({ durationMin: undefined }))).rejects.toBeInstanceOf(ValidationError);
    for (const d of [5, 0, 601, 1.5, "abc", -10]) {
      await expect(createVisitWithItems(admin, appt({ durationMin: d }))).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(createVisitWithItems(admin, appt({ durationMin: 10 }))).resolves.toBeTruthy();
  });
  test("a master's day off blocks only that master", async () => {
    const date = plusDays(today(), 1);
    await prisma.dayOff.create({ data: { masterId: akbota.id, date: D(date), createdById: admin.id } });
    await expect(createVisitWithItems(admin, appt())).rejects.toBeInstanceOf(ValidationError);
    const nail = (await prisma.service.create({ data: { category: "nail", groupName: "Г", name: "Маникюр", priceMin: 4000 } })).id;
    await expect(createVisitWithItems(admin, appt({ masterId: aidana.id, items: [{ serviceId: nail, price: 4000 }] }))).resolves.toBeTruthy();
  });
  test("two overlapping appointments of one master are refused; back-to-back, other masters and cancelled ones are fine", async () => {
    await createVisitWithItems(admin, appt({ startTime: "11:00", durationMin: 60 }));
    const style1 = [{ serviceId: style, price: 5000 }];
    const ok = { confirmDuplicate: true };
    await expect(createVisitWithItems(admin, appt({ startTime: "11:30", durationMin: 30, items: style1 }))).rejects.toThrow(/занят с 11:00 до 12:00/);
    await expect(createVisitWithItems(admin, appt({ startTime: "10:30", durationMin: 60, items: style1 }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createVisitWithItems(admin, appt({ startTime: "10:00", durationMin: 60, items: style1, ...ok }))).resolves.toBeTruthy(); // встык: конец = начало
    await expect(createVisitWithItems(admin, appt({ startTime: "12:00", durationMin: 30, items: style1, ...ok }))).resolves.toBeTruthy();
    const nail = (await prisma.service.create({ data: { category: "nail", groupName: "Г", name: "Маникюр", priceMin: 4000 } })).id;
    await expect(createVisitWithItems(admin, appt({ masterId: aidana.id, startTime: "11:00", durationMin: 60, items: [{ serviceId: nail, price: 4000 }], ...ok }))).resolves.toBeTruthy();
  });
  test("a cancelled appointment frees the time", async () => {
    const { id } = await createVisitWithItems(admin, appt({ startTime: "15:00", durationMin: 60 }));
    await cancelVisit(admin, id, "отмена");
    await expect(createVisitWithItems(admin, appt({ startTime: "15:00", durationMin: 60, confirmDuplicate: true }))).resolves.toBeTruthy();
  });
  test("Kaspi/QR is a valid payment method", async () => {
    const { id } = await createVisitWithItems(admin, appt({ paymentMethod: "kaspi" }));
    expect((await prisma.visit.findUniqueOrThrow({ where: { id } })).paymentMethod).toBe("kaspi");
  });
  test("a closed day refuses new visits", async () => {
    const date = today();
    await prisma.dayClosing.create({ data: { closingDate: D(date), expectedCash: 0, actualCash: 0, difference: 0, closedById: admin.id } });
    await expect(createVisit(admin, { visitDate: date, masterId: akbota.id, clientId, amount: 5000, paymentMethod: "cash" })).rejects.toBeInstanceOf(DayClosedError);
  });
});

describe("completeVisit", () => {
  let n = 0;
  const make = (date = today()) => createVisitWithItems(admin, appt({ visitDate: date, startTime: `${String(9 + n++).padStart(2, "0")}:00`, confirmDuplicate: true })).then((r) => r.id);
  test("a master completes her own scheduled visit; the amount does not change", async () => {
    const id = await make();
    await completeVisit(akbota, id);
    const v = await prisma.visit.findUniqueOrThrow({ where: { id } });
    expect(v).toMatchObject({ status: "done", amount: 6000, completedById: akbota.id });
    expect(v.completedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "visit.complete", entityId: id } })).toBe(1);
  });
  test("another master's visit looks like it does not exist", async () => {
    const id = await make();
    await expect(completeVisit(aidana, id)).rejects.toBeInstanceOf(NotFoundError);
  });
  test("cannot be completed twice, in the future, or after the day is closed", async () => {
    const id = await make();
    await completeVisit(akbota, id);
    await expect(completeVisit(akbota, id)).rejects.toBeInstanceOf(ValidationError);
    const future = await make(plusDays(today(), 2));
    await expect(completeVisit(akbota, future)).rejects.toBeInstanceOf(ValidationError);
    const other = await make();
    await prisma.dayClosing.create({ data: { closingDate: D(today()), expectedCash: 0, actualCash: 0, difference: 0, closedById: admin.id } });
    await expect(completeVisit(akbota, other)).rejects.toBeInstanceOf(DayClosedError);
  });
  test("not allowed in a paid period", async () => {
    const id = await make();
    const p = periodFor(today());
    await prisma.payout.create({ data: { masterId: akbota.id, periodStart: D(p.start), periodEnd: D(p.end), calculatedAmount: 0, finalAmount: 0, status: "paid" } });
    await expect(completeVisit(akbota, id)).rejects.toBeInstanceOf(PeriodPaidError);
  });
});

describe("cancel, move, edit (admin only)", () => {
  const make = () => createVisitWithItems(admin, appt()).then((r) => r.id);
  test("a move into an occupied slot is refused", async () => {
    await createVisitWithItems(admin, appt({ startTime: "14:00", durationMin: 60, visitDate: plusDays(today(), 3) }));
    const id = await make();
    await expect(moveVisit(admin, id, { date: plusDays(today(), 3), time: "14:30" })).rejects.toBeInstanceOf(ValidationError);
    await expect(moveVisit(admin, id, { date: plusDays(today(), 3), time: "15:00" })).resolves.toBeUndefined();
  });
  test("cancel needs a reason, is not counted, and masters cannot do it", async () => {
    const id = await make();
    await expect(cancelVisit(admin, id, " ")).rejects.toBeInstanceOf(ValidationError);
    await expect(cancelVisit(akbota, id, "хочу")).rejects.toBeInstanceOf(ForbiddenError);
    await cancelVisit(admin, id, "Клиентка заболела");
    expect(await prisma.visit.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "cancelled", cancelledReason: "Клиентка заболела" });
  });
  test("move changes date and time, refuses a day off and a closed day", async () => {
    const id = await make();
    const d3 = plusDays(today(), 3);
    await moveVisit(admin, id, { date: d3, time: "15:00" });
    expect(await prisma.visit.findUniqueOrThrow({ where: { id } })).toMatchObject({ startTime: "15:00" });
    const d4 = plusDays(today(), 4);
    await prisma.dayOff.create({ data: { masterId: akbota.id, date: D(d4), createdById: admin.id } });
    await expect(moveVisit(admin, id, { date: d4, time: "15:00" })).rejects.toBeInstanceOf(ValidationError);
    const d5 = plusDays(today(), 5);
    await prisma.dayClosing.create({ data: { closingDate: D(d5), expectedCash: 0, actualCash: 0, difference: 0, closedById: admin.id } });
    await expect(moveVisit(admin, id, { date: d5, time: "15:00" })).rejects.toBeInstanceOf(DayClosedError);
  });
  test("edit replaces the services and the total of a scheduled visit", async () => {
    const id = await make();
    await updateScheduledVisit(admin, id, { masterId: akbota.id, clientId, paymentMethod: "kaspi", items: [{ serviceId: cut, price: 6000 }, { serviceId: style, price: 5000 }] });
    const v = await prisma.visit.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect(v.amount).toBe(11000);
    expect(v.items).toHaveLength(2);
    expect(v.paymentMethod).toBe("kaspi");
  });
  test("a done or cancelled visit cannot be moved or edited", async () => {
    const id = await make();
    await cancelVisit(admin, id, "причина");
    await expect(moveVisit(admin, id, { date: plusDays(today(), 3), time: "10:00" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateScheduledVisit(admin, id, { masterId: akbota.id, clientId, paymentMethod: "cash", items: [{ serviceId: cut, price: 6000 }] })).rejects.toBeInstanceOf(ValidationError);
  });
});
