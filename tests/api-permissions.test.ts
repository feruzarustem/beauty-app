import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSessionToken } from "@/lib/auth/session";
import { GET as listVisits } from "@/app/api/master/visits/route";
import { GET as oneVisit } from "@/app/api/master/visits/[id]/route";
import { GET as earnings } from "@/app/api/master/earnings/route";
import { resetDb } from "./setup/db";

const PHONE = "+7 700 123 45 67";
const Q = "?start=2026-03-01&end=2026-03-15";
let admin: User, masterA: User, masterB: User;
let visitA: string, visitB: string;

const req = (path: string, token?: string) =>
  new Request(`http://localhost${path}`, { headers: token ? { cookie: `session=${token}` } : {} });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master") =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role } });
  admin = await mk("admin", "admin");
  masterA = await mk("masterA", "master");
  masterB = await mk("masterB", "master");
  const cA = await prisma.client.create({
    data: { name: "Айгуль", assignedMasterId: masterA.id, contact: { create: { phone: PHONE, consentAt: new Date() } } },
  });
  const cB = await prisma.client.create({ data: { name: "Мадина", assignedMasterId: masterB.id } });
  const v = (masterId: string, clientId: string, amount: number) =>
    prisma.visit.create({
      data: { visitDate: new Date("2026-03-05T00:00:00Z"), masterId, clientId, amount, paymentMethod: "cash", createdById: admin.id },
    });
  visitA = (await v(masterA.id, cA.id, 20_000)).id;
  visitB = (await v(masterB.id, cB.id, 40_000)).id;
});

describe("master API", () => {
  test("no cookie gives 401 on every route", async () => {
    expect((await listVisits(req(`/api/master/visits${Q}`))).status).toBe(401);
    expect((await oneVisit(req(`/api/master/visits/${visitA}`), ctx(visitA))).status).toBe(401);
    expect((await earnings(req(`/api/master/earnings${Q}`))).status).toBe(401);
  });
  test("forged cookie and deactivated master give 401", async () => {
    expect((await listVisits(req(`/api/master/visits${Q}`, "garbage"))).status).toBe(401);
    const t = await createSessionToken(masterA.id);
    await prisma.user.update({ where: { id: masterA.id }, data: { active: false } });
    expect((await listVisits(req(`/api/master/visits${Q}`, t))).status).toBe(401);
  });
  test("an admin cookie on master routes gives 403", async () => {
    const t = await createSessionToken(admin.id);
    expect((await listVisits(req(`/api/master/visits${Q}`, t))).status).toBe(403);
    expect((await earnings(req(`/api/master/earnings${Q}`, t))).status).toBe(403);
  });
  test("master A asking for master B's visit by id gets 404 with no data", async () => {
    const t = await createSessionToken(masterA.id);
    const res = await oneVisit(req(`/api/master/visits/${visitB}`, t), ctx(visitB));
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("Мадина");
    expect(body).not.toContain("40000");
  });
  test("master gets own visits and earnings; the phone appears in no response", async () => {
    const t = await createSessionToken(masterA.id);
    const list = await listVisits(req(`/api/master/visits${Q}`, t));
    const one = await oneVisit(req(`/api/master/visits/${visitA}`, t), ctx(visitA));
    const earn = await earnings(req(`/api/master/earnings${Q}`, t));
    expect([list.status, one.status, earn.status]).toEqual([200, 200, 200]);
    const texts = [await list.text(), await one.text(), await earn.text()];
    for (const body of texts) {
      expect(body).not.toContain(PHONE);
      expect(body.toLowerCase()).not.toContain("phone");
      expect(body).not.toContain("Мадина");
    }
    expect(JSON.parse(texts[0])).toHaveLength(1);
    expect(JSON.parse(texts[2])).toMatchObject({ calculated: 10_000, final: 10_000, status: "pending" });
  });
  test("malformed or missing range gives 400", async () => {
    const t = await createSessionToken(masterA.id);
    expect((await listVisits(req(`/api/master/visits?start=x&end=y`, t))).status).toBe(400);
    expect((await listVisits(req(`/api/master/visits`, t))).status).toBe(400);
    expect((await earnings(req(`/api/master/earnings?start=2026-03-02&end=2026-03-20`, t))).status).toBe(400);
  });
});
