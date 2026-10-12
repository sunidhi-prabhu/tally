import { describe, expect, it } from "vitest";
import {
  pairwiseDebtCount,
  suggestedTransfers,
  summarize,
  transfersInvolving,
} from "./balances";

describe("summarize", () => {
  it("adds each group's position separately", () => {
    const rows = [
      {
        groupId: "1",
        groupName: "Trip",
        memberCount: 4,
        expenseCount: 3,
        active: true,
        netBalance: -333_333n,
      },
      {
        groupId: "2",
        groupName: "Flat",
        memberCount: 2,
        expenseCount: 1,
        active: true,
        netBalance: 500_000_000n,
      },
    ];
    expect(summarize(rows)).toEqual({
      youOwe: 333_333n,
      owedToYou: 500_000_000n,
      net: 499_666_667n,
    });
  });
});

describe("suggested transfers", () => {
  const members = [
    {
      address: "a",
      active: true,
      netBalance: -40n,
      totalPaid: 0n,
      totalOwedShares: 0n,
    },
    {
      address: "b",
      active: true,
      netBalance: 0n,
      totalPaid: 0n,
      totalOwedShares: 0n,
    },
    {
      address: "c",
      active: true,
      netBalance: 40n,
      totalPaid: 0n,
      totalOwedShares: 0n,
    },
    {
      address: "d",
      active: false,
      netBalance: 0n,
      totalPaid: 0n,
      totalOwedShares: 0n,
    },
  ];
  it("collapses chains using @tally/core and splits by direction", () => {
    const transfers = suggestedTransfers(members);
    expect(transfers).toEqual([{ from: "a", to: "c", amount: 40n }]);
    expect(transfersInvolving(transfers, "A")).toEqual({
      youPay: transfers,
      youReceive: [],
    });
    expect(transfersInvolving(transfers, "c")).toEqual({
      youPay: [],
      youReceive: transfers,
    });
  });
});

describe("pairwiseDebtCount", () => {
  const share = (member: string, amount: bigint) => ({ member, amount });

  it("counts one payment per pair of people with a net debt", () => {
    // a paid for b and c; b paid for c: c owes a and b, b owes a -> 3 pairs.
    expect(
      pairwiseDebtCount(
        [
          {
            payer: "a",
            shares: [share("a", 10n), share("b", 10n), share("c", 10n)],
          },
          { payer: "b", shares: [share("b", 5n), share("c", 5n)] },
        ],
        [],
      ),
    ).toBe(3);
  });

  it("nets debts in both directions between the same two people", () => {
    expect(
      pairwiseDebtCount(
        [
          { payer: "a", shares: [share("b", 10n)] },
          { payer: "b", shares: [share("a", 10n)] },
        ],
        [],
      ),
    ).toBe(0);
  });

  it("removes a pair once it is paid off", () => {
    expect(
      pairwiseDebtCount(
        [{ payer: "a", shares: [share("b", 10n), share("c", 10n)] }],
        [{ debtor: "b", creditor: "a", amount: 10n }],
      ),
    ).toBe(1);
  });

  it("is never fewer than the simplified plan for a cycle", () => {
    // a owes b, b owes c, c owes a, 10 each: everyone nets to zero.
    const expenses = [
      { payer: "b", shares: [share("a", 10n)] },
      { payer: "c", shares: [share("b", 10n)] },
      { payer: "a", shares: [share("c", 10n)] },
    ];
    expect(pairwiseDebtCount(expenses, [])).toBe(3);
  });
});
