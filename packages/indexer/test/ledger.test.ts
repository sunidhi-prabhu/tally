import { describe, expect, it } from "vitest";
import {
  checkExpense,
  checkSettlement,
  expenseKey,
  membershipKey,
  settlementKindFromEvent,
  settlementKindName,
  splitTypeFromEvent,
  toCoreExpense,
  toCoreSettlement,
} from "../src/ledger";

const A = "0x00000000000000000000000000000000000a11ce";
const B = "0x0000000000000000000000000000000000000b0b";
const C = "0x00000000000000000000000000000000000ca401";

describe("event enum mapping", () => {
  it("maps SplitType and rejects unknown values", () => {
    expect(splitTypeFromEvent(0n)).toBe("EQUAL");
    expect(splitTypeFromEvent(1n)).toBe("CUSTOM");
    expect(() => splitTypeFromEvent(2n)).toThrow("Unknown SplitType");
  });

  it("maps SettlementKind and never guesses", () => {
    expect(settlementKindFromEvent(1n)).toBe("acknowledged");
    expect(settlementKindFromEvent(2n)).toBe("token");
    expect(() => settlementKindFromEvent(0n)).toThrow("Unknown SettlementKind");
    expect(() => settlementKindFromEvent(3n)).toThrow("Unknown SettlementKind");
    expect(settlementKindName("token")).toBe("TOKEN_TRANSFER");
    expect(settlementKindName("acknowledged")).toBe("ACKNOWLEDGED");
  });
});

describe("conversion to core types", () => {
  it("lowercases addresses and IDs", () => {
    const expense = toCoreExpense({
      groupId: 7n,
      expenseId: "0xABC",
      payer: "0xAbCd",
      amount: 10n,
      participants: ["0xAbCd"],
      shares: [10n],
      description: "x",
    });
    expect(expense).toMatchObject({
      id: "7-0xabc",
      groupId: "7",
      payer: "0xabcd",
    });
    expect(expense.shares).toEqual([{ member: "0xabcd", amount: 10n }]);
    expect(membershipKey(7n, "0xAbCd")).toBe("7-0xabcd");
    expect(expenseKey(7n, "0xABC")).toBe("7-0xabc");
  });

  it("carries the settlement kind", () => {
    const params = {
      groupId: 1n,
      settlementId: "0x01",
      from: B,
      to: A,
      amount: 5n,
    };
    expect(toCoreSettlement({ ...params, kind: 2n }).kind).toBe("token");
    expect(toCoreSettlement({ ...params, kind: 1n }).kind).toBe("acknowledged");
  });
});

describe("consistency checks against @tally/core", () => {
  const base = {
    groupId: 1n,
    expenseId: "0x01",
    payer: A,
    amount: 10_000_000n,
    participants: [B, A, C], // ascending: 0xb0b < 0xa11ce < 0xca401
    description: "",
  };

  it("accepts the contract's equal split", () => {
    expect(
      checkExpense(
        { ...base, shares: [3_333_334n, 3_333_333n, 3_333_333n] },
        "EQUAL",
      ),
    ).toBeUndefined();
  });

  it("flags an equal split whose remainder went to the wrong member", () => {
    expect(
      checkExpense(
        { ...base, shares: [3_333_333n, 3_333_334n, 3_333_333n] },
        "EQUAL",
      ),
    ).toMatch(/differs from core splitEqual/);
  });

  it("flags shares that do not add up or do not line up", () => {
    expect(checkExpense({ ...base, shares: [1n, 1n, 1n] }, "CUSTOM")).toMatch(
      /SPLIT_TOTAL_MISMATCH/,
    );
    expect(checkExpense({ ...base, shares: [10_000_000n] }, "CUSTOM")).toMatch(
      /different lengths/,
    );
  });

  it("checks settlements with core maxSettleable", () => {
    const settlement = toCoreSettlement({
      groupId: 1n,
      settlementId: "0x01",
      from: B,
      to: A,
      amount: 5n,
      kind: 2n,
    });
    expect(checkSettlement(settlement, -5n, 8n)).toBeUndefined();
    expect(checkSettlement(settlement, -4n, 8n)).toMatch(
      /exceeds core maxSettleable 4/,
    );
    expect(checkSettlement(settlement, 3n, 8n)).toMatch(/maxSettleable 0/);
  });
});
