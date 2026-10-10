import { describe, expect, it } from "vitest";
import {
  formatAusd,
  formatNative,
  plural,
  shortAddress,
  shortHash,
  timeAgo,
} from "./format";

describe("formatAusd", () => {
  it.each([
    [0n, {}, "0.00"],
    [1n, {}, "0.000001"],
    [12_500_000n, {}, "12.50"],
    [-12_500_000n, {}, "-12.50"],
    [8_666_667n, { signed: true }, "+8.666667"],
    [-333_333n, { signed: true }, "-0.333333"],
    [0n, { signed: true }, "0.00"],
    [1_000_000_000_000_000_000n, {}, "1000000000000.00"],
  ] as const)("formats %s → %s", (units, options, expected) => {
    expect(formatAusd(units, options)).toBe(expected);
  });
});

describe("other formatting", () => {
  it("shortens addresses and hashes", () => {
    expect(shortAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")).toBe(
      "0xf39f…2266",
    );
    expect(shortHash(`0x${"ab".repeat(32)}`)).toBe("0xabababab…ababab");
  });

  it("formats native fees exactly, truncated to 6 decimals", () => {
    expect(formatNative(59_000_000_000_000n, "MON")).toBe("0.000059 MON");
    expect(formatNative(2n * 10n ** 18n, "MON")).toBe("2 MON");
  });

  it("describes elapsed time", () => {
    const now = 1_700_000_000_000;
    expect(timeAgo(now / 1000 - 5, now)).toBe("just now");
    expect(timeAgo(now / 1000 - 120, now)).toBe("2 min ago");
    expect(timeAgo(now / 1000 - 7200, now)).toBe("2 h ago");
  });

  it("pluralizes", () => {
    expect(plural(1, "expense")).toBe("1 expense");
    expect(plural(3, "expense")).toBe("3 expenses");
  });
});
