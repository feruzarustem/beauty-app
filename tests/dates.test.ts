import { describe, expect, test } from "vitest";
import { addDays, eachDay, fmtDay, isIsoDate, startOfWeek } from "@/lib/dates";

describe("dates", () => {
  test("week starts on Monday, including for Sunday", () => {
    expect(startOfWeek("2026-11-11")).toBe("2026-11-09"); // среда
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09"); // понедельник
    expect(startOfWeek("2026-11-15")).toBe("2026-11-09"); // воскресенье
  });
  test("addDays crosses month and year", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  test("fmtDay, eachDay, isIsoDate", () => {
    expect(fmtDay("2026-11-09")).toBe("пн 09.11");
    expect(eachDay("2026-11-29", 3)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-11-09")).toBe(true);
  });
});
