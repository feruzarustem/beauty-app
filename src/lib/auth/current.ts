import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { requireRole } from "./guard";
import { getCurrentUser, SESSION_COOKIE } from "./session";

/** Для серверных страниц и действий: текущий пользователь нужной роли или перенаправление на вход. */
export async function requireUser(role: "admin" | "master"): Promise<User> {
  const user = await getCurrentUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  try {
    return requireRole(user, role);
  } catch {
    redirect("/login");
  }
}
