import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { MAX_AMOUNT } from "./money";
import {
  MAX_DESCRIPTION_LENGTH,
  decimalAmountSchema,
  expenseInputSchema,
  expenseInputSchemaFor,
  settlementInputSchema,
  settlementInputSchemaFor,
  settlementKindSchema,
} from "./schemas";
import { createExpense } from "./split";
import { ausd, makeGroup } from "./test-helpers";

const group = makeGroup(["alice", "bob", "carol"]);

function issues(result: z.ZodSafeParseResult<unknown>) {
  return result.success
    ? []
    : result.error.issues.map((i) => ({ path: i.path, message: i.message }));
}

const validEqual = {
  payer: "alice",
  amount: ausd("30"),
  split: { type: "equal", participants: ["alice", "bob", "carol"] },
  description: "  Dinner  ",
};

describe("decimalAmountSchema", () => {
  const schema = decimalAmountSchema();

  it("parses form input into base units", () => {
    expect(schema.parse("12.5")).toBe(12_500_000n);
    expect(schema.parse("0.000001")).toBe(1n);
  });

  it.each([
    ["0", "greater than zero"],
    ["0.000", "greater than zero"],
    ["1.1234567", "more than 6 decimal places"],
    ["abc", "Not a valid amount"],
    ["-1", "Not a valid amount"],
    ["1000000000001", "exceeds the maximum"],
  ])("rejects %j", (input, message) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    expect(issues(result)[0]?.message).toContain(message);
  });

  it("rejects non-strings", () => {
    expect(schema.safeParse(12.5).success).toBe(false);
  });
});

describe("expenseInputSchema", () => {
  it("accepts a valid equal split and trims the description", () => {
    const parsed = expenseInputSchema.parse(validEqual);
    expect(parsed.description).toBe("Dinner");
    expect(parsed.amount).toBe(ausd("30"));
  });

  it("defaults a missing description to an empty string", () => {
    const rest = { ...validEqual, description: undefined };
    expect(expenseInputSchema.parse(rest).description).toBe("");
  });

  it("accepts a valid custom split", () => {
    const result = expenseInputSchema.safeParse({
      payer: "alice",
      amount: 10n,
      split: {
        type: "custom",
        shares: [
          { member: "alice", amount: 0n },
          { member: "bob", amount: 10n },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["zero amount", { ...validEqual, amount: 0n }, ["amount"]],
    ["negative amount", { ...validEqual, amount: -1n }, ["amount"]],
    [
      "amount above maximum",
      { ...validEqual, amount: MAX_AMOUNT + 1n },
      ["amount"],
    ],
    ["number instead of bigint", { ...validEqual, amount: 30 }, ["amount"]],
    ["string amount", { ...validEqual, amount: "30" }, ["amount"]],
    ["invalid payer ID", { ...validEqual, payer: "" }, ["payer"]],
    [
      "duplicate participants",
      {
        ...validEqual,
        split: { type: "equal", participants: ["alice", "bob", "alice"] },
      },
      ["split", "participants", 2],
    ],
    [
      "no participants",
      { ...validEqual, split: { type: "equal", participants: [] } },
      ["split", "participants"],
    ],
    [
      "custom shares not matching the total",
      {
        ...validEqual,
        amount: 10n,
        split: { type: "custom", shares: [{ member: "alice", amount: 9n }] },
      },
      ["split", "shares"],
    ],
    [
      "negative custom share",
      {
        ...validEqual,
        amount: 10n,
        split: {
          type: "custom",
          shares: [
            { member: "alice", amount: 15n },
            { member: "bob", amount: -5n },
          ],
        },
      },
      ["split", "shares", 1, "amount"],
    ],
    [
      "unknown split type",
      { ...validEqual, split: { type: "percent", participants: ["alice"] } },
      ["split", "type"],
    ],
    [
      "description too long",
      { ...validEqual, description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) },
      ["description"],
    ],
  ])("rejects %s", (_name, input, path) => {
    const result = expenseInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(issues(result).map((i) => i.path)).toContainEqual(path);
  });

  it("produces input that createExpense accepts", () => {
    const parsed = expenseInputSchemaFor(group).parse(validEqual);
    const expense = createExpense(group, "e1", parsed);
    expect(expense.shares.reduce((s, x) => s + x.amount, 0n)).toBe(
      expense.amount,
    );
  });
});

describe("expenseInputSchemaFor(group)", () => {
  const schema = expenseInputSchemaFor(group);

  it("rejects a payer outside the group", () => {
    const result = schema.safeParse({ ...validEqual, payer: "mallory" });
    expect(issues(result)).toContainEqual({
      path: ["payer"],
      message: "Payer is not a group member",
    });
  });

  it("rejects participants outside the group with their index", () => {
    const result = schema.safeParse({
      ...validEqual,
      split: { type: "equal", participants: ["alice", "mallory"] },
    });
    expect(issues(result).map((i) => i.path)).toContainEqual([
      "split",
      "participants",
      1,
    ]);
  });
});

describe("settlementInputSchema", () => {
  it("accepts a valid settlement", () => {
    expect(
      settlementInputSchema.parse({ from: "bob", to: "alice", amount: 5n }),
    ).toEqual({
      from: "bob",
      to: "alice",
      amount: 5n,
    });
  });

  it.each([
    ["self payment", { from: "bob", to: "bob", amount: 5n }, ["to"]],
    ["zero amount", { from: "bob", to: "alice", amount: 0n }, ["amount"]],
    ["negative amount", { from: "bob", to: "alice", amount: -5n }, ["amount"]],
    ["missing recipient", { from: "bob", amount: 5n }, ["to"]],
  ])("rejects %s", (_name, input, path) => {
    const result = settlementInputSchema.safeParse(input);
    expect(issues(result).map((i) => i.path)).toContainEqual(path);
  });

  it("checks membership when scoped to a group", () => {
    const result = settlementInputSchemaFor(group).safeParse({
      from: "mallory",
      to: "eve",
      amount: 5n,
    });
    expect(issues(result).map((i) => i.path)).toEqual([["from"], ["to"]]);
  });
});

describe("settlementKindSchema", () => {
  it.each(["acknowledged", "token"])("accepts %j", (kind) => {
    expect(settlementKindSchema.parse(kind)).toBe(kind);
  });

  it.each(["paid", "", "TOKEN", 1, null])("rejects %j", (kind) => {
    expect(settlementKindSchema.safeParse(kind).success).toBe(false);
  });
});
