import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_KINDS,
  assertSettlementAllowed,
  computeBalances,
  isTokenSettlement,
  ledgerEntryDeltas,
  maxSettleable,
} from "./balances";
import { createExpense } from "./split";
import {
  ausd,
  equalExpense,
  expectTallyError,
  makeGroup,
  netMap,
  settlement,
} from "./test-helpers";
import type { LedgerEntry, Settlement, SettlementKind } from "./types";

const group = makeGroup(["alice", "bob", "carol"]);
const sum = (balances: readonly { net: bigint }[]) =>
  balances.reduce((s, b) => s + b.net, 0n);

describe("computeBalances", () => {
  it("returns zero for every member of an empty ledger, in group order", () => {
    expect(computeBalances(group, [])).toEqual([
      { member: "alice", net: 0n },
      { member: "bob", net: 0n },
      { member: "carol", net: 0n },
    ]);
  });

  it.each([
    {
      name: "payer also benefits: their own share is not a debt to themselves",
      participants: ["alice", "bob", "carol"],
      expected: { alice: ausd("20"), bob: -ausd("10"), carol: -ausd("10") },
    },
    {
      name: "payer pays only for others",
      participants: ["bob", "carol"],
      expected: { alice: ausd("30"), bob: -ausd("15"), carol: -ausd("15") },
    },
    {
      name: "payer is the only participant",
      participants: ["alice"],
      expected: { alice: 0n, bob: 0n, carol: 0n },
    },
  ])("$name", ({ participants, expected }) => {
    const balances = computeBalances(group, [
      equalExpense(group, "e1", "alice", ausd("30"), participants),
    ]);
    expect(netMap(balances)).toEqual(expected);
    expect(sum(balances)).toBe(0n);
  });

  it("handles multiple expenses and partial settlements", () => {
    const ledger: LedgerEntry[] = [
      equalExpense(group, "e1", "alice", ausd("30"), ["alice", "bob", "carol"]),
      equalExpense(group, "e2", "bob", ausd("12"), ["alice", "bob", "carol"]),
      {
        kind: "expense",
        expense: createExpense(group, "e3", {
          payer: "carol",
          amount: ausd("9"),
          split: {
            type: "custom",
            shares: [
              { member: "alice", amount: ausd("6") },
              { member: "carol", amount: ausd("3") },
            ],
          },
        }),
      },
    ];
    // alice: +30 -10 -4 -6 = +10; bob: -10 +12 -4 = -2; carol: -10 -4 +9 -3 = -8
    expect(netMap(computeBalances(group, ledger))).toEqual({
      alice: ausd("10"),
      bob: -ausd("2"),
      carol: -ausd("8"),
    });

    ledger.push(settlement(group, "s1", "carol", "alice", ausd("5")));
    expect(netMap(computeBalances(group, ledger))).toEqual({
      alice: ausd("5"),
      bob: -ausd("2"),
      carol: -ausd("3"),
    });

    ledger.push(settlement(group, "s2", "bob", "alice", ausd("2")));
    ledger.push(settlement(group, "s3", "carol", "alice", ausd("3")));
    const final = computeBalances(group, ledger);
    expect(netMap(final)).toEqual({ alice: 0n, bob: 0n, carol: 0n });
  });

  it("conserves the total: net balances always sum to zero", () => {
    const ledger = [
      equalExpense(group, "e1", "alice", 100n, ["alice", "bob", "carol"]),
      equalExpense(group, "e2", "bob", 7n, ["alice", "carol"]),
      equalExpense(group, "e3", "carol", ausd("1000000"), ["bob"]),
      settlement(group, "s1", "bob", "carol", 1n),
    ];
    for (let i = 1; i <= ledger.length; i++) {
      expect(sum(computeBalances(group, ledger.slice(0, i)))).toBe(0n);
    }
  });

  describe("settlement protection", () => {
    const base = [
      equalExpense(group, "e1", "alice", ausd("30"), ["alice", "bob", "carol"]),
    ];

    it("rejects paying more than is owed", () => {
      expectTallyError(
        () =>
          computeBalances(group, [
            ...base,
            settlement(group, "s1", "bob", "alice", ausd("11")),
          ]),
        "SETTLEMENT_EXCEEDS_DEBT",
      );
    });

    it("rejects settling in the wrong direction", () => {
      expectTallyError(
        () =>
          computeBalances(group, [
            ...base,
            settlement(group, "s1", "alice", "bob", 1n),
          ]),
        "SETTLEMENT_EXCEEDS_DEBT",
      );
    });

    it("rejects replaying the same settlement", () => {
      const s = settlement(group, "s1", "bob", "alice", ausd("5"));
      expectTallyError(
        () => computeBalances(group, [...base, s, s]),
        "DUPLICATE_ENTRY",
      );
    });

    it("rejects clearing an already-cleared debt under a new ID", () => {
      expectTallyError(
        () =>
          computeBalances(group, [
            ...base,
            settlement(group, "s1", "bob", "alice", ausd("10")),
            settlement(group, "s2", "bob", "alice", ausd("10")),
          ]),
        "SETTLEMENT_EXCEEDS_DEBT",
      );
    });

    it("validates settlements against balances at that point in history", () => {
      expectTallyError(
        () =>
          computeBalances(group, [
            settlement(group, "s1", "bob", "alice", 1n),
            ...base,
          ]),
        "SETTLEMENT_EXCEEDS_DEBT",
      );
    });

    it.each([
      [settlement(group, "s1", "bob", "bob", 1n), "SELF_SETTLEMENT"],
      [settlement(group, "s1", "bob", "mallory", 1n), "NOT_A_MEMBER"],
      [settlement(group, "s1", "bob", "alice", 0n), "NON_POSITIVE_AMOUNT"],
      [settlement(group, "s1", "bob", "alice", -1n), "NON_POSITIVE_AMOUNT"],
      [settlement(group, "", "bob", "alice", 1n), "INVALID_ID"],
      [
        settlement(makeGroup(["alice", "bob"], "g2"), "s1", "bob", "alice", 1n),
        "WRONG_GROUP",
      ],
    ] as const)("rejects an invalid settlement (%#: %s)", (entry, code) => {
      expectTallyError(() => computeBalances(group, [...base, entry]), code);
    });
  });

  it("rejects duplicate or foreign expenses", () => {
    const e = equalExpense(group, "e1", "alice", 10n, ["bob"]);
    expectTallyError(() => computeBalances(group, [e, e]), "DUPLICATE_ENTRY");
    const other = makeGroup(["alice", "bob"], "g2");
    expectTallyError(
      () =>
        computeBalances(group, [
          equalExpense(other, "e1", "alice", 10n, ["bob"]),
        ]),
      "WRONG_GROUP",
    );
  });

  it("is deterministic for identical input", () => {
    const ledger = [
      equalExpense(group, "e1", "alice", 100n, ["alice", "bob", "carol"]),
      settlement(group, "s1", "bob", "alice", 10n),
    ];
    expect(computeBalances(group, ledger)).toEqual(
      computeBalances(group, ledger),
    );
  });
});

