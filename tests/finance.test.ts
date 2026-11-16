import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { masterEarnings, masterVisits } from "@/lib/access/master";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { periodFor, todayInBusinessTz } from "@/lib/periods";
import { cancelVisit, closeVisit, completeVisit } from "@/lib/services/appointments";
import { closeDay, dayFigures } from "@/lib/services/closing";
import { computePayroll } from "@/lib/services/payroll";
import { reportForRange } from "@/lib/services/reports";
import { DEFAULT_SHARE_PERCENT, getSharePercent } from "@/lib/services/settings";
import { createVisit, createVisitWithItems } from "@/lib/services/visits";
import { resetDb } from "./setup/db";

let admin: User, dana: User, aidana: User, akbota: User, plain: User, clientId: string;
const svc: Record<string, string> = {};
const today = () => todayInBusinessTz(new Date());

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master", category?: "lash" | "nail" | "hair") =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role, category } });
  admin = await mk("admin", "admin");
  dana = await mk("dana", "master", "lash");
  aidana = await mk("aidana", "master", "nail");
  akbota = await mk("akbota", "master", "hair");
  plain = await mk("plain", "master");
  clientId = (await prisma.client.create({ data: { name: "Клиентка", assignedMasterId: dana.id } })).id;
  const add = async (key: string, category: "lash" | "nail" | "hair", priceMin: number) => {
    svc[key] = (await prisma.service.create({ data: { category, groupName: "Г", name: key, priceMin, openEnded: true } })).id;
  };
  await add("lash", "lash", 8000);
  await add("nail", "nail", 4000);
  await add("hair", "hair", 6000);
});

const done = (masterId: string, serviceKey: string, price: number, o: Record<string, unknown> = {}) =>
  createVisitWithItems(admin, { visitDate: today(), masterId, clientId, paymentMethod: "cash", confirmDuplicate: true, items: [{ serviceId: svc[serviceKey], price }], ...o } as never);
const sched = (masterId: string, serviceKey: string, price: number, time: string, o: Record<string, unknown> = {}) =>
  done(masterId, serviceKey, price, { status: "scheduled", startTime: time, durationMin: 30, ...o });
const row = (id: string) => prisma.visit.findUniqueOrThrow({ where: { id } });
const closeIn = (o: Record<string, unknown> = {}) => ({ discountPercent: 0, paymentMethod: "cash" as const, ...o });

describe("shares by specialization, saved at closing", () => {
  test("lash and hair 50/50, nails 60/40; no-specialization master keeps the old flat rate", async () => {
    const l = await row((await done(dana.id, "lash", 10_000)).id);
    const n = await row((await done(aidana.id, "nail", 12_000)).id);
    const h = await row((await done(akbota.id, "hair", 10_001)).id);
    expect([l.masterAmount, l.salonAmount, l.splitPercent]).toEqual([5_000, 5_000, 50]);
    expect([n.masterAmount, n.salonAmount, n.splitPercent]).toEqual([7_200, 4_800, 60]);
    expect([h.masterAmount, h.salonAmount]).toEqual([5_000, 5_001]);
    const legacy = await createVisit(admin, { visitDate: today(), masterId: plain.id, clientId, amount: 9_000, paymentMethod: "cash" });
    expect((await row(legacy.id)).masterAmount).toBe(4_500);
  });
  test("settings: defaults 50/50/60/50, overridable per specialization", async () => {
    expect(DEFAULT_SHARE_PERCENT).toEqual({ lash: 50, lami_brow: 50, nail: 60, hair: 50 });
    expect(await getSharePercent("nail")).toBe(60);
    await prisma.setting.create({ data: { key: "share_percent_nail", value: "55" } });
    expect(await getSharePercent("nail")).toBe(55);
    expect(await getSharePercent(null)).toBe(50);
  });
  test("history is protected: changing a percent later never re-prices a closed visit", async () => {
    const { id } = await done(aidana.id, "nail", 10_000);
    await prisma.setting.create({ data: { key: "share_percent_nail", value: "40" } });
    expect((await row(id)).masterAmount).toBe(6_000);
    expect((await computePayroll(admin, periodFor(today()))).find((l) => l.masterId === aidana.id)!.calculated).toBe(6_000);
  });
  test("an old visit without saved shares falls back to the old formula (not lost, not re-priced)", async () => {
    await prisma.visit.create({ data: { visitDate: new Date(`${today()}T00:00:00Z`), masterId: aidana.id, clientId, amount: 10_000, paymentMethod: "cash", createdById: admin.id } });
    expect((await computePayroll(admin, periodFor(today()))).find((l) => l.masterId === aidana.id)!.calculated).toBe(5_000);
  });
  test("a scheduled visit gets its shares when the master completes it, by her specialization", async () => {
    const { id } = await sched(aidana.id, "nail", 12_000, "10:00", { prepaid: true });
    expect((await row(id)).masterAmount).toBeNull();
    await completeVisit(aidana, id);
    expect(await row(id)).toMatchObject({ masterAmount: 7_200, salonAmount: 4_800, amount: 12_000, prepaidAmount: 2_000 });
  });
});

