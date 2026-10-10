// Property-based checks of the financial invariants over randomly generated inputs.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeBalances, maxSettleable } from "./balances";
import { formatAmount } from "./format";
import { MAX_AMOUNT, parseAmount } from "./money";
import { simplifyDebts } from "./simplify";
import { createExpense, splitEqual } from "./split";
import { settlement } from "./test-helpers";
import type { ExpenseInput, Group, LedgerEntry, NetBalance } from "./types";

const memberIds = fc.uniqueArray(fc.stringMatching(/^[a-z0-9]{1,8}$/), {
  minLength: 1,
  maxLength: 8,
});

/** Reasonable per-expense amounts plus occasional extremes. */
const amount = fc.oneof(
  fc.bigInt({ min: 1n, max: 10_000_000_000n }),
  fc.bigInt({ min: 1n, max: MAX_AMOUNT }),
);

/** Splits `total` into `count` non-negative parts using random cut points. */
function partsOf(total: bigint, count: number) {
  return fc
    .array(fc.bigInt({ min: 0n, max: total }), {
      minLength: count - 1,
      maxLength: count - 1,
    })
    .map((cuts) => {
      const points = [
        0n,
        ...cuts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        total,
      ];
      return points.slice(1).map((p, i) => p - points[i]!);
    });
}

/** A group plus a random, valid list of expenses (equal and custom splits). */
const groupWithExpenses = memberIds.chain((members) => {
  const group: Group = { id: "g", name: "g", members };
  const expense = fc
    .record({
      payer: fc.constantFrom(...members),
      participants: fc.subarray(members, { minLength: 1 }),
      amount,
      custom: fc.boolean(),
    })
    .chain(
      ({
        payer,
        participants,
        amount: total,
        custom,
      }): fc.Arbitrary<ExpenseInput> =>
        custom
          ? partsOf(total, participants.length).map((parts) => ({
              payer,
              amount: total,
              split: {
                type: "custom" as const,
                shares: participants.map((member, i) => ({
                  member,
                  amount: parts[i]!,
                })),
              },
            }))
          : fc.constant({
              payer,
              amount: total,
              split: { type: "equal" as const, participants },
            }),
    );
  return fc.array(expense, { maxLength: 12 }).map((inputs) => ({
    group,
    entries: inputs.map((input, i): LedgerEntry => ({
      kind: "expense",
      expense: createExpense(group, `e${i}`, input),
    })),
  }));
});

const total = (balances: readonly NetBalance[]) =>
  balances.reduce((s, b) => s + b.net, 0n);

describe("financial invariants (property-based)", () => {
  it("equal splits allocate every unit, differ by at most one unit, and ignore order", () => {
    fc.assert(
      fc.property(amount, memberIds, (value, members) => {
        const shares = splitEqual(value, members);
        const amounts = shares.map((s) => s.amount);
        expect(amounts.reduce((a, b) => a + b, 0n)).toBe(value);
        const max = amounts.reduce((a, b) => (a > b ? a : b));
        const min = amounts.reduce((a, b) => (a < b ? a : b));
        expect(max - min <= 1n).toBe(true);

        const reversed = splitEqual(value, [...members].reverse());
        const lookup = new Map(reversed.map((s) => [s.member, s.amount]));
        for (const s of shares) expect(lookup.get(s.member)).toBe(s.amount);
      }),
    );
  });

  it("net balances sum to zero and equal paid minus owed", () => {
    fc.assert(
      fc.property(groupWithExpenses, ({ group, entries }) => {
        const balances = computeBalances(group, entries);
        expect(total(balances)).toBe(0n);

        const expected = new Map(group.members.map((m) => [m, 0n]));
        for (const entry of entries) {
          if (entry.kind !== "expense") continue;
          const { payer, amount: paid, shares } = entry.expense;
          expected.set(payer, expected.get(payer)! + paid);
          for (const s of shares)
            expected.set(s.member, expected.get(s.member)! - s.amount);
        }
        for (const b of balances) expect(b.net).toBe(expected.get(b.member));
      }),
    );
  });

  it("a valid settlement reduces both sides exactly, and over-paying is always rejected", () => {
    fc.assert(
      fc.property(
        groupWithExpenses,
        fc.nat(),
        fc.nat(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        ({ group, entries }, i, j, fraction) => {
          const before = computeBalances(group, entries);
          const debtors = before.filter((b) => b.net < 0n);
          const creditors = before.filter((b) => b.net > 0n);
          if (debtors.length === 0) return;
          const from = debtors[i % debtors.length]!.member;
          const to = creditors[j % creditors.length]!.member;
          // Accumulated debts can exceed MAX_AMOUNT; a single settlement cannot.
          const outstanding = maxSettleable(before, from, to);
          const max = outstanding < MAX_AMOUNT ? outstanding : MAX_AMOUNT;
          const pay =
            1n +
            ((max - 1n) * BigInt(Math.floor(fraction * 1_000_000))) /
              1_000_000n;

          const after = computeBalances(group, [
            ...entries,
            settlement(group, "s1", from, to, pay),
          ]);
          const net = (list: NetBalance[], m: string) =>
            list.find((b) => b.member === m)!.net;
          expect(net(after, from)).toBe(net(before, from) + pay);
          expect(net(after, to)).toBe(net(before, to) - pay);
          expect(total(after)).toBe(0n);

          const remaining = maxSettleable(after, from, to);
          expect(() =>
            computeBalances(group, [
              ...entries,
              settlement(group, "s1", from, to, pay),
              settlement(group, "s2", from, to, remaining + 1n),
            ]),
          ).toThrow();
        },
      ),
    );
  });

  it("simplified transfers settle everyone exactly with valid, minimal-count-bounded payments", () => {
    fc.assert(
      fc.property(groupWithExpenses, ({ group, entries }) => {
        const balances = computeBalances(group, entries);
        const transfers = simplifyDebts(balances);

        const applied = new Map(group.members.map((m) => [m, 0n]));
        for (const t of transfers) {
          expect(t.amount > 0n).toBe(true);
          expect(t.from).not.toBe(t.to);
          applied.set(t.from, applied.get(t.from)! - t.amount);
          applied.set(t.to, applied.get(t.to)! + t.amount);
        }
        for (const b of balances) {
          expect(applied.get(b.member)).toBe(b.net);
          // Debtors only pay; creditors only receive.
          if (b.net < 0n)
            expect(transfers.some((t) => t.to === b.member)).toBe(false);
          if (b.net > 0n)
            expect(transfers.some((t) => t.from === b.member)).toBe(false);
        }
        const nonZero = balances.filter((b) => b.net !== 0n).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));

        expect(simplifyDebts([...balances].reverse())).toEqual(transfers);
      }),
    );
  });

  it("formatting round-trips through parsing for any valid amount", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_AMOUNT }), (units) => {
        expect(parseAmount(formatAmount(units))).toBe(units);
      }),
    );
  });
});
