import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { masterSchedule } from "@/lib/access/master";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { todayInBusinessTz } from "@/lib/periods";
import { calendarRange } from "@/lib/services/calendar";
import { addDaysOff, listDaysOff, removeDayOff } from "@/lib/services/dayoff";
import { closeDay } from "@/lib/services/closing";
import { reportForRange } from "@/lib/services/reports";
import { createVisit, createVisitWithItems } from "@/lib/services/visits";
import { resetDb } from "./setup/db";

let admin: User, dana: User, aidana: User, clientId: string, svc: string;
const today = () => todayInBusinessTz(new Date());
const plus = (n: number, from = today()) => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master") => prisma.user.create({ data: { name: login, login, passwordHash: "x", role, category: role === "master" ? "hair" : undefined } });
  admin = await mk("admin", "admin");
  dana = await mk("dana", "master");
  aidana = await mk("aidana", "master");
  clientId = (await prisma.client.create({ data: { name: "Клиентка", assignedMasterId: dana.id, contact: { create: { phone: "+7 700 111 22 33", consentAt: new Date() } } } })).id;
  svc = (await prisma.service.create({ data: { category: "hair", groupName: "Г", name: "Стрижка", priceMin: 6000 } })).id;
});

const sched = (masterId: string, date: string, time: string, o: Record<string, unknown> = {}) =>
  createVisitWithItems(admin, { visitDate: date, startTime: time, status: "scheduled", masterId, clientId, paymentMethod: "cash", confirmDuplicate: true, items: [{ serviceId: svc, price: 6000 }], ...o } as never);

describe("days off", () => {
  test("admin sets several future days for one master; others are unaffected; can delete", async () => {
    await addDaysOff(admin, dana.id, [plus(3), plus(4)]);
    const list = await listDaysOff(admin, plus(0), plus(10));
    expect(list.map((d) => [d.masterId, d.date])).toEqual([[dana.id, plus(3)], [dana.id, plus(4)]]);
    await addDaysOff(admin, dana.id, [plus(3)]);
    expect(await prisma.dayOff.count()).toBe(2);
    await removeDayOff(admin, dana.id, plus(3));
    expect(await prisma.dayOff.count()).toBe(1);
    await expect(sched(aidana.id, plus(4), "10:00")).resolves.toBeTruthy();
  });
  test("past dates, bad dates, and days with booked appointments are refused; masters cannot manage", async () => {
    await expect(addDaysOff(admin, dana.id, [plus(-1)])).rejects.toBeInstanceOf(ValidationError);
    await expect(addDaysOff(admin, dana.id, ["2026-13-45"])).rejects.toBeInstanceOf(ValidationError);
    await sched(dana.id, plus(2), "10:00");
    await expect(addDaysOff(admin, dana.id, [plus(2)])).rejects.toBeInstanceOf(ValidationError);
    await expect(addDaysOff(dana, dana.id, [plus(5)])).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("master schedule", () => {
  test("shows only her own entries with names and times, days off and free hours; no money, no phone", async () => {
    await sched(dana.id, plus(1), "09:00");
    await sched(dana.id, plus(1), "09:30");
    await sched(aidana.id, plus(1), "14:00");
    await prisma.dayOff.create({ data: { masterId: dana.id, date: new Date(`${plus(2)}T00:00:00Z`), createdById: admin.id } });
    const days = await masterSchedule(dana, plus(1), 7);
    expect(days).toHaveLength(7);
    expect(days[0].items.map((i) => i.time)).toEqual(["09:00", "09:30"]);
    expect(days[0].items[0]).toEqual({ id: expect.any(String), time: "09:00", clientName: "Клиентка", services: ["Стрижка"], status: "scheduled" });
    expect(days[0].freeHours).not.toContain(9);
    expect(days[0].freeHours).toContain(14);
    expect(days[1]).toMatchObject({ dayOff: true, items: [], freeHours: [] });
    const text = JSON.stringify(days);
    expect(text).not.toContain("700 111");
    expect(text).not.toContain("6000");
    expect(text).not.toContain("aidana");
  });
  test("limits the window to two weeks and rejects bad dates; admin cannot use the master view", async () => {
    await expect(masterSchedule(dana, plus(0), 30)).rejects.toBeInstanceOf(ValidationError);
    await expect(masterSchedule(dana, "nope", 7)).rejects.toBeInstanceOf(ValidationError);
    await expect(masterSchedule(admin, plus(0), 7)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("admin calendar uses the same visits", () => {
  test("returns all masters' entries and days off for a range", async () => {
    await sched(dana.id, plus(1), "10:00");
    await sched(aidana.id, plus(1), "11:00");
    await prisma.dayOff.create({ data: { masterId: aidana.id, date: new Date(`${plus(2)}T00:00:00Z`), createdById: admin.id } });
    const cal = await calendarRange(admin, plus(0), plus(7));
    expect(cal.entries.map((e) => [e.masterName, e.time, e.status])).toEqual([["dana", "10:00", "scheduled"], ["aidana", "11:00", "scheduled"]]);
    expect(cal.daysOff).toHaveLength(1);
    await expect(calendarRange(dana, plus(0), plus(7))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("reports", () => {
  test("aggregate done visits once, split by method, with closings and unclosed days", async () => {
    const d1 = today();
    await createVisit(admin, { visitDate: d1, masterId: dana.id, clientId, amount: 15001, paymentMethod: "cash", confirmDuplicate: true });
    await createVisit(admin, { visitDate: d1, masterId: aidana.id, clientId, amount: 10000, paymentMethod: "kaspi", confirmDuplicate: true });
    await sched(dana.id, plus(1), "10:00");
    await closeDay(admin, d1, 15000, "Разница 1 тг");
    const r = await reportForRange(admin, plus(-14), plus(14));
    expect(r).toMatchObject({ visitCount: 2, revenue: 25001, mastersTotal: 7500 + 5000, salonShare: 25001 - 12500, byMethod: { cash: 15001, kaspi: 10000, transfer: 0 } });
    expect(r.masters.find((m) => m.masterId === dana.id)).toMatchObject({ visitCount: 1, revenue: 15001, earned: 7500 });
    expect(r.closings).toEqual([{ date: d1, difference: -1, comment: "Разница 1 тг" }]);
    expect(r.unclosedDays).toEqual([]);
    // a second call changes nothing: reports read, they never accrue
    expect(await reportForRange(admin, plus(-14), plus(14))).toEqual(r);
  });
  test("an unclosed day with done visits is listed; masters cannot read reports", async () => {
    await createVisit(admin, { visitDate: today(), masterId: dana.id, clientId, amount: 5000, paymentMethod: "cash" });
    expect((await reportForRange(admin, today(), today())).unclosedDays).toEqual([today()]);
    await expect(reportForRange(dana, today(), today())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