describe("maxSettleable and assertSettlementAllowed", () => {
  const balances = [
    { member: "alice", net: ausd("10") },
    { member: "bob", net: -ausd("4") },
    { member: "carol", net: -ausd("6") },
  ];

  it.each([
    ["bob", "alice", ausd("4")],
    ["carol", "alice", ausd("6")],
    ["alice", "bob", 0n],
    ["bob", "carol", 0n],
    ["bob", "bob", 0n],
    ["bob", "unknown", 0n],
  ])("%s → %s: at most %s", (from, to, expected) => {
    expect(maxSettleable(balances, from, to)).toBe(expected);
  });

  it("allows exactly the outstanding amount and nothing more", () => {
    expect(() =>
      assertSettlementAllowed(group, balances, {
        from: "bob",
        to: "alice",
        amount: ausd("4"),
      }),
    ).not.toThrow();
    expectTallyError(
      () =>
        assertSettlementAllowed(group, balances, {
          from: "bob",
          to: "alice",
          amount: ausd("4") + 1n,
        }),
      "SETTLEMENT_EXCEEDS_DEBT",
    );
  });
});

describe("settlement kinds", () => {
  const base = [
    equalExpense(group, "e1", "alice", ausd("30"), ["alice", "bob", "carol"]),
  ];

  it("token and acknowledged settlements reduce balances identically", () => {
    const viaToken = computeBalances(group, [
      ...base,
      settlement(group, "s1", "bob", "alice", ausd("4"), "token"),
    ]);
    const viaAck = computeBalances(group, [
      ...base,
      settlement(group, "s1", "bob", "alice", ausd("4"), "acknowledged"),
    ]);
    expect(viaToken).toEqual(viaAck);
    expect(netMap(viaToken)).toEqual({
      alice: ausd("16"),
      bob: -ausd("6"),
      carol: -ausd("10"),
    });
  });

  it("applies the same over-payment limit to both kinds combined", () => {
    expectTallyError(
      () =>
        computeBalances(group, [
          ...base,
          settlement(group, "s1", "bob", "alice", ausd("6"), "acknowledged"),
          settlement(group, "s2", "bob", "alice", ausd("5"), "token"),
        ]),
      "SETTLEMENT_EXCEEDS_DEBT",
    );
  });

  it("shares one ID namespace across kinds, like the contract", () => {
    expectTallyError(
      () =>
        computeBalances(group, [
          ...base,
          settlement(group, "s1", "bob", "alice", ausd("1"), "token"),
          settlement(group, "s1", "carol", "alice", ausd("1"), "acknowledged"),
        ]),
      "DUPLICATE_ENTRY",
    );
  });

  it("rejects an unknown kind instead of guessing", () => {
    const entry = settlement(
      group,
      "s1",
      "bob",
      "alice",
      ausd("1"),
      "paid" as unknown as SettlementKind,
    );
    expectTallyError(
      () => computeBalances(group, [...base, entry]),
      "INVALID_SETTLEMENT_KIND",
    );
  });

  it("isTokenSettlement is true only for on-chain token payments", () => {
    const make = (kind: SettlementKind): Settlement => ({
      id: "s",
      groupId: "g1",
      from: "bob",
      to: "alice",
      amount: 1n,
      kind,
    });
    expect(isTokenSettlement(make("token"))).toBe(true);
    expect(isTokenSettlement(make("acknowledged"))).toBe(false);
    expect(SETTLEMENT_KINDS).toEqual(["acknowledged", "token"]);
  });
});

