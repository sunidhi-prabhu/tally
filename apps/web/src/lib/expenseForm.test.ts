import { describe, expect, it } from "vitest";
import {
  buildExpense,
  remainingToAssign,
  type ExpenseFormInput,
} from "./expenseForm";

const ALICE = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const BOB = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const CAROL = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const members = [ALICE, BOB, CAROL];

const base: ExpenseFormInput = {
  description: "Dinner",
  amountText: "10",
  splitMode: "equal",
  participants: members,
  customAmounts: {},
  members,
};

describe("equal split", () => {
  it("sorts participants for the contract and allocates every unit", () => {
    const result = buildExpense(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ascending: CAROL (0x3c..) < BOB (0x70..) < ALICE (0xf3..); remainder to the lowest.
    expect(result.payload.participants).toEqual([CAROL, BOB, ALICE]);
    expect(result.payload.shares).toEqual([3_333_334n, 3_333_333n, 3_333_333n]);
    expect(result.payload.shares.reduce((a, b) => a + b, 0n)).toBe(10_000_000n);
    expect(result.payload.amount).toBe(10_000_000n);
  });

  it("previews only selected participants and trims the description", () => {
    const result = buildExpense({
      ...base,
      description: "  Taxi ",
      participants: [BOB, ALICE],
    });
    expect(result.ok && result.payload.description).toBe("Taxi");
    expect(result.preview.map((s) => s.member)).toEqual([BOB, ALICE]);
  });

  it.each([
    ["", "Enter an amount."],
    ["0", "Amount must be greater than zero."],
    ["1.1234567", "Use at most 6 decimal places."],
    ["abc", "Enter an amount like 12.50."],
    ["-5", "Enter an amount like 12.50."],
    ["1e3", "Enter an amount like 12.50."],
  ])("rejects amount %j", (amountText, message) => {
    const result = buildExpense({ ...base, amountText });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.amount).toBe(message);
  });

  it("requires participants who are members, and a description", () => {
    expect(buildExpense({ ...base, participants: [] })).toMatchObject({
      ok: false,
      errors: { split: "Choose at least one person." },
    });
    expect(
      buildExpense({
        ...base,
        participants: ["0x0000000000000000000000000000000000000001"],
      }),
    ).toMatchObject({
      ok: false,
      errors: { split: "Everyone in the split must be a current member." },
    });
    expect(buildExpense({ ...base, description: "   " })).toMatchObject({
      ok: false,
      errors: { description: "Add a short description." },
    });
    expect(buildExpense({ ...base, description: "x".repeat(281) }).ok).toBe(
      false,
    );
  });
});

describe("custom split", () => {
  const custom = (customAmounts: Record<string, string>, amountText = "10") =>
    buildExpense({ ...base, splitMode: "custom", amountText, customAmounts });

  it("accepts shares that add up exactly, ignoring blanks and zeros", () => {
    const result = custom({ [ALICE]: "7.5", [BOB]: "2.5", [CAROL]: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.participants).toEqual([BOB, ALICE]);
    expect(result.payload.shares).toEqual([2_500_000n, 7_500_000n]);
  });

  it("rejects totals that are short or over, without floating point", () => {
    expect(custom({ [ALICE]: "0.1", [BOB]: "0.2" }, "0.3").ok).toBe(true);
    expect(custom({ [ALICE]: "4" })).toMatchObject({
      ok: false,
      errors: { split: "Shares add up to less than the amount." },
    });
    expect(custom({ [ALICE]: "6", [BOB]: "5" })).toMatchObject({
      ok: false,
      errors: { split: "Shares add up to more than the amount." },
    });
    expect(custom({})).toMatchObject({
      ok: false,
      errors: { split: "Enter at least one share." },
    });
  });

  it("reports invalid share text on that member's field", () => {
    const result = custom({ [ALICE]: "1.0000001", [BOB]: "9" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[`share:${ALICE}`]).toBe(
        "Use at most 6 decimal places.",
      );
  });

  it("computes what is left to assign", () => {
    expect(remainingToAssign("10", { a: "4", b: "" })).toBe(6_000_000n);
    expect(remainingToAssign("10", { a: "12" })).toBe(-2_000_000n);
    expect(remainingToAssign("ten", { a: "1" })).toBeUndefined();
  });
});
