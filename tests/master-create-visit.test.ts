import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSessionToken } from "@/lib/auth/session";
import { masterServices, createMyVisit } from "@/lib/access/master";
import { AmountError } from "@/lib/money";
import { DuplicateWarning, ForbiddenError, PeriodPaidError } from "@/lib/errors";
import { periodFor, todayInBusinessTz } from "@/lib/periods";
import { listVisitsForDay } from "@/lib/services/visits";
import { POST as postVisit } from "@/app/api/master/visits/route";
import { resetDb } from "./setup/db";

let admin: User, dana: User, aidana: User;
const today = () => todayInBusinessTz(new Date());

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master", category?: "lash" | "nail") =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role, category } });
  admin = await mk("admin", "admin");
  dana = await mk("dana", "master", "lash");
  aidana = await mk("aidana", "master", "nail");
  await prisma.service.createMany({
    data: [
      { category: "lash", groupName: "Наращивание", name: "Классика", priceMin: 8000 },
      { category: "nail", groupName: "Маникюр", name: "Маникюр", priceMin: 4000 },
    ],
  });
});

const input = (o: Record<string, unknown> = {}) => ({ clientName: "Новая Клиентка", amount: "15001", paymentMethod: "cash" as const, ...o });

describe("createMyVisit", () => {
  test("records a visit for the master herself, today, created by her, with the usual share", async () => {
    const { id } = await createMyVisit(dana, input());
    const v = await prisma.visit.findUniqueOrThrow({ where: { id } });
    expect(v).toMatchObject({ masterId: dana.id, createdById: dana.id, amount: 15001 });
    expect(v.visitDate.toISOString().slice(0, 10)).toBe(today());
    const [row] = await listVisitsForDay(admin, today());
    expect(row.masterShare).toBe(7500);
    expect(row.createdByMaster).toBe(true);
  });
  test("a new name creates a client assigned to her; the same name again reuses it", async () => {
    await createMyVisit(dana, input());
    await createMyVisit(dana, input({ clientName: " новая клиентка ", amount: "9000" }));
    const clients = await prisma.client.findMany();
    expect(clients).toHaveLength(1);
    expect(clients[0].assignedMasterId).toBe(dana.id);
  });
  test("never attaches to another master's client with the same name", async () => {
    const theirs = await prisma.client.create({ data: { name: "Новая Клиентка", assignedMasterId: aidana.id } });
    const { id } = await createMyVisit(dana, input());
    const v = await prisma.visit.findUniqueOrThrow({ where: { id } });
    expect(v.clientId).not.toBe(theirs.id);
    expect(await prisma.visit.count({ where: { clientId: theirs.id } })).toBe(0);
  });
  test("rejects bad amounts and empty client name", async () => {
    await expect(createMyVisit(dana, input({ amount: "0" }))).rejects.toBeInstanceOf(AmountError);
    await expect(createMyVisit(dana, input({ clientName: "  " }))).rejects.toThrow();
  });
  test("duplicate within minutes needs confirmation", async () => {
    await createMyVisit(dana, input());
    await expect(createMyVisit(dana, input())).rejects.toBeInstanceOf(DuplicateWarning);
    await expect(createMyVisit(dana, input({ confirmDuplicate: true }))).resolves.toBeTruthy();
  });
  test("a paid period is frozen", async () => {
    const p = periodFor(today());
    await prisma.payout.create({
      data: { masterId: dana.id, periodStart: new Date(`${p.start}T00:00:00Z`), periodEnd: new Date(`${p.end}T00:00:00Z`), calculatedAmount: 0, finalAmount: 0, status: "paid" },
    });
    await expect(createMyVisit(dana, input())).rejects.toBeInstanceOf(PeriodPaidError);
  });
  test("an admin cannot use the master entry point", async () => {
    await expect(createMyVisit(admin, input())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("masterServices", () => {
  test("returns only services of her own category", async () => {
    expect((await masterServices(dana)).map((s) => s.name)).toEqual(["Классика"]);
    expect((await masterServices(aidana)).map((s) => s.name)).toEqual(["Маникюр"]);
  });
});

describe("POST /api/master/visits", () => {
  const post = (body: unknown, token?: string) =>
    postVisit(
      new Request("http://localhost/api/master/visits", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { cookie: `session=${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  test("401 without session, 403 for admin", async () => {
    expect((await post(input())).status).toBe(401);
    expect((await post(input(), await createSessionToken(admin.id))).status).toBe(403);
  });
  test("master creates her own visit; a foreign masterId in the body is ignored", async () => {
    const res = await post({ ...input(), masterId: aidana.id }, await createSessionToken(dana.id));
    expect(res.status).toBe(200);
    const v = await prisma.visit.findFirstOrThrow();
    expect(v.masterId).toBe(dana.id);
  });
  test("bad amount gives 400, duplicate gives 409", async () => {
    const t = await createSessionToken(dana.id);
    expect((await post(input({ amount: "-5" }), t)).status).toBe(400);
    expect((await post(input(), t)).status).toBe(200);
    expect((await post(input(), t)).status).toBe(409);
  });
});
