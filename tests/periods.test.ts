import { describe, expect, test } from "vitest";
import { periodFor, todayInBusinessTz } from "@/lib/periods";

describe("periodFor", () => {
  test("15th belongs to the first half", () =>
    expect(periodFor("2026-03-15")).toEqual({ start: "2026-03-01", end: "2026-03-15" }));
  test("16th starts the second half", () =>
    expect(periodFor("2026-03-16")).toEqual({ start: "2026-03-16", end: "2026-03-31" }));
  test("31st belongs to the second half", () =>
    expect(periodFor("2026-03-31")).toEqual({ start: "2026-03-16", end: "2026-03-31" }));
  test("leap year February ends on the 29th", () =>
    expect(periodFor("2028-02-20").end).toBe("2028-02-29"));
  test("regular February ends on the 28th", () =>
    expect(periodFor("2026-02-20").end).toBe("2026-02-28"));
  test("30-day month", () => expect(periodFor("2026-04-30").end).toBe("2026-04-30"));
  test("rejects a malformed date", () => expect(() => periodFor("2026-3-5")).toThrow());
});

describe("todayInBusinessTz", () => {
  test("23:30 UTC is already the next day in Almaty (UTC+5)", () =>
    expect(todayInBusinessTz(new Date("2026-03-15T19:30:00Z"))).toBe("2026-03-16"));
  test("midday stays the same day", () =>
    expect(todayInBusinessTz(new Date("2026-03-15T07:00:00Z"))).toBe("2026-03-15"));
});
