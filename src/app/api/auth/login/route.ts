import { NextResponse } from "next/server";
import { authenticate, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

export async function POST(req: Request) {
  const form = await req.formData();
  const user = await authenticate(String(form.get("login") ?? ""), String(form.get("password") ?? ""));
  if (!user) return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  const res = NextResponse.redirect(new URL(user.role === "admin" ? "/admin" : "/master", req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