describe("prepayment: part of the price, never extra revenue", () => {
  test("revenue stays at the final price; the prepayment is non-cash, the remainder goes by the closing method", async () => {
    await done(dana.id, "lash", 10_000, { prepaid: true, prepaidMethod: "halyk" });
    const f = await dayFigures(admin, today());
    expect(f).toMatchObject({ revenue: 10_000, cashTotal: 8_000, halykTotal: 2_000, kaspiTotal: 0, mastersTotal: 5_000, salonShare: 5_000 });
  });
  test("prepayment by cash is refused; default method is a transfer", async () => {
    await expect(done(dana.id, "lash", 10_000, { prepaid: true, prepaidMethod: "cash" })).rejects.toBeInstanceOf(ValidationError);
    const { id } = await done(dana.id, "lash", 10_000, { prepaid: true });
    expect(await row(id)).toMatchObject({ prepaidAmount: 2_000, prepaidMethod: "transfer" });
  });
  test("a cancelled booking keeps the prepayment for the salon, counted once, on the cancellation day", async () => {
    const { id } = await sched(dana.id, "lash", 10_000, "12:00", { prepaid: true, prepaidMethod: "kaspi_red", visitDate: today() });
    await cancelVisit(admin, id, "Клиентка не пришла");
    const f = await dayFigures(admin, today());
    expect(f).toMatchObject({ forfeitedPrepay: 2_000, revenue: 2_000, salonShare: 2_000, mastersTotal: 0, kaspiRedTotal: 2_000, visitCount: 0 });
    const r = await reportForRange(admin, today(), today());
    expect(r).toMatchObject({ revenue: 2_000, salonShare: 2_000, prepayments: { applied: 0, forfeited: 2_000, refunded: 0 } });
    expect(await reportForRange(admin, today(), today())).toEqual(r);
  });
  test("cancelling without a prepayment adds no income; with a prepayment it needs an open day", async () => {
    const free = await sched(dana.id, "lash", 8_000, "10:00");
    await cancelVisit(admin, free.id, "перенос");
    expect((await dayFigures(admin, today())).forfeitedPrepay).toBe(0);
    const paid = await sched(dana.id, "lash", 8_000, "13:00", { prepaid: true });
    await prisma.dayClosing.create({ data: { closingDate: new Date(`${today()}T00:00:00Z`), expectedCash: 0, actualCash: 0, difference: 0, closedById: admin.id } });
    await expect(cancelVisit(admin, paid.id, "отмена")).rejects.toThrow(/День закрыт/);
  });
});

