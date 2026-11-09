import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSessionToken } from "@/lib/auth/session";
import { todayInBusinessTz } from "@/lib/periods";
import { createVisitWithItems } from "@/lib/services/visits";
import { GET as schedule } from "@/app/api/master/schedule/route";
import { POST as complete } from "@/app/api/master/visits/[id]/complete/route";
import { resetDb } from "./setup/db";

let admin: User, dana: User, aidana: User, visitId: string;
const today = () => todayInBusinessTz(new Date());
const req = (path: string, token?: string, method = "GET") =>
  new Request(`http://localhost${path}`, { method, headers: token ? { cookie: `session=${token}` } : {} });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master") => prisma.user.create({ data: { name: login, login, passwordHash: "x", role, category: role === "master" ? "hair" : undefined } });
  admin = await mk("admin", "admin");
  dana = await mk("dana", "master");
  aidana = await mk("aidana", "master");
  const client = await prisma.client.create({ data: { name: "К", assignedMasterId: dana.id, contact: { create: { phone: "+7 700 555 66 77", consentAt: new Date() } } } });
  const svc = await prisma.service.create({ data: { category: "hair", groupName: "Г", name: "С", priceMin: 6000 } });
  visitId = (await createVisitWithItems(admin, { visitDate: today(), startTime: "10:00", status: "scheduled", masterId: dana.id, clientId: client.id, paymentMethod: "cash", items: [{ serviceId: svc.id, price: 6000 }] })).id;
});

describe("master schedule API", () => {
  test("401 without session, 403 for admin", async () => {
    expect((await schedule(req("/api/master/schedule"))).status).toBe(401);
    expect((await schedule(req("/api/master/schedule", await createSessionToken(admin.id)))).status).toBe(403);
    expect((await complete(req(`/api/master/visits/${visitId}/complete`, undefined, "POST"), ctx(visitId))).status).toBe(401);
    expect((await complete(req(`/api/master/visits/${visitId}/complete`, await createSessionToken(admin.id), "POST"), ctx(visitId))).status).toBe(403);
  });
  test("master gets her schedule without phone or money; bad window gives 400", async () => {
    const t = await createSessionToken(dana.id);
    const res = await schedule(req(`/api/master/schedule?from=${today()}&days=7`, t));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("10:00");
    expect(body).not.toContain("700 555");
    expect(body).not.toContain("6000");
    expect((await schedule(req(`/api/master/schedule?from=${today()}&days=99`, t))).status).toBe(400);
  });
  test("completing another master's visit is 404 and changes nothing; her own works once", async () => {
    const other = await createSessionToken(aidana.id);
    expect((await complete(req(`/api/master/visits/${visitId}/complete`, other, "POST"), ctx(visitId))).status).toBe(404);
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe("scheduled");
    const mine = await createSessionToken(dana.id);
    expect((await complete(req(`/api/master/visits/${visitId}/complete`, mine, "POST"), ctx(visitId))).status).toBe(200);
    expect((await complete(req(`/api/master/visits/${visitId}/complete`, mine, "POST"), ctx(visitId))).status).toBe(400);
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).amount).toBe(6000);
  });
  test("completing in a closed day is 409", async () => {
    await prisma.dayClosing.create({ data: { closingDate: new Date(`${today()}T00:00:00Z`), expectedCash: 0, actualCash: 0, difference: 0, closedById: admin.id } });
    const mine = await createSessionToken(dana.id);
    expect((await complete(req(`/api/master/visits/${visitId}/complete`, mine, "POST"), ctx(visitId))).status).toBe(409);
  });
});
