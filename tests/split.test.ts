import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { PREPAY_AMOUNT, computeSplit, paymentBreakdown } from "@/lib/split";

const base = { discountPercent: 0, bearer: null, blogger: false, prepaid: 0 } as const;

describe("computeSplit: agreed examples", () => {
  test("lash 50/50, no discount, with prepayment: revenue stays 10 000, prepayment is not extra", () => {
    expect(computeSplit({ ...base, listAmount: 10_000, prepaid: PREPAY_AMOUNT, masterPercent: 50 })).toMatchObject({
      discountAmount: 0, finalAmount: 10_000, remainder: 8_000, refund: 0, master: 5_000, salon: 5_000, warning: null,
    });
  });
  test("20% discount paid by the salon: master keeps 5 000", () => {
    expect(computeSplit({ ...base, listAmount: 10_000, discountPercent: 20, bearer: "salon", prepaid: 2000, masterPercent: 50 })).toMatchObject({
      discountAmount: 2_000, finalAmount: 8_000, remainder: 6_000, master: 5_000, salon: 3_000, warning: null,
    });
  });
  test("20% discount paid by the master: salon keeps 5 000", () => {
    expect(computeSplit({ ...base, listAmount: 10_000, discountPercent: 20, bearer: "master", prepaid: 2000, masterPercent: 50 })).toMatchObject({
      finalAmount: 8_000, remainder: 6_000, master: 3_000, salon: 5_000,
    });
  });
  test("20% discount shared 50/50", () => {
    expect(computeSplit({ ...base, listAmount: 10_000, discountPercent: 20, bearer: "shared", prepaid: 2000, masterPercent: 50 })).toMatchObject({
      master: 4_000, salon: 4_000,
    });
  });
  test("nails 60/40, 30% paid by the master", () => {
    expect(computeSplit({ ...base, listAmount: 12_000, discountPercent: 30, bearer: "master", prepaid: 2000, masterPercent: 60 })).toMatchObject({
      discountAmount: 3_600, finalAmount: 8_400, remainder: 6_400, master: 3_600, salon: 4_800,
    });
  });
  test("100% discount with prepayment: everything is zero, prepayment is refunded, warning shown", () => {
    const r = computeSplit({ ...base, listAmount: 10_000, discountPercent: 100, bearer: "salon", prepaid: 2000, masterPercent: 50 });
    expect(r).toMatchObject({ finalAmount: 0, remainder: 0, refund: 2_000, master: 0, salon: 0 });
    expect(r.warning).not.toBeNull();
  });
  test("blogger / advertising: master gets 100%, salon 0", () => {
    expect(computeSplit({ ...base, listAmount: 10_000, blogger: true, masterPercent: 50 })).toMatchObject({ master: 10_000, salon: 0, warning: null });
  });
});

describe("computeSplit: caps are loud, never silent, never negative", () => {
  test("70% paid by the salon exceeds the salon's share: master cut to the money received, warning", () => {
    const r = computeSplit({ ...base, listAmount: 10_000, discountPercent: 70, bearer: "salon", masterPercent: 50 });
    expect(r).toMatchObject({ finalAmount: 3_000, master: 3_000, salon: 0 });
    expect(r.warning).toContain("доли салона");
  });
  test("discount above the master's share when the master pays: master cut to 0, warning", () => {
    const r = computeSplit({ ...base, listAmount: 10_000, discountPercent: 80, bearer: "master", masterPercent: 50 });
    expect(r).toMatchObject({ finalAmount: 2_000, master: 0, salon: 2_000 });
    expect(r.warning).toContain("доли мастера");
  });
  test("master + salon always equal the final amount and neither is negative (sweep)", () => {
    for (const pct of [50, 60])
      for (const bearer of ["master", "salon", "shared"] as const)
        for (const d of [0, 1, 10, 33, 50, 70, 99, 100])
          for (const P of [1, 999, 10_001, 15_000])
            for (const prepaid of [0, 2000]) {
              const r = computeSplit({ listAmount: P, discountPercent: d, bearer: d ? bearer : null, blogger: false, prepaid, masterPercent: pct });
              expect(r.master + r.salon).toBe(r.finalAmount);
              expect(r.master).toBeGreaterThanOrEqual(0);
              expect(r.salon).toBeGreaterThanOrEqual(0);
              expect(r.remainder).toBeGreaterThanOrEqual(0);
              expect(r.remainder + Math.min(prepaid, r.finalAmount) + r.refund - Math.max(0, prepaid - r.finalAmount)).toBe(r.finalAmount);
            }
  });
});

describe("computeSplit: validation", () => {
  test("discount needs a bearer; blogger and discount cannot be combined; ranges are enforced", () => {
    expect(() => computeSplit({ ...base, listAmount: 1000, discountPercent: 10, masterPercent: 50 })).toThrow(ValidationError);
    expect(() => computeSplit({ ...base, listAmount: 1000, discountPercent: 10, bearer: "salon", blogger: true, masterPercent: 50 })).toThrow(ValidationError);
    expect(() => computeSplit({ ...base, listAmount: 1000, discountPercent: 101, bearer: "salon", masterPercent: 50 })).toThrow(ValidationError);
    expect(() => computeSplit({ ...base, listAmount: 1000, discountPercent: 1.5, bearer: "salon", masterPercent: 50 })).toThrow(ValidationError);
    expect(() => computeSplit({ ...base, listAmount: 1000, prepaid: 500, masterPercent: 50 })).toThrow(ValidationError);
    expect(() => computeSplit({ ...base, listAmount: 0, masterPercent: 50 })).toThrow(ValidationError);
  });
  test("odd amounts round down for the master (remainder stays with the salon)", () => {
    expect(computeSplit({ ...base, listAmount: 15_001, masterPercent: 50 })).toMatchObject({ master: 7_500, salon: 7_501 });
  });
});

describe("paymentBreakdown", () => {
  test("splits a final amount into the prepayment's method and the remainder's method; sums to the final amount", () => {
    expect(paymentBreakdown({ finalAmount: 8_000, prepaid: 2_000, prepaidMethod: "transfer", method: "cash" })).toEqual([
      { method: "transfer", amount: 2_000 },
      { method: "cash", amount: 6_000 },
    ]);
    expect(paymentBreakdown({ finalAmount: 1_500, prepaid: 2_000, prepaidMethod: "halyk", method: "cash" })).toEqual([{ method: "halyk", amount: 1_500 }]);
    expect(paymentBreakdown({ finalAmount: 5_000, prepaid: 0, prepaidMethod: null, method: "kaspi" })).toEqual([{ method: "kaspi", amount: 5_000 }]);
  });
});