describe("ledgerEntryDeltas", () => {
  it("credits the payer and debits shares, netting the payer's own share", () => {
    const entry = equalExpense(group, "e1", "alice", ausd("30"), [
      "alice",
      "bob",
      "carol",
    ]);
    expect(ledgerEntryDeltas(entry)).toEqual([
      { member: "alice", delta: ausd("20") },
      { member: "bob", delta: -ausd("10") },
      { member: "carol", delta: -ausd("10") },
    ]);
  });

  it("omits a payer who is the only participant", () => {
    const entry = equalExpense(group, "e1", "alice", ausd("30"), ["alice"]);
    expect(ledgerEntryDeltas(entry)).toEqual([]);
  });

  it.each(["acknowledged", "token"] as const)(
    "counts a %s settlement exactly once",
    (kind) => {
      const entry = settlement(group, "s1", "bob", "alice", ausd("4"), kind);
      expect(ledgerEntryDeltas(entry)).toEqual([
        { member: "bob", delta: ausd("4") },
        { member: "alice", delta: -ausd("4") },
      ]);
    },
  );

  it("matches computeBalances when applied incrementally", () => {
    const ledger = [
      equalExpense(group, "e1", "alice", 100n, ["alice", "bob", "carol"]),
      equalExpense(group, "e2", "bob", 7n, ["alice", "carol"]),
      settlement(group, "s1", "carol", "alice", 5n, "token"),
    ];
    const running = new Map<string, bigint>();
    for (const entry of ledger) {
      for (const { member, delta } of ledgerEntryDeltas(entry)) {
        running.set(member, (running.get(member) ?? 0n) + delta);
      }
    }
    expect(netMap(computeBalances(group, ledger))).toEqual({
      alice: running.get("alice") ?? 0n,
      bob: running.get("bob") ?? 0n,
      carol: running.get("carol") ?? 0n,
    });
  });
});
