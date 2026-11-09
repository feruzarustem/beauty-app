import { masterEarnings } from "@/lib/access/master";
import { rangeFrom, withRole } from "@/lib/api/guard";

export async function GET(req: Request) {
  return withRole(req, "master", (user) => masterEarnings(user, rangeFrom(req)));
}
