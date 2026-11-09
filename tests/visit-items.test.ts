import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { masterVisits } from "@/lib/access/master";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { periodFor, todayInBusinessTz } from "@/lib/periods";
import { computePayroll } from "@/lib/services/payroll";
import { createVisitWithItems } from "@/lib/services/visits";
import * as masterVisitsRoute from "@/app/api/master/visits/route";
import { resetDb } from "./setup/db";

let admin: User, akbota: User, dana: User, clientId: string;
const svc: Record<string, string> = {};
const today = () => todayInBusinessTz(new Date());

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master", category?: "hair" | "lash") =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role, category } });
  admin = await mk("admin", "admin");
  akbota = await mk("akbota", "master", "hair");
  dana = await mk("dana", "master", "lash");
  clientId = (await prisma.client.create({ data: { name: "Клиентка", assignedMasterId: akbota.id } })).id;
  const add = async (key: string, data: { category: "hair" | "lash"; name: string; priceMin: number; priceMax?: number; openEnded?: boolean; kind?: "main" | "addon" | "option" }) => {
    svc[key] = (await prisma.service.create({ data: { groupName: "Г", ...data } })).id;
  };
  await add("cut", { category: "hair", name: "Стрижка", priceMin: 6000 });
  await add("style", { category: "hair", name: "Укладка на браш", priceMin: 5000 });
  await add("color", { category: "hair", name: "Окрашивание", priceMin: 15000, openEnded: true });
  await add("curlL", { category: "lash", name: "Изгиб L", priceMin: 0, kind: "option" });
  await add("lash", { category: "lash", name: "Классика", priceMin: 8000, openEnded: true });
});

const visit = (items: { serviceId: string; price: unknown; belowMinReason?: string }[], o: Record<string, unknown> = {}) => ({
  visitDate: today(),
  masterId: akbota.id,
  clientId,
  paymentMethod: "cash" as const,
  items,
  ...o,
});

describe("createVisitWithItems", () => {
  test("sums several services into the visit amount and keeps item snapshots; pay is half of the total", async () => {
    const { id } = await createVisitWithItems(admin, visit([
      { serviceId: svc.cut, price: 6000 },
      { serviceId: svc.style, price: 5000 },
      { serviceId: svc.color, price: 15000 },
    ]));
    const v = await prisma.visit.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect(v.amount).toBe(26000);
    expect(v.createdById).toBe(admin.id);
    expect(v.items.map((i) => i.name).sort()).toEqual(["Окрашивание", "Стрижка", "Укладка на браш"]);
    expect(v.items.every((i) => i.setById === admin.id)).toBe(true);
    const line = (await computePayroll(admin, periodFor(today()))).find((l) => l.masterId === akbota.id)!;
    expect(line.calculated).toBe(13000);
  });
  test("a flexible 'from' service takes any price at or above the minimum", async () => {
    const { id } = await createVisitWithItems(admin, visit([{ serviceId: svc.color, price: 21000 }]));
    const item = await prisma.visitItem.findFirstOrThrow({ where: { visitId: id } });
    expect(item).toMatchObject({ priceMin: 15000, price: 21000, belowMinReason: null });
  });
  test("a price below the minimum needs a reason, and the reason is stored", async () => {
    await expect(createVisitWithItems(admin, visit([{ serviceId: svc.color, price: 12000 }]))).rejects.toBeInstanceOf(ValidationError);
    const { id } = await createVisitWithItems(admin, visit([{ serviceId: svc.color, price: 12000, belowMinReason: "Акция для постоянной клиентки" }]));
    const item = await prisma.visitItem.findFirstOrThrow({ where: { visitId: id } });
    expect(item).toMatchObject({ priceMin: 15000, price: 12000, belowMinReason: "Акция для постоянной клиентки" });
  });
  test("a fixed-price service must be charged at the list price unless a reason is given", async () => {
    await expect(createVisitWithItems(admin, visit([{ serviceId: svc.cut, price: 7000 }]))).rejects.toBeInstanceOf(ValidationError);
    await expect(createVisitWithItems(admin, visit([{ serviceId: svc.cut, price: 7000, belowMinReason: "Длинные волосы" }]))).resolves.toBeTruthy();
  });
  test("a service parameter without its own price adds nothing to the total", async () => {
    const { id } = await createVisitWithItems(admin, visit([
      { serviceId: svc.lash, price: 9000 },
      { serviceId: svc.curlL, price: 5000 },
    ], { masterId: dana.id }));
    expect((await prisma.visit.findUniqueOrThrow({ where: { id } })).amount).toBe(9000);
  });
  test("services must belong to the master's category", async () => {
    await expect(createVisitWithItems(admin, visit([{ serviceId: svc.lash, price: 8000 }]))).rejects.toBeInstanceOf(ValidationError);
  });
  test("needs at least one service, no repeats, and a known service", async () => {
    await expect(createVisitWithItems(admin, visit([]))).rejects.toBeInstanceOf(ValidationError);
    await expect(createVisitWithItems(admin, visit([{ serviceId: svc.cut, price: 6000 }, { serviceId: svc.cut, price: 6000 }]))).rejects.toBeInstanceOf(ValidationError);
    await expect(createVisitWithItems(admin, visit([{ serviceId: "nope", price: 6000 }]))).rejects.toBeInstanceOf(ValidationError);
  });
  test("a master cannot create visits", async () => {
    await expect(createVisitWithItems(akbota, visit([{ serviceId: svc.cut, price: 6000 }]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  test("a failed visit leaves no half-saved rows", async () => {
    await expect(createVisitWithItems(admin, visit([{ serviceId: svc.cut, price: 6000 }, { serviceId: svc.color, price: 1 }]))).rejects.toThrow();
    expect(await prisma.visit.count()).toBe(0);
    expect(await prisma.visitItem.count()).toBe(0);
  });
});

describe("master side", () => {
  test("a master sees the names of the services in her own visits, not other masters'", async () => {
    await createVisitWithItems(admin, visit([{ serviceId: svc.cut, price: 6000 }, { serviceId: svc.style, price: 5000 }]));
    const p = periodFor(today());
    const mine = await masterVisits(akbota, p);
    expect(mine[0].services.sort()).toEqual(["Стрижка", "Укладка на браш"]);
    expect(await masterVisits(dana, p)).toEqual([]);
  });
  test("masters have no way to create visits: no POST route", () => {
    expect("POST" in masterVisitsRoute).toBe(false);
  });
});
