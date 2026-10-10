import { describe, expect, it } from "vitest";
import {
  AUSD_DECIMALS,
  MAX_AMOUNT,
  assertNonNegativeAmount,
  assertPositiveAmount,
  parseAmount,
  unitsFromNumber,
} from "./money";
import { expectTallyError } from "./test-helpers";

describe("parseAmount", () => {
  it("uses AUSD's 6 decimals by default", () => {
    expect(AUSD_DECIMALS).toBe(6);
    expect(parseAmount("1")).toBe(1_000_000n);
  });

  it.each([
    ["0", 0n],
    ["1", 1_000_000n],
    ["12.5", 12_500_000n],
    ["12.50", 12_500_000n],
    ["0.000001", 1n],
    ["999.999999", 999_999_999n],
    ["  7.25 ", 7_250_000n],
    ["007", 7_000_000n],
    ["1000000000000", MAX_AMOUNT],
  ])("parses %j → %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "abc",
    "-1",
    "+1",
    "-0.5",
    "1e6",
    "1E-6",
    "1,000",
    "1 000",
    "1.",
    ".5",
    "1.2.3",
    "0x10",
    "NaN",
    "Infinity",
    "１",
    "1".repeat(65),
  ])("rejects malformed input %j", (input) => {
    expectTallyError(() => parseAmount(input), "INVALID_AMOUNT");
  });

  it.each(["0.0000001", "1.1234567", "1.0000000"])(
    "rejects excessive precision %j instead of rounding",
    (input) => {
      expectTallyError(() => parseAmount(input), "EXCESS_PRECISION");
    },
  );

  it.each(["1000000000000.000001", "99999999999999999999"])(
    "rejects too-large %j",
    (input) => {
      expectTallyError(() => parseAmount(input), "AMOUNT_TOO_LARGE");
    },
  );

  it("supports other decimal counts", () => {
    expect(parseAmount("1.23", 2)).toBe(123n);
    expect(parseAmount("1", 0)).toBe(1n);
    expect(parseAmount("0.000000000000000001", 18)).toBe(1n);
    expectTallyError(() => parseAmount("1.5", 0), "EXCESS_PRECISION");
  });

  it.each([-1, 1.5, 37, Number.NaN])(
    "rejects invalid decimals %s",
    (decimals) => {
      expectTallyError(() => parseAmount("1", decimals), "INVALID_AMOUNT");
    },
  );

  it("rejects non-string input from untyped callers", () => {
    expectTallyError(
      () => parseAmount(12 as unknown as string),
      "INVALID_AMOUNT",
    );
  });
});

describe("unitsFromNumber", () => {
  it.each([
    [0, 0n],
    [123, 123n],
    [-5, -5n],
    [Number.MAX_SAFE_INTEGER, 9_007_199_254_740_991n],
  ])("converts safe integer %s", (input, expected) => {
    expect(unitsFromNumber(input)).toBe(expected);
  });

  it.each([
    1.5,
    0.1,
    2 ** 53,
    -(2 ** 53),
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects %s", (input) => {
    expectTallyError(() => unitsFromNumber(input), "UNSAFE_INTEGER");
  });
});

describe("amount assertions", () => {
  it("accepts the valid range", () => {
    expect(() => assertPositiveAmount(1n)).not.toThrow();
    expect(() => assertPositiveAmount(MAX_AMOUNT)).not.toThrow();
    expect(() => assertNonNegativeAmount(0n)).not.toThrow();
  });

  it.each([
    [0n, "NON_POSITIVE_AMOUNT"],
    [-1n, "NON_POSITIVE_AMOUNT"],
    [MAX_AMOUNT + 1n, "AMOUNT_TOO_LARGE"],
    [1, "INVALID_AMOUNT"],
    [1.5, "INVALID_AMOUNT"],
    ["1", "INVALID_AMOUNT"],
  ] as const)("assertPositiveAmount(%s) → %s", (value, code) => {
    expectTallyError(() => assertPositiveAmount(value as bigint), code);
  });

  it.each([
    [-1n, "NEGATIVE_AMOUNT"],
    [MAX_AMOUNT + 1n, "AMOUNT_TOO_LARGE"],
    [0, "INVALID_AMOUNT"],
  ] as const)("assertNonNegativeAmount(%s) → %s", (value, code) => {
    expectTallyError(() => assertNonNegativeAmount(value as bigint), code);
  });
});
