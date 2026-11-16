import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { resetDb } from "./setup/db";

// За туннелем или прокси адрес запроса — localhost; редирект должен оставаться относительным.
const form = (login: string, password: string) =>
  new Request("https://localhost:3000/api/auth/login", { method: "POST", body: new URLSearchParams({ login, password }) });

beforeEach(async () => {
  await resetDb();
  await prisma.user.create({ data: { name: "А", login: "admin", role: "admin", passwordHash: await hashPassword("correct-horse-1") } });
  await prisma.user.create({ data: { name: "М", login: "m", role: "master", passwordHash: await hashPassword("correct-horse-2") } });
});

describe("auth redirects stay relative", () => {
  test("admin and master land on their own pages, wrong password returns to /login", async () => {
    const a = await login(form("admin", "correct-horse-1"));
    expect([a.status, a.headers.get("location")]).toEqual([303, "/admin"]);
    expect(a.headers.get("set-cookie")).toContain("session=");
    const m = await login(form("m", "correct-horse-2"));
    expect(m.headers.get("location")).toBe("/master");
    const bad = await login(form("admin", "wrong"));
    expect([bad.status, bad.headers.get("location")]).toEqual([303, "/login?error=1"]);
    expect(bad.headers.get("set-cookie")).toBeNull();
  });
  test("logout clears the session and goes to /login", async () => {
    const res = await logout();
    expect([res.status, res.headers.get("location")]).toEqual([303, "/login"]);
  });
});
