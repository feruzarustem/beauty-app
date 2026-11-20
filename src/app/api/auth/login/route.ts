import { NextResponse } from "next/server";
import { authenticate, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

/** Относительный адрес: за прокси или туннелем req.url указывает на localhost, и абсолютный редирект ломал бы вход. */
const see = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

export async function POST(req: Request) {
  const form = await req.formData();
  const user = await authenticate(String(form.get("login") ?? ""), String(form.get("password") ?? ""));
  if (!user) return see("/login?error=1");
  const res = see(user.role === "admin" ? "/admin" : "/master");
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