describe("closeVisit: discounts, bearer, blogger", () => {
  const lash10k = async (prepaid = true) => (await done(dana.id, "lash", 10_000, { prepaid })).id;
  test("20% discount: salon / master / shared bearers (agreed examples)", async () => {
    const cases = [["salon", 5_000, 3_000], ["master", 3_000, 5_000], ["shared", 4_000, 4_000]] as const;
    for (const [bearer, m, s] of cases) {
      const id = await lash10k();
      await closeVisit(admin, id, closeIn({ discountPercent: 20, discountReason: "Постоянная клиентка", discountBearer: bearer }));
      expect(await row(id)).toMatchObject({ listAmount: 10_000, discountPercent: 20, discountAmount: 2_000, amount: 8_000, masterAmount: m, salonAmount: s, discountBearer: bearer, splitWarning: null });
    }
  });
  test("a discount needs a reason and a bearer; blogger cannot be combined with a discount", async () => {
    const id = await lash10k();
    await expect(closeVisit(admin, id, closeIn({ discountPercent: 10, discountBearer: "salon" }))).rejects.toThrow(/причину скидки/);
    await expect(closeVisit(admin, id, closeIn({ discountPercent: 10, discountReason: "акция" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(closeVisit(admin, id, closeIn({ discountPercent: 10, discountReason: "акция", discountBearer: "salon", isBlogger: true }))).rejects.toBeInstanceOf(ValidationError);
    for (const bad of [101, -1, 12.5, "abc"]) {
      await expect(closeVisit(admin, id, closeIn({ discountPercent: bad, discountReason: "акция", discountBearer: "salon" }))).rejects.toBeInstanceOf(ValidationError);
    }
  });
  test("a discount above the payer's share warns loudly and is saved only after confirmation", async () => {
    const id = await lash10k();
    const input = closeIn({ discountPercent: 70, discountReason: "Подарок", discountBearer: "salon" });
    await expect(closeVisit(admin, id, input)).rejects.toThrow(/Подтвердите/);
    expect((await row(id)).discountPercent).toBe(0); // молча ничего не менялось
    const res = await closeVisit(admin, id, { ...input, acknowledgeWarning: true });
    expect(res.warning).toContain("доли салона");
    const v = await row(id);
    expect(v).toMatchObject({ amount: 3_000, masterAmount: 3_000, salonAmount: 0 });
    expect(v.splitWarning).toContain("доли салона");
  });
  test("100% discount with a prepayment: zero shares, and the prepayment is shown as refunded", async () => {
    const id = await lash10k();
    await closeVisit(admin, id, closeIn({ discountPercent: 100, discountReason: "Подарок", discountBearer: "shared", acknowledgeWarning: true }));
    expect(await row(id)).toMatchObject({ amount: 0, masterAmount: 0, salonAmount: 0 });
    expect((await reportForRange(admin, today(), today())).prepayments).toMatchObject({ applied: 0, refunded: 2_000 });
  });
  test("blogger / advertising: the master gets 100%, the salon 0, reported separately from discounts", async () => {
    const id = await lash10k(false);
    await closeVisit(admin, id, closeIn({ isBlogger: true }));
    expect(await row(id)).toMatchObject({ isBlogger: true, masterAmount: 10_000, salonAmount: 0, discountPercent: 0 });
    const r = await reportForRange(admin, today(), today());
    expect(r.blogger).toEqual({ count: 1, total: 10_000, masterEarned: 10_000 });
    expect(r.discounts).toEqual([]);
    expect(r).toMatchObject({ mastersTotal: 10_000, salonShare: 0 });
  });
  test("closing a scheduled visit finishes it with the chosen payment method; changing a closed amount leaves an adjustment and an audit entry", async () => {
    const { id } = await sched(dana.id, "lash", 10_000, "10:00", { prepaid: true });
    await closeVisit(admin, id, closeIn({ paymentMethod: "kaspi" }));
    expect(await row(id)).toMatchObject({ status: "done", paymentMethod: "kaspi", masterAmount: 5_000 });
    await closeVisit(admin, id, closeIn({ paymentMethod: "kaspi", discountPercent: 10, discountReason: "Ошибка в прайсе", discountBearer: "salon" }));
    expect(await prisma.visitAdjustment.count({ where: { visitId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "visit.close", entityId: id } })).toBe(2);
  });
  test("a master cannot close or cancel; a closed day and a paid period are frozen", async () => {
    const id = await lash10k();
    await expect(closeVisit(dana, id, closeIn())).rejects.toBeInstanceOf(ForbiddenError);
    await prisma.dayClosing.create({ data: { closingDate: new Date(`${today()}T00:00:00Z`), expectedCash: 0, actualCash: 0, difference: 0, closedById: admin.id } });
    await expect(closeVisit(admin, id, closeIn({ discountPercent: 10, discountReason: "акция", discountBearer: "salon" }))).rejects.toThrow(/День закрыт/);
  });
  test("the master sees her pay from the saved share and never the discount details", async () => {
    const id = await lash10k();
    await closeVisit(admin, id, closeIn({ discountPercent: 20, discountReason: "Секретная причина", discountBearer: "master" }));
    const mine = await masterVisits(dana, periodFor(today()));
    expect(mine[0]).toMatchObject({ amount: 8_000, myShare: 3_000 });
    expect(JSON.stringify(mine)).not.toContain("Секретная");
    expect(JSON.stringify(mine)).not.toContain("salon");
    expect((await masterEarnings(dana, periodFor(today()))).calculated).toBe(3_000);
  });
});

describe("payment methods in closing and reports", () => {
  test("all five methods are counted; cash reconciliation uses cash only", async () => {
    await done(dana.id, "lash", 8_000, { paymentMethod: "cash" });
    await done(dana.id, "lash", 8_001, { paymentMethod: "kaspi" });
    await done(dana.id, "lash", 8_002, { paymentMethod: "kaspi_red" });
    await done(dana.id, "lash", 8_003, { paymentMethod: "halyk" });
    await done(dana.id, "lash", 8_004, { paymentMethod: "transfer" });
    const f = await dayFigures(admin, today());
    expect(f).toMatchObject({ cashTotal: 8_000, kaspiTotal: 8_001, kaspiRedTotal: 8_002, halykTotal: 8_003, transferTotal: 8_004, revenue: 40_010 });
    await closeDay(admin, today(), 8_000);
    expect(await prisma.dayClosing.findFirstOrThrow()).toMatchObject({ cashTotal: 8_000, kaspiRedTotal: 8_002, halykTotal: 8_003, expectedCash: 8_000, difference: 0 });
    const r = await reportForRange(admin, today(), today());
    expect(r.byMethod).toEqual({ cash: 8_000, kaspi: 8_001, kaspi_red: 8_002, halyk: 8_003, transfer: 8_004 });
  });
  test("report: discounts with reasons and bearers, per-master pay, prepayments, nothing counted twice", async () => {
    const a = (await done(dana.id, "lash", 10_000, { prepaid: true })).id;
    await closeVisit(admin, a, closeIn({ discountPercent: 20, discountReason: "Постоянная", discountBearer: "shared" }));
    await done(aidana.id, "nail", 12_000);
    const r = await reportForRange(admin, today(), today());
    expect(r).toMatchObject({ visitCount: 2, revenue: 8_000 + 12_000, mastersTotal: 4_000 + 7_200, salonShare: 4_000 + 4_800, discountTotal: 2_000 });
    expect(r.discounts).toEqual([expect.objectContaining({ listAmount: 10_000, percent: 20, amount: 2_000, reason: "Постоянная", bearer: "shared", finalAmount: 8_000, master: 4_000, salon: 4_000 })]);
    expect(r.prepayments.applied).toBe(2_000);
    expect(r.masters.map((m) => [m.masterName, m.earned])).toEqual([["aidana", 7_200], ["dana", 4_000]]);
    expect(await reportForRange(admin, today(), today())).toEqual(r);
  });
});
