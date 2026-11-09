import { beforeEach, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "./setup/db";

beforeEach(resetDb);

test("fresh database has master share setting of 50", async () => {
  const s = await prisma.setting.findUnique({ where: { key: "master_share_percent" } });
  expect(s?.value).toBe("50");
});
