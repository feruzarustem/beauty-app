import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { todayInBusinessTz } from "@/lib/periods";
import { closeVisit } from "@/lib/services/appointments";
import { getClientCard, listClientsWithHistory } from "@/lib/services/clientCard";
import { createVisit, createVisitWithItems } from "@/lib/services/visits";
import { resetDb } from "./setup/db";

let admin: User, dana: User, aidana: User, svc: string;
const today = () => todayInBusinessTz(new Date());
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master", category?: "lash" | "nail") =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role, category } });
  admin = await mk("admin", "admin");
  dana = await mk("dana", "master", "lash");
  aidana = await mk("aidana", "master", "nail");
  svc = (await prisma.service.create({ data: { category: "lash", groupName: "Г", name: "Классика", priceMin: 8000 } })).id;
});

const client = (name: string, phone?: string) =>
  prisma.client.create({ data: { name, assignedMasterId: dana.id, ...(phone ? { contact: { create: { phone, consentAt: new Date() } } } : {}) } });
const visitOn = (clientId: string, daysAgo: number, amount = 8000) =>
  createVisit(admin, { visitDate: addDays(today(), -daysAgo), masterId: dana.id, clientId, amount, paymentMethod: "cash", confirmDuplicate: true });

describe("client card", () => {
  test("last visit, days since, total visits, history and next appointment", async () => {
    const c = await client("Айгуль", "+77001234567");
    await visitOn(c.id, 40, 8000);
    await visitOn(c.id, 10, 9000);
    const next = await createVisitWithItems(admin, { visitDate: addDays(today(), 3), startTime: "15:00", durationMin: 60, status: "scheduled", masterId: dana.id, clientId: c.id, paymentMethod: "cash", items: [{ serviceId: svc, price: 8000 }] });
    const card = await getClientCard(admin, c.id);
    expect(card).toMatchObject({ name: "Айгуль", phone: "+77001234567", masterName: "dana", lastVisit: addDays(today(), -10), daysSince: 10, totalVisits: 2 });
    expect(card.history.map((h) => [h.date, h.amount])).toEqual([[addDays(today(), -10), 9000], [addDays(today(), -40), 8000]]);
    expect(card.nextAppointment).toMatchObject({ id: next.id, date: addDays(today(), 3), time: "15:00", masterName: "dana" });
  });
  test("the history updates when a booking is closed; cancelled and future bookings are not visits", async () => {
    const c = await client("Алия");
    const a = await createVisitWithItems(admin, { visitDate: today(), startTime: "11:00", durationMin: 30, status: "scheduled", masterId: dana.id, clientId: c.id, paymentMethod: "cash", items: [{ serviceId: svc, price: 8000 }] });
    expect((await getClientCard(admin, c.id)).totalVisits).toBe(0);
    await closeVisit(admin, a.id, { discountPercent: 0, paymentMethod: "kaspi" });
    const card = await getClientCard(admin, c.id);
    expect(card).toMatchObject({ totalVisits: 1, lastVisit: today(), daysSince: 0, nextAppointment: null, lastService: "Классика", lastMasterName: "dana" });
    expect(card.history[0]).toMatchObject({ services: ["Классика"], amount: 8000, masterName: "dana" });
  });
  test("no visits at all: empty history, nulls", async () => {
    const c = await client("Новая");
    expect(await getClientCard(admin, c.id)).toMatchObject({ lastVisit: null, daysSince: null, totalVisits: 0, history: [], nextAppointment: null });
  });
  test("masters cannot open it; a missing client is NotFound", async () => {
    const c = await client("Айгуль");
    await expect(getClientCard(dana, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getClientCard(admin, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("clients who have not visited for more than 30 / 45 / 60 / 90 days", () => {
  test("the filter keeps only clients whose last done visit is older than N days", async () => {
    const [a, b, c, d, never] = await Promise.all(["A30", "B50", "C70", "D100", "Никогда"].map((n) => client(n)));
    await visitOn(a.id, 20); // недавно
    await visitOn(b.id, 50);
    await visitOn(c.id, 70);
    await visitOn(d.id, 100);
    const names = async (days?: 30 | 45 | 60 | 90) => (await listClientsWithHistory(admin, { inactiveDays: days })).map((x) => x.name).sort();
    expect(await names()).toEqual(["A30", "B50", "C70", "D100", "Никогда"]);
    expect(await names(30)).toEqual(["B50", "C70", "D100"]);
    expect(await names(45)).toEqual(["B50", "C70", "D100"]);
    expect(await names(60)).toEqual(["C70", "D100"]);
    expect(await names(90)).toEqual(["D100"]);
    expect(never.id).toBeTruthy();
  });
  test("exactly N days ago is not 'more than N'; a later visit overrides an old one", async () => {
    const e = await client("Ровно30");
    await visitOn(e.id, 30);
    expect((await listClientsWithHistory(admin, { inactiveDays: 30 })).map((x) => x.name)).toEqual([]);
    const f = await client("Вернулась");
    await visitOn(f.id, 100);
    await visitOn(f.id, 5, 7000);
    expect((await listClientsWithHistory(admin, { inactiveDays: 30 })).map((x) => x.name)).toEqual([]);
  });
  test("the list shows last visit, days since and totals; masters cannot list", async () => {
    const c = await client("Айгуль", "+77001234567");
    await visitOn(c.id, 12);
    const [row] = await listClientsWithHistory(admin, {});
    expect(row).toMatchObject({ name: "Айгуль", phone: "+77001234567", lastVisit: addDays(today(), -12), daysSince: 12, totalVisits: 1 });
    await expect(listClientsWithHistory(dana, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(D(today())).toBeTruthy();
    expect(aidana.id).toBeTruthy();
  });
});
