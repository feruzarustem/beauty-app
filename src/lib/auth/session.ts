import { jwtVerify, SignJWT } from "jose";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyPassword } from "./password";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET должен быть не короче 32 символов");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(key());
}

/** Пользователь по токену; null для подделанного, просроченного токена и неактивного пользователя. */
export async function getCurrentUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    return user && user.active ? user : null;
  } catch {
    return null;
  }
}

/** Проверка логина и пароля; одинаковый null на любую ошибку. */
export async function authenticate(login: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { login } });
  if (!user || !user.active) return null;
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}
