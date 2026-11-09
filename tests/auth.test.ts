import { SignJWT } from "jose";
import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { authenticate, createSessionToken, getCurrentUser } from "@/lib/auth/session";
import { ForbiddenError, requireRole } from "@/lib/auth/guard";
import { resetDb } from "./setup/db";

beforeEach(resetDb);

async function makeUser(over: Partial<{ login: string; role: "admin" | "master"; active: boolean }> = {}) {
  return prisma.user.create({
    data: {
      name: "Тест",
      login: over.login ?? "admin1",
      passwordHash: await hashPassword("correct-horse"),
      role: over.role ?? "admin",
      active: over.active ?? true,
    },
  });
}

describe("passwords", () => {
  test("correct password passes, wrong fails", async () => {
    const h = await hashPassword("secret123");
    expect(await verifyPassword("secret123", h)).toBe(true);
    expect(await verifyPassword("other", h)).toBe(false);
  });
  test("hash is not the plain password", async () => {
    const u = await makeUser();
    expect(u.passwordHash).not.toContain("correct-horse");
  });
});

describe("getCurrentUser", () => {
  test("fresh token returns the user", async () => {
    const u = await makeUser();
    const got = await getCurrentUser(await createSessionToken(u.id));
    expect(got?.id).toBe(u.id);
  });
  test("tampered token returns null", async () => {
    const u = await makeUser();
    const t = await createSessionToken(u.id);
    expect(await getCurrentUser(t.slice(0, -3) + "abc")).toBeNull();
  });
  test("missing token returns null", async () => {
    expect(await getCurrentUser(undefined)).toBeNull();
  });
  test("deactivated user with a still-valid token returns null", async () => {
    const u = await makeUser();
    const t = await createSessionToken(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    expect(await getCurrentUser(t)).toBeNull();
  });
  test("expired token returns null", async () => {
    const u = await makeUser();
    const key = new TextEncoder().encode(process.env.SESSION_SECRET);
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(u.id)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(key);
    expect(await getCurrentUser(expired)).toBeNull();
  });
});

describe("authenticate", () => {
  test("right credentials return the user", async () => {
    await makeUser({ login: "anna" });
    expect((await authenticate("anna", "correct-horse"))?.login).toBe("anna");
  });
  test("wrong password and unknown login both return null", async () => {
    await makeUser({ login: "anna" });
    expect(await authenticate("anna", "nope")).toBeNull();
    expect(await authenticate("ghost", "correct-horse")).toBeNull();
  });
  test("inactive user cannot log in", async () => {
    await makeUser({ login: "off", active: false });
    expect(await authenticate("off", "correct-horse")).toBeNull();
  });
});

describe("requireRole", () => {
  test("master asking for admin is forbidden", async () => {
    const m = await makeUser({ login: "m", role: "master" });
    expect(() => requireRole(m, "admin")).toThrow(ForbiddenError);
  });
  test("null user is forbidden", () => {
    expect(() => requireRole(null, "master")).toThrow(ForbiddenError);
  });
  test("matching role returns the user", async () => {
    const a = await makeUser();
    expect(requireRole(a, "admin").id).toBe(a.id);
  });
});
