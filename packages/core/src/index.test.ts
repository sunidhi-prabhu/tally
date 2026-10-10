import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("@tally/core entry point", () => {
  it("exports the app name", () => {
    expect(core.APP_NAME).toBe("Tally");
  });

  it("exposes the public API end to end", () => {
    const group = {
      id: "g1",
      name: "Trip",
      members: ["alice", "bob", "charlie"],
    };
    const amount = core.parseAmount("40");
    const e1 = core.createExpense(group, "e1", {
      payer: "bob",
      amount,
      split: { type: "equal", participants: ["alice"] },
    });
    const e2 = core.createExpense(group, "e2", {
      payer: "charlie",
      amount,
      split: { type: "equal", participants: ["bob"] },
    });
    const balances = core.computeBalances(group, [
      { kind: "expense", expense: e1 },
      { kind: "expense", expense: e2 },
    ]);
    const transfers = core.simplifyDebts(balances);
    expect(
      transfers.map((t) => `${t.from}→${t.to} ${core.formatAmount(t.amount)}`),
    ).toEqual(["alice→charlie 40.00"]);
  });
});
