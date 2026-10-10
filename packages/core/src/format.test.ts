import { describe, expect, it } from "vitest";
import { formatAmount } from "./format";
import { MAX_AMOUNT, parseAmount } from "./money";

describe("formatAmount", () => {
  it.each([
    [0n, "0.00"],
    [1n, "0.000001"],
    [10_000n, "0.01"],
    [1_000_000n, "1.00"],
    [12_500_000n, "12.50"],
    [1_234_567n, "1.234567"],
    [-12_500_000n, "-12.50"],
    [-1n, "-0.000001"],
    [MAX_AMOUNT, "1000000000000.00"],
  ])("formats %s as %j", (units, expected) => {
    expect(formatAmount(units)).toBe(expected);
  });

  it("supports options", () => {
    expect(formatAmount(1_000_000n, { minFractionDigits: 0 })).toBe("1");
    expect(formatAmount(1_500_000n, { minFractionDigits: 0 })).toBe("1.5");
    expect(formatAmount(123n, { decimals: 2 })).toBe("1.23");
    expect(formatAmount(5n, { decimals: 0 })).toBe("5");
  });

  it.each([0n, 1n, 12_500_000n, 1_234_567n, MAX_AMOUNT])(
    "round-trips %s through parseAmount without loss",
    (units) => {
      expect(parseAmount(formatAmount(units))).toBe(units);
    },
  );
});
