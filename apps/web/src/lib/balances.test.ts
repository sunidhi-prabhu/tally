import { describe, expect, it } from "vitest";
import { suggestedTransfers, summarize, transfersInvolving } from "./balances";

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
