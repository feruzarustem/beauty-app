import { describe, expect, test } from "vitest";
import { periodFor, shiftPeriod, todayInBusinessTz } from "@/lib/periods";

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

describe("shiftPeriod", () => {
  test("next from first half is second half of the same month", () =>
    expect(shiftPeriod(periodFor("2026-03-05"), 1)).toEqual({ start: "2026-03-16", end: "2026-03-31" }));
  test("next from second half is first half of next month, across the year", () =>
    expect(shiftPeriod(periodFor("2026-12-20"), 1)).toEqual({ start: "2027-01-01", end: "2027-01-15" }));
  test("previous from first half is the second half of the previous month", () =>
    expect(shiftPeriod(periodFor("2028-03-05"), -1)).toEqual({ start: "2028-02-16", end: "2028-02-29" }));
  test("previous from second half is first half of the same month", () =>
    expect(shiftPeriod(periodFor("2026-03-20"), -1)).toEqual({ start: "2026-03-01", end: "2026-03-15" }));
});
