import { describe, expect, it } from "vitest";
import { MAX_AMOUNT } from "./money";
import {
  assertValidExpense,
  createExpense,
  splitCustom,
  splitEqual,
} from "./split";
import { ausd, expectTallyError, makeGroup } from "./test-helpers";
import type { ParticipantShare } from "./types";

const total = (shares: readonly ParticipantShare[]) =>
  shares.reduce((s, x) => s + x.amount, 0n);
const byMember = (shares: readonly ParticipantShare[]) =>
  Object.fromEntries(shares.map((s) => [s.member, s.amount]));

describe("splitEqual", () => {
  it("splits divisible amounts exactly", () => {
    expect(splitEqual(ausd("90"), ["alice", "bob", "carol"])).toEqual([
      { member: "alice", amount: ausd("30") },
      { member: "bob", amount: ausd("30") },
      { member: "carol", amount: ausd("30") },
    ]);
  });

  it("gives leftover units to the lowest member IDs, keeping input order", () => {
    expect(splitEqual(100n, ["bob", "alice", "carol"])).toEqual([
      { member: "bob", amount: 33n },
      { member: "alice", amount: 34n },
      { member: "carol", amount: 33n },
    ]);
    expect(byMember(splitEqual(ausd("10"), ["carol", "bob", "alice"]))).toEqual(
      {
        alice: 3_333_334n,
        bob: 3_333_333n,
        carol: 3_333_333n,
      },
    );
  });

  it.each([
    [100n, 3],
    [101n, 3],
    [1n, 7],
    [ausd("10"), 3],
    [ausd("0.05"), 6],
    [MAX_AMOUNT, 7],
    [MAX_AMOUNT - 1n, 1000],
  ])("allocates every unit of %s across %s participants", (amount, n) => {
    const members = Array.from({ length: n }, (_, i) => `m${i}`);
    const shares = splitEqual(amount, members);
    expect(shares).toHaveLength(n);
    expect(total(shares)).toBe(amount);
    const amounts = shares.map((s) => s.amount);
    const max = amounts.reduce((a, b) => (a > b ? a : b));
    const min = amounts.reduce((a, b) => (a < b ? a : b));
    expect(max - min <= 1n).toBe(true);
  });

  it("does not depend on participant order", () => {
    const a = splitEqual(ausd("10"), ["alice", "bob", "carol"]);
    const b = splitEqual(ausd("10"), ["carol", "alice", "bob"]);
    expect(byMember(a)).toEqual(byMember(b));
  });

  it("gives zero shares when the amount is smaller than the participant count", () => {
    expect(byMember(splitEqual(2n, ["c", "b", "a"]))).toEqual({
      a: 1n,
      b: 1n,
      c: 0n,
    });
  });

  it("gives a single participant the whole amount", () => {
    expect(splitEqual(ausd("12.34"), ["alice"])).toEqual([
      { member: "alice", amount: ausd("12.34") },
    ]);
  });

  it("is deterministic for identical input", () => {
    const members = ["dave", "alice", "carol", "bob"];
    expect(splitEqual(1_000_003n, members)).toEqual(
      splitEqual(1_000_003n, members),
    );
  });

  it.each([
    [0n, ["a"], "NON_POSITIVE_AMOUNT"],
    [-5n, ["a"], "NON_POSITIVE_AMOUNT"],
    [MAX_AMOUNT + 1n, ["a"], "AMOUNT_TOO_LARGE"],
    [10n, [], "EMPTY_PARTICIPANTS"],
    [10n, ["a", "b", "a"], "DUPLICATE_PARTICIPANT"],
    [10n, [""], "INVALID_MEMBER_ID"],
    [10n, ["has space"], "INVALID_MEMBER_ID"],
  ] as const)(
    "rejects amount %s with participants %j (%s)",
    (amount, participants, code) => {
      expectTallyError(() => splitEqual(amount, participants), code);
    },
  );
});

