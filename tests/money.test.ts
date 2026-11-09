import { describe, expect, test } from "vitest";
import { AmountError, masterShare, parseAmount } from "@/lib/money";

describe("masterShare", () => {
  test("half of an even amount", () => expect(masterShare(15000, 50)).toBe(7500));
  test("odd amount rounds down, remainder stays with the salon", () =>
    expect(masterShare(15001, 50)).toBe(7500));
  test("1 tenge gives the master 0", () => expect(masterShare(1, 50)).toBe(0));
});

describe("parseAmount", () => {
  test("accepts a number and a digit string", () => {
    expect(parseAmount(15000)).toBe(15000);
    expect(parseAmount("15000")).toBe(15000);
  });
  test.each(["15 000", 1.5, 0, -5, 1e12, "", null, undefined, "1e3", "-5", NaN])(
    "rejects %s",
    (bad) => expect(() => parseAmount(bad)).toThrow(AmountError),
  );
  test("upper limit is 10 000 000", () => {
    expect(parseAmount(10_000_000)).toBe(10_000_000);
    expect(() => parseAmount(10_000_001)).toThrow(AmountError);
  });
});
