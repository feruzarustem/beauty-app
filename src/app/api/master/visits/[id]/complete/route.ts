import { withRole } from "@/lib/api/guard";
import { completeVisit } from "@/lib/services/appointments";

/** Мастер отмечает СВОЮ запись выполненной. Сумму не принимает и не меняет. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withRole(req, "master", async (user) => {
    await completeVisit(user, id);
    return { ok: true };
  });
}
