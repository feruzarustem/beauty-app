import { beforeEach, describe, expect, test } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createClient,
  deleteClient,
  getClientForAdmin,
  updateClientContact,
} from "@/lib/services/clients";
import { resetDb } from "./setup/db";

let admin: User, master: User;

beforeEach(async () => {
  await resetDb();
  const mk = (login: string, role: "admin" | "master") =>
    prisma.user.create({ data: { name: login, login, passwordHash: "x", role } });
  admin = await mk("admin", "admin");
  master = await mk("m1", "master");
});

describe("client contacts (admin only)", () => {
  test("createClient with a phone stores it in client_contacts with consent time", async () => {
    const c = await createClient(admin, { name: "Айгуль", assignedMasterId: master.id, phone: "+7 700 000 00 01" });
    const contact = await prisma.clientContact.findUnique({ where: { clientId: c.id } });
    expect(contact?.phone).toBe("+7 700 000 00 01");
    expect(contact?.consentAt).toBeInstanceOf(Date);
  });
  test("createClient without a phone creates no contact row", async () => {
    const c = await createClient(admin, { name: "Мадина", assignedMasterId: master.id });
    expect(await prisma.clientContact.count({ where: { clientId: c.id } })).toBe(0);
  });
  test("a blank or letters-only phone is rejected", async () => {
    await expect(createClient(admin, { name: "X", assignedMasterId: master.id, phone: "abc" })).rejects.toThrow(ValidationError);
  });
  test("updateClientContact sets and replaces the phone", async () => {
    const c = await createClient(admin, { name: "X", assignedMasterId: master.id });
    await updateClientContact(admin, c.id, "+7 701 111 11 11");
    await updateClientContact(admin, c.id, "+7 702 222 22 22");
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { clientId: c.id } })).phone).toBe("+7 702 222 22 22");
  });
  test("getClientForAdmin returns name, master and phone", async () => {
    const c = await createClient(admin, { name: "Айгуль", assignedMasterId: master.id, phone: "+7 700 000 00 01" });
    expect(await getClientForAdmin(admin, c.id)).toMatchObject({ name: "Айгуль", phone: "+7 700 000 00 01", assignedMasterId: master.id });
  });
  test("master cannot read, change or delete contacts", async () => {
    const c = await createClient(admin, { name: "X", assignedMasterId: master.id, phone: "+7 700 000 00 01" });
    await expect(getClientForAdmin(master, c.id)).rejects.toThrow(ForbiddenError);
    await expect(updateClientContact(master, c.id, "+7 700 000 00 02")).rejects.toThrow(ForbiddenError);
    await expect(deleteClient(master, c.id)).rejects.toThrow(ForbiddenError);
  });
  test("unknown client is NotFound", async () => {
    await expect(getClientForAdmin(admin, "nope")).rejects.toThrow(NotFoundError);
  });
});

describe("deleteClient", () => {
  test("removes the client and the contact, keeps visits without a client link", async () => {
    const c = await createClient(admin, { name: "X", assignedMasterId: master.id, phone: "+7 700 000 00 01" });
    const v = await prisma.visit.create({
      data: { visitDate: new Date("2026-03-05T00:00:00Z"), masterId: master.id, clientId: c.id, amount: 1000, paymentMethod: "cash", createdById: admin.id },
    });
    await deleteClient(admin, c.id);
    expect(await prisma.client.count()).toBe(0);
    expect(await prisma.clientContact.count()).toBe(0);
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).clientId).toBeNull();
  });
});