describe("splitCustom", () => {
  it("accepts shares that add up to the amount, including zero shares", () => {
    const shares = [
      { member: "alice", amount: ausd("7.5") },
      { member: "bob", amount: ausd("2.5") },
      { member: "carol", amount: 0n },
    ];
    const result = splitCustom(ausd("10"), shares);
    expect(result).toEqual(shares);
    expect(result).not.toBe(shares);
  });

  it.each([
    ["less than the amount", [ausd("4"), ausd("5")]],
    ["more than the amount", [ausd("6"), ausd("5")]],
    ["off by one unit", [ausd("5"), ausd("5") - 1n]],
  ])("rejects shares that add up to %s", (_label, [a, b]) => {
    expectTallyError(
      () =>
        splitCustom(ausd("10"), [
          { member: "alice", amount: a! },
          { member: "bob", amount: b! },
        ]),
      "SPLIT_TOTAL_MISMATCH",
    );
  });

  it("rejects negative shares even when the total matches", () => {
    expectTallyError(
      () =>
        splitCustom(ausd("10"), [
          { member: "alice", amount: ausd("15") },
          { member: "bob", amount: -ausd("5") },
        ]),
      "NEGATIVE_AMOUNT",
    );
  });

  it("rejects duplicate participants", () => {
    expectTallyError(
      () =>
        splitCustom(10n, [
          { member: "alice", amount: 5n },
          { member: "alice", amount: 5n },
        ]),
      "DUPLICATE_PARTICIPANT",
    );
  });

  it("rejects empty shares and non-positive amounts", () => {
    expectTallyError(() => splitCustom(10n, []), "EMPTY_PARTICIPANTS");
    expectTallyError(
      () => splitCustom(0n, [{ member: "a", amount: 0n }]),
      "NON_POSITIVE_AMOUNT",
    );
  });
});

describe("createExpense", () => {
  const group = makeGroup(["alice", "bob", "carol"]);

  it("builds an equal-split expense where the payer also benefits", () => {
    const expense = createExpense(group, "e1", {
      payer: "alice",
      amount: ausd("30"),
      split: { type: "equal", participants: ["alice", "bob", "carol"] },
      description: "Dinner",
    });
    expect(expense).toEqual({
      id: "e1",
      groupId: "g1",
      payer: "alice",
      amount: ausd("30"),
      shares: [
        { member: "alice", amount: ausd("10") },
        { member: "bob", amount: ausd("10") },
        { member: "carol", amount: ausd("10") },
      ],
      description: "Dinner",
    });
  });

  it("allows a payer who does not participate, and defaults the description", () => {
    const expense = createExpense(group, "e2", {
      payer: "alice",
      amount: ausd("20"),
      split: {
        type: "custom",
        shares: [{ member: "bob", amount: ausd("20") }],
      },
    });
    expect(expense.shares).toEqual([{ member: "bob", amount: ausd("20") }]);
    expect(expense.description).toBe("");
  });

  it("rejects a payer outside the group", () => {
    expectTallyError(
      () =>
        createExpense(group, "e", {
          payer: "mallory",
          amount: 10n,
          split: { type: "equal", participants: ["alice"] },
        }),
      "NOT_A_MEMBER",
    );
  });

  it.each([
    { type: "equal", participants: ["alice", "mallory"] },
    { type: "custom", shares: [{ member: "mallory", amount: 10n }] },
  ] as const)("rejects participants outside the group (%o)", (split) => {
    expectTallyError(
      () => createExpense(group, "e", { payer: "alice", amount: 10n, split }),
      "NOT_A_MEMBER",
    );
  });

  it("rejects an invalid group or expense ID", () => {
    const input = {
      payer: "alice",
      amount: 10n,
      split: { type: "equal", participants: ["alice"] },
    } as const;
    expectTallyError(() => createExpense(group, "", input), "INVALID_ID");
    expectTallyError(
      () => createExpense(makeGroup(["alice", "alice"]), "e", input),
      "DUPLICATE_MEMBER",
    );
    expectTallyError(
      () => createExpense(makeGroup([]), "e", input),
      "EMPTY_PARTICIPANTS",
    );
  });
});

describe("assertValidExpense", () => {
  const group = makeGroup(["alice", "bob"]);
  const expense = createExpense(group, "e1", {
    payer: "alice",
    amount: 10n,
    split: { type: "equal", participants: ["alice", "bob"] },
  });

  it("accepts a valid expense", () => {
    expect(() => assertValidExpense(group, expense)).not.toThrow();
  });

  it("rejects tampered or foreign expenses", () => {
    expectTallyError(
      () => assertValidExpense(group, { ...expense, groupId: "other" }),
      "WRONG_GROUP",
    );
    expectTallyError(
      () => assertValidExpense(group, { ...expense, amount: 11n }),
      "SPLIT_TOTAL_MISMATCH",
    );
    expectTallyError(
      () => assertValidExpense(group, { ...expense, payer: "eve" }),
      "NOT_A_MEMBER",
    );
  });
});
