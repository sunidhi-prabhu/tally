import { describe, expect, it } from "vitest";
import { computeBalances } from "./balances";
import { simplifyDebts } from "./simplify";
import {
  ausd,
  equalExpense,
  expectTallyError,
  makeGroup,
} from "./test-helpers";
import type { NetBalance, Transfer } from "./types";

const balances = (nets: Record<string, bigint>): NetBalance[] =>
  Object.entries(nets).map(([member, net]) => ({ member, net }));

/** Applies transfers to zeroed balances; result must equal the original nets. */
function netsFromTransfers(
  transfers: readonly Transfer[],
): Record<string, bigint> {
  const result: Record<string, bigint> = {};
  for (const t of transfers) {
    result[t.from] = (result[t.from] ?? 0n) - t.amount;
    result[t.to] = (result[t.to] ?? 0n) + t.amount;
  }
  return result;
}

function expectPreserves(
  input: NetBalance[],
  transfers: readonly Transfer[],
): void {
  const applied = netsFromTransfers(transfers);
  for (const { member, net } of input) {
    expect(applied[member] ?? 0n).toBe(net);
  }
  for (const t of transfers) {
    expect(t.amount > 0n).toBe(true);
    expect(t.from).not.toBe(t.to);
  }
}

describe("simplifyDebts", () => {
  it("collapses a chain: Alice owes Bob 40, Bob owes Charlie 40 → Alice pays Charlie 40", () => {
    const group = makeGroup(["alice", "bob", "charlie"]);
    const nets = computeBalances(group, [
      equalExpense(group, "e1", "bob", ausd("40"), ["alice"]),
      equalExpense(group, "e2", "charlie", ausd("40"), ["bob"]),
    ]);
    expect(simplifyDebts(nets)).toEqual([
      { from: "alice", to: "charlie", amount: ausd("40") },
    ]);
  });

  it("cancels a perfect cycle entirely", () => {
    const group = makeGroup(["a", "b", "c"]);
    const nets = computeBalances(group, [
      equalExpense(group, "e1", "b", 10n, ["a"]),
      equalExpense(group, "e2", "c", 10n, ["b"]),
      equalExpense(group, "e3", "a", 10n, ["c"]),
    ]);
    expect(simplifyDebts(nets)).toEqual([]);
  });

  it("reduces an uneven cycle to two payments", () => {
    // A owes B 30, B owes C 20, C owes A 10 → A: -20, B: +10, C: +10
    const group = makeGroup(["a", "b", "c"]);
    const nets = computeBalances(group, [
      equalExpense(group, "e1", "b", 30n, ["a"]),
      equalExpense(group, "e2", "c", 20n, ["b"]),
      equalExpense(group, "e3", "a", 10n, ["c"]),
    ]);
    const transfers = simplifyDebts(nets);
    expect(transfers).toEqual([
      { from: "a", to: "b", amount: 10n },
      { from: "a", to: "c", amount: 10n },
    ]);
    expectPreserves(nets, transfers);
  });

  it.each([
    ["no members", {}, []],
    ["all settled", { a: 0n, b: 0n }, []],
    ["one pair", { a: -5n, b: 5n }, [{ from: "a", to: "b", amount: 5n }]],
    [
      "one debtor, many creditors",
      { a: -60n, b: 10n, c: 20n, d: 30n },
      [
        { from: "a", to: "d", amount: 30n },
        { from: "a", to: "c", amount: 20n },
        { from: "a", to: "b", amount: 10n },
      ],
    ],
    [
      "largest debtor pays largest creditor first",
      { a: -70n, b: -30n, c: 50n, d: 50n },
      [
        { from: "a", to: "c", amount: 50n },
        { from: "b", to: "d", amount: 30n },
        { from: "a", to: "d", amount: 20n },
      ],
    ],
  ])("%s", (_name, nets, expected) => {
    const input = balances(nets);
    const transfers = simplifyDebts(input);
    expect(transfers).toEqual(expected);
    expectPreserves(input, transfers);
  });

  it("uses at most k - 1 transfers for k non-zero balances", () => {
    const input = balances({
      a: -1n,
      b: -2n,
      c: -3n,
      d: -4n,
      e: 4n,
      f: 6n,
      z: 0n,
    });
    const transfers = simplifyDebts(input);
    expect(transfers.length).toBeLessThanOrEqual(5);
    expectPreserves(input, transfers);
  });

  it("is greedy, not globally optimal (documented counterexample)", () => {
    const input = balances({ A: 6n, B: 5n, C: -5n, D: -4n, E: -2n });
    const transfers = simplifyDebts(input);
    // Optimal is 3 (C→B 5, D→A 4, E→A 2); the greedy result uses 4.
    expect(transfers).toHaveLength(4);
    expectPreserves(input, transfers);
  });

  it("handles large valid amounts", () => {
    const big = ausd("1000000000000");
    const input = balances({ a: -big, b: -big, c: big * 2n });
    const transfers = simplifyDebts(input);
    expect(transfers).toEqual([
      { from: "a", to: "c", amount: big },
      { from: "b", to: "c", amount: big },
    ]);
  });

  it("is deterministic and independent of input order", () => {
    const input = balances({ d: -3n, a: -3n, c: 3n, b: 3n });
    const expected = simplifyDebts(input);
    expect(simplifyDebts(input)).toEqual(expected);
    expect(simplifyDebts([...input].reverse())).toEqual(expected);
    expect(expected).toEqual([
      { from: "a", to: "b", amount: 3n },
      { from: "d", to: "c", amount: 3n },
    ]);
  });

  it.each([
    [balances({ a: -5n, b: 4n }), "UNBALANCED"],
    [
      [
        { member: "a", net: -1n },
        { member: "a", net: 1n },
      ],
      "DUPLICATE_MEMBER",
    ],
    [[{ member: "", net: 0n }], "INVALID_MEMBER_ID"],
    [[{ member: "a", net: 1 as unknown as bigint }], "INVALID_AMOUNT"],
  ] as const)("rejects invalid balances (%#: %s)", (input, code) => {
    expectTallyError(() => simplifyDebts(input), code);
  });
});
