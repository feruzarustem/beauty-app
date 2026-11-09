import { createMyVisit, masterVisits } from "@/lib/access/master";
import { rangeFrom, withRole } from "@/lib/api/guard";

export async function GET(req: Request) {
  return withRole(req, "master", (user) => masterVisits(user, rangeFrom(req)));
}

/** Тело запроса: clientName, amount, paymentMethod, confirmDuplicate. Мастер и дата берутся на сервере. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return withRole(req, "master", (user) =>
    createMyVisit(user, {
      clientName: String(body.clientName ?? ""),
      amount: body.amount,
      paymentMethod: body.paymentMethod === "transfer" ? "transfer" : "cash",
      confirmDuplicate: body.confirmDuplicate === true,
    }),
  );
}
