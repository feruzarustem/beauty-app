import type { User } from "@prisma/client";
import { requireRole } from "@/lib/auth/guard";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth/session";
import { DuplicateWarning, ForbiddenError, NotFoundError, PeriodPaidError, ValidationError } from "@/lib/errors";
import { AmountError } from "@/lib/money";

function tokenFrom(req: Request): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

/** Обёртка для API-маршрутов: 401 без входа, 403 при чужой роли, 400/404 для ожидаемых ошибок. */
export async function withRole(
  req: Request,
  role: "admin" | "master",
  handler: (user: User) => Promise<unknown>,
): Promise<Response> {
  const user = await getCurrentUser(tokenFrom(req));
  if (!user) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    return Response.json(await handler(requireRole(user, role)));
  } catch (e) {
    if (e instanceof ForbiddenError) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    if (e instanceof NotFoundError) return Response.json({ error: "Не найдено" }, { status: 404 });
    if (e instanceof ValidationError || e instanceof AmountError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof DuplicateWarning || e instanceof PeriodPaidError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

export function rangeFrom(req: Request): { start: string; end: string } {
  const q = new URL(req.url).searchParams;
  return { start: q.get("start") ?? "", end: q.get("end") ?? "" };
}
