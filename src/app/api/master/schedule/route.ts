import { masterSchedule } from "@/lib/access/master";
import { withRole } from "@/lib/api/guard";
import { todayInBusinessTz } from "@/lib/periods";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return withRole(req, "master", (user) =>
    masterSchedule(user, q.get("from") ?? todayInBusinessTz(new Date()), Number(q.get("days") ?? 7)),
  );
}
