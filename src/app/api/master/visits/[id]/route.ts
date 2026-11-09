import { masterVisit } from "@/lib/access/master";
import { withRole } from "@/lib/api/guard";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withRole(req, "master", (user) => masterVisit(user, id));
}
