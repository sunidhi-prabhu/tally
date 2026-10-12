// Replays simulated TallyLedger events through Envio's test indexer and checks the read model.
// Event params mirror what the contract emits (lowercase addresses, as configured).
import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import {
  computeBalances,
  type Group as CoreGroup,
  type LedgerEntry,
} from "../src/core";

const CHAIN = 31337;
type Address = `0x${string}`;
const addr = (hex: string): Address => `0x${hex.padStart(40, "0")}`;
// Numeric (and lowercase-string) order: BOB < DAVE < ALICE < CAROL.
const ALICE = addr("a11ce");
const BOB = addr("b0b");
const CAROL = addr("ca401");
const DAVE = addr("da7e");
const TOKEN = addr("70ce");
const AUSD = 1_000_000n;

const id32 = (label: string): Address =>
  `0x${Buffer.from(label).toString("hex").padEnd(64, "0")}`;
const tx = (n: number): Address => `0x${n.toString(16).padStart(64, "0")}`;

type ChainConfig = NonNullable<
  Parameters<
    ReturnType<typeof createTestIndexer>["process"]
  >[0]["chains"][typeof CHAIN]
>;
type SimItem = NonNullable<ChainConfig["simulate"]>[number];

/** Places an event at a block / transaction / log position, like a real receipt. */
function at(block: number, logIndex: number, item: SimItem): SimItem {
  return {
    ...item,
    logIndex,
    block: {
      number: block,
      timestamp: 1_700_000_000 + block,
      hash: tx(block * 1000),
    },
    transaction: { hash: tx(block) },
  } as SimItem;
}

const groupCreated = (groupId: bigint, admin: Address, name: string): SimItem =>
  ({
    contract: "TallyLedger",
    event: "GroupCreated",
    params: { groupId, admin, name },
  }) as SimItem;
const memberAdded = (
  groupId: bigint,
  member: Address,
  addedBy: Address,
): SimItem =>
  ({
    contract: "TallyLedger",
    event: "MemberAdded",
    params: { groupId, member, addedBy },
  }) as SimItem;
const memberRemoved = (
  groupId: bigint,
  member: Address,
  removedBy: Address,
): SimItem =>
  ({
    contract: "TallyLedger",
    event: "MemberRemoved",
    params: { groupId, member, removedBy },
  }) as SimItem;
const expenseRecorded = (
  groupId: bigint,
  label: string,
  payer: Address,
  amount: bigint,
  splitType: 0n | 1n,
  participants: Address[],
  shares: bigint[],
): SimItem =>
  ({
    contract: "TallyLedger",
    event: "ExpenseRecorded",
    params: {
      groupId,
      expenseId: id32(label),
      payer,
      amount,
      splitType,
      participants,
      shares,
      description: label,
    },
  }) as SimItem;
const expenseUndone = (
  groupId: bigint,
  label: string,
  undoneBy: Address,
): SimItem =>
  ({
    contract: "TallyLedger",
    event: "ExpenseUndone",
    params: { groupId, expenseId: id32(label), undoneBy },
  }) as SimItem;
const settlementRecorded = (
  groupId: bigint,
  label: string,
  from: Address,
  to: Address,
  amount: bigint,
  kind: 1n | 2n,
): SimItem =>
  ({
    contract: "TallyLedger",
    event: "SettlementRecorded",
    params: { groupId, settlementId: id32(label), from, to, amount, kind },
  }) as SimItem;
const tokenSettled = (
  groupId: bigint,
  label: string,
  from: Address,
  to: Address,
  amount: bigint,
): SimItem =>
  ({
    contract: "TallyLedger",
    event: "TokenSettled",
    params: {
      groupId,
      settlementId: id32(label),
      from,
      to,
      token: TOKEN,
      amount,
    },
  }) as SimItem;

/** Group 1 with ALICE (admin), BOB, CAROL, DAVE, created in a single transaction at block 1. */
const createTrip = (): SimItem[] => [
  at(1, 0, groupCreated(1n, ALICE, "Trip")),
  at(1, 1, memberAdded(1n, ALICE, ALICE)),
  at(1, 2, memberAdded(1n, BOB, ALICE)),
  at(1, 3, memberAdded(1n, CAROL, ALICE)),
  at(1, 4, memberAdded(1n, DAVE, ALICE)),
];

async function run(simulate: SimItem[]) {
  const indexer = createTestIndexer();
  await indexer.process({ chains: { [CHAIN]: { simulate } } });
  return indexer;
}

async function nets(
  indexer: ReturnType<typeof createTestIndexer>,
  groupId: bigint,
) {
  const rows = (await indexer.Membership.getAll()).filter(
    (m) => m.group_id === groupId.toString(),
  );
  return Object.fromEntries(rows.map((m) => [m.address, m.netBalance]));
}

/**
 * Rebuilds the group's ledger from indexed Expense/ExpenseShare/Settlement rows in on-chain order
 * and recomputes balances with @tally/core, independently of the handlers' incremental updates.
 */
async function reconstruct(
  indexer: ReturnType<typeof createTestIndexer>,
  groupId: bigint,
) {
  const gid = groupId.toString();
  const memberships = (await indexer.Membership.getAll()).filter(
    (m) => m.group_id === gid,
  );
  const shares = (await indexer.ExpenseShare.getAll()).filter(
    (s) => s.group_id === gid,
  );
  const expenses = (await indexer.Expense.getAll()).filter(
    (e) => e.group_id === gid,
  );
  const settlements = (await indexer.Settlement.getAll()).filter(
    (s) => s.group_id === gid,
  );
  const undos = (await indexer.GroupActivity.getAll()).filter(
    (a) => a.group_id === gid && a.activityType === "EXPENSE_UNDONE",
  );
  const coreExpense = (e: (typeof expenses)[number]) => ({
    id: e.id,
    groupId: gid,
    payer: e.payer,
    amount: e.amount,
    description: e.description,
    shares: shares
      .filter((s) => s.expense_id === e.id)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ member: s.member, amount: s.amount })),
  });

  const ordered: { block: number; log: number; entry: LedgerEntry }[] = [
    ...expenses.map((e) => ({
      block: e.blockNumber,
      log: e.logIndex,
      entry: { kind: "expense" as const, expense: coreExpense(e) },
    })),
    ...undos.map((a) => ({
      block: a.blockNumber,
      log: a.logIndex,
      entry: {
        kind: "expenseUndone" as const,
        expense: coreExpense(expenses.find((e) => e.id === a.expense_id)!),
      },
    })),
    ...settlements.map((s) => ({
      block: s.blockNumber,
      log: s.logIndex,
      entry: {
        kind: "settlement" as const,
        settlement: {
          id: s.id,
          groupId: gid,
          from: s.debtor,
          to: s.creditor,
          amount: s.amount,
          kind:
            s.kind === "TOKEN_TRANSFER"
              ? ("token" as const)
              : ("acknowledged" as const),
        },
      },
    })),
  ].sort((a, b) => a.block - b.block || a.log - b.log);

  const group: CoreGroup = {
    id: gid,
    name: "",
    members: memberships.map((m) => m.address),
  };
  return Object.fromEntries(
    computeBalances(
      group,
      ordered.map((o) => o.entry),
    ).map((b) => [b.member, b.net]),
  );
}

describe("groups and membership", () => {
  it("indexes a group and its members emitted in one transaction, in log order", async () => {
    const indexer = await run(createTrip());

    const group = await indexer.Group.getOrThrow("1");
    expect(group).toMatchObject({
      groupId: 1n,
      name: "Trip",
      admin: ALICE,
      memberCount: 4,
      activityCount: 5,
      createdAtBlock: 1,
      createdTxHash: tx(1),
    });
    const activity = (await indexer.GroupActivity.getAll()).sort(
      (a, b) => a.sequence - b.sequence,
    );
    expect(
      activity.map((a) => [a.sequence, a.logIndex, a.activityType, a.member]),
    ).toEqual([
      [1, 0, "GROUP_CREATED", undefined],
      [2, 1, "MEMBER_ADDED", ALICE],
      [3, 2, "MEMBER_ADDED", BOB],
      [4, 3, "MEMBER_ADDED", CAROL],
      [5, 4, "MEMBER_ADDED", DAVE],
    ]);
    expect(activity.every((a) => a.txHash === tx(1))).toBe(true);
    expect((await indexer.Account.getAll()).map((a) => a.id).sort()).toEqual(
      [ALICE, BOB, CAROL, DAVE].sort(),
    );
  });

  it("deactivates removed members and reactivates them when re-added", async () => {
    const indexer = await run([
      ...createTrip(),
      at(2, 0, memberRemoved(1n, DAVE, ALICE)),
      at(3, 0, memberAdded(1n, DAVE, ALICE)),
      at(4, 0, memberRemoved(1n, DAVE, DAVE)),
    ]);
    const dave = await indexer.Membership.getOrThrow(`1-${DAVE}`);
    expect(dave).toMatchObject({
      active: false,
      leftAtBlock: 4,
      netBalance: 0n,
    });
    expect((await indexer.Group.getOrThrow("1")).memberCount).toBe(3);
  });
});

describe("expenses", () => {
  it("equal split: payer participates, remainder to the lowest address", async () => {
    // Contract order is ascending: BOB < ALICE < CAROL. 10 AUSD / 3 → BOB gets the extra unit.
    const indexer = await run([
      ...createTrip(),
      at(
        2,
        0,
        expenseRecorded(
          1n,
          "dinner",
          ALICE,
          10n * AUSD,
          0n,
          [BOB, ALICE, CAROL],
          [3_333_334n, 3_333_333n, 3_333_333n],
        ),
      ),
    ]);

    const expense = await indexer.Expense.getOrThrow(`1-${id32("dinner")}`);
    expect(expense).toMatchObject({
      payer: ALICE,
      amount: 10n * AUSD,
      splitType: "EQUAL",
      participantCount: 3,
      description: "dinner",
      blockNumber: 2,
      txHash: tx(2),
    });
    const shares = (await indexer.ExpenseShare.getAll()).sort(
      (a, b) => a.position - b.position,
    );
    expect(shares.map((s) => [s.member, s.amount])).toEqual([
      [BOB, 3_333_334n],
      [ALICE, 3_333_333n],
      [CAROL, 3_333_333n],
    ]);
    expect(await nets(indexer, 1n)).toEqual({
      [ALICE]: 6_666_667n, // paid 10, own share 3.333333
      [BOB]: -3_333_334n,
      [CAROL]: -3_333_333n,
      [DAVE]: 0n,
    });
    expect(await indexer.Membership.getOrThrow(`1-${ALICE}`)).toMatchObject({
      totalPaid: 10n * AUSD,
      totalOwedShares: 3_333_333n,
    });
    expect((await indexer.Group.getOrThrow("1")).totalExpenseAmount).toBe(
      10n * AUSD,
    );
  });

  it("custom split with a zero share and a payer who does not participate", async () => {
    const indexer = await run([
      ...createTrip(),
      at(
        2,
        0,
        expenseRecorded(
          1n,
          "taxi",
          BOB,
          12n * AUSD,
          1n,
          [DAVE, ALICE],
          [0n, 12n * AUSD],
        ),
      ),
    ]);
    expect(
      (await indexer.Expense.getOrThrow(`1-${id32("taxi")}`)).splitType,
    ).toBe("CUSTOM");
    expect(await nets(indexer, 1n)).toEqual({
      [ALICE]: -12n * AUSD,
      [BOB]: 12n * AUSD,
      [CAROL]: 0n,
      [DAVE]: 0n,
    });
  });
});

describe("settlements", () => {
  // ALICE +20, BOB -10, CAROL -10.
  const history = (): SimItem[] => [
    ...createTrip(),
    at(
      2,
      0,
      expenseRecorded(
        1n,
        "dinner",
        ALICE,
        30n * AUSD,
        0n,
        [BOB, ALICE, CAROL],
        [10n * AUSD, 10n * AUSD, 10n * AUSD],
      ),
    ),
  ];

  it("token settlement: SettlementRecorded + TokenSettled in one tx, balances applied once", async () => {
    const indexer = await run([
      ...history(),
      at(3, 0, settlementRecorded(1n, "pay", BOB, ALICE, 4n * AUSD, 2n)),
      at(3, 1, tokenSettled(1n, "pay", BOB, ALICE, 4n * AUSD)),
    ]);

    const settlement = await indexer.Settlement.getOrThrow(`1-${id32("pay")}`);
    expect(settlement).toMatchObject({
      kind: "TOKEN_TRANSFER",
      debtor: BOB,
      creditor: ALICE,
      amount: 4n * AUSD,
      token: TOKEN,
      tokenTransferConfirmed: true,
      txHash: tx(3),
      logIndex: 0,
    });
    expect(await nets(indexer, 1n)).toMatchObject({
      [ALICE]: 16n * AUSD,
      [BOB]: -6n * AUSD,
    });
    const group = await indexer.Group.getOrThrow("1");
    expect(group).toMatchObject({
      settlementCount: 1,
      totalTokenSettled: 4n * AUSD,
      totalAcknowledged: 0n,
    });
    const activity = await indexer.GroupActivity.getOrThrow("3-0");
    expect(activity).toMatchObject({
      activityType: "SETTLEMENT_TOKEN_TRANSFER",
      actor: BOB,
      settlement_id: settlement.id,
    });
    // TokenSettled adds no activity row of its own.
    expect(await indexer.GroupActivity.get("3-1")).toBeUndefined();
  });

  it("acknowledged settlement is never presented as a token transfer", async () => {
    const indexer = await run([
      ...history(),
      at(3, 0, settlementRecorded(1n, "cash", BOB, ALICE, 4n * AUSD, 1n)),
    ]);
    const settlement = await indexer.Settlement.getOrThrow(`1-${id32("cash")}`);
    expect(settlement).toMatchObject({
      kind: "ACKNOWLEDGED",
      token: undefined,
      tokenTransferConfirmed: false,
    });
    expect(await indexer.Group.getOrThrow("1")).toMatchObject({
      totalTokenSettled: 0n,
      totalAcknowledged: 4n * AUSD,
    });
    expect((await indexer.GroupActivity.getOrThrow("3-0")).activityType).toBe(
      "SETTLEMENT_ACKNOWLEDGED",
    );
    expect(await nets(indexer, 1n)).toMatchObject({ [BOB]: -6n * AUSD });
  });

  it("ignores a TokenSettled with no matching token settlement", async () => {
    const indexer = await run([
      ...history(),
      at(3, 0, settlementRecorded(1n, "cash", BOB, ALICE, 4n * AUSD, 1n)),
      at(4, 0, tokenSettled(1n, "cash", BOB, ALICE, 4n * AUSD)), // kind mismatch
      at(5, 0, tokenSettled(1n, "ghost", CAROL, ALICE, 1n * AUSD)), // unknown
    ]);
    expect(
      await indexer.Settlement.getOrThrow(`1-${id32("cash")}`),
    ).toMatchObject({
      kind: "ACKNOWLEDGED",
      tokenTransferConfirmed: false,
      token: undefined,
    });
    expect(await indexer.Settlement.get(`1-${id32("ghost")}`)).toBeUndefined();
    expect((await indexer.Group.getOrThrow("1")).totalTokenSettled).toBe(0n);
    expect(await nets(indexer, 1n)).toMatchObject({
      [BOB]: -6n * AUSD,
      [CAROL]: -10n * AUSD,
    });
  });

  it("rejects an unknown settlement kind instead of guessing", async () => {
    const bad = {
      contract: "TallyLedger",
      event: "SettlementRecorded",
      params: {
        groupId: 1n,
        settlementId: id32("bad"),
        from: BOB,
        to: ALICE,
        amount: 1n,
        kind: 0n,
      },
    } as SimItem;
    await expect(run([...history(), at(3, 0, bad)])).rejects.toThrow();
  });
});

describe("re-delivery and ordering", () => {
  it("counts an expense and a token settlement once when their events are delivered twice", async () => {
    const dinner = expenseRecorded(
      1n,
      "dinner",
      ALICE,
      30n * AUSD,
      0n,
      [BOB, ALICE, CAROL],
      [10n * AUSD, 10n * AUSD, 10n * AUSD],
    );
    const indexer = await run([
      ...createTrip(),
      at(2, 0, dinner),
      // Same expense ID seen again at a later position (e.g. replayed by a faulty source).
      at(3, 0, dinner),
      at(4, 0, settlementRecorded(1n, "pay", BOB, ALICE, 4n * AUSD, 2n)),
      at(4, 1, tokenSettled(1n, "pay", BOB, ALICE, 4n * AUSD)),
      at(5, 0, settlementRecorded(1n, "pay", BOB, ALICE, 4n * AUSD, 2n)),
      at(5, 1, tokenSettled(1n, "pay", BOB, ALICE, 4n * AUSD)),
      // A duplicate MemberAdded for an active member.
      at(6, 0, memberAdded(1n, BOB, ALICE)),
    ]);
    expect(await indexer.Expense.getAll()).toHaveLength(1);
    expect(await indexer.Settlement.getAll()).toHaveLength(1);
    expect(await nets(indexer, 1n)).toEqual({
      [ALICE]: 16n * AUSD,
      [BOB]: -6n * AUSD,
      [CAROL]: -10n * AUSD,
      [DAVE]: 0n,
    });
    expect(await indexer.Group.getOrThrow("1")).toMatchObject({
      expenseCount: 1,
      settlementCount: 1,
      memberCount: 4,
      totalTokenSettled: 4n * AUSD,
      activityCount: 7, // 5 creation + expense + settlement
    });
  });

  it("fails loudly if events arrive for a group that was never indexed", async () => {
    await expect(run([at(5, 0, memberAdded(9n, BOB, ALICE))])).rejects.toThrow(
      /start_block/,
    );
  });
});

describe("balance reconstruction with @tally/core", () => {
  it("incremental balances equal core.computeBalances over the indexed history", async () => {
    const indexer = await run([
      ...createTrip(),
      at(
        2,
        0,
        expenseRecorded(
          1n,
          "dinner",
          ALICE,
          30n * AUSD,
          0n,
          [BOB, ALICE, CAROL],
          [10n * AUSD, 10n * AUSD, 10n * AUSD],
        ),
      ),
      at(
        3,
        0,
        expenseRecorded(
          1n,
          "taxi",
          BOB,
          12n * AUSD,
          1n,
          [ALICE, CAROL],
          [2n * AUSD, 10n * AUSD],
        ),
      ),
      at(
        4,
        0,
        expenseRecorded(
          1n,
          "snacks",
          DAVE,
          10n * AUSD,
          0n,
          [BOB, ALICE, CAROL],
          [3_333_334n, 3_333_333n, 3_333_333n],
        ),
      ),
      at(
        5,
        0,
        settlementRecorded(1n, "carol-pays", CAROL, ALICE, 5n * AUSD, 2n),
      ),
      at(5, 1, tokenSettled(1n, "carol-pays", CAROL, ALICE, 5n * AUSD)),
      at(6, 0, settlementRecorded(1n, "bob-cash", BOB, ALICE, 1n * AUSD, 1n)),
      // Second group in the same block range, to check per-group isolation.
      at(7, 0, groupCreated(2n, BOB, "Flat")),
      at(7, 1, memberAdded(2n, BOB, BOB)),
      at(7, 2, memberAdded(2n, CAROL, BOB)),
      at(
        8,
        0,
        expenseRecorded(
          2n,
          "rent",
          BOB,
          1000n * AUSD,
          0n,
          [BOB, CAROL],
          [500n * AUSD, 500n * AUSD],
        ),
      ),
    ]);

    for (const groupId of [1n, 2n]) {
      const indexed = await nets(indexer, groupId);
      expect(indexed).toEqual(await reconstruct(indexer, groupId));
      expect(Object.values(indexed).reduce((a, b) => a + b, 0n)).toBe(0n);
    }
    expect(await nets(indexer, 2n)).toEqual({
      [BOB]: 500n * AUSD,
      [CAROL]: -500n * AUSD,
    });
  });
});

describe("undoing expenses", () => {
  const dinner = (block: number) =>
    at(
      block,
      0,
      expenseRecorded(
        1n,
        "dinner",
        ALICE,
        10n * AUSD,
        0n,
        [BOB, ALICE, CAROL],
        [3_333_334n, 3_333_333n, 3_333_333n],
      ),
    );

  it("reverses balances and running totals, and keeps the expense marked undone", async () => {
    const indexer = await run([
      ...createTrip(),
      dinner(2),
      at(3, 0, expenseUndone(1n, "dinner", ALICE)),
    ]);

    expect(await nets(indexer, 1n)).toEqual({
      [ALICE]: 0n,
      [BOB]: 0n,
      [CAROL]: 0n,
      [DAVE]: 0n,
    });
    const alice = await indexer.Membership.getOrThrow(`1-${ALICE}`);
    expect(alice).toMatchObject({ totalPaid: 0n, totalOwedShares: 0n });

    const expense = await indexer.Expense.getOrThrow(`1-${id32("dinner")}`);
    expect(expense).toMatchObject({
      undone: true,
      undoneBy: ALICE,
      undoneAtBlock: 3,
      undoneTxHash: tx(3),
      participants: [BOB, ALICE, CAROL],
    });
    expect(await indexer.Group.getOrThrow("1")).toMatchObject({
      expenseCount: 0,
      totalExpenseAmount: 0n,
    });
    const undo = (await indexer.GroupActivity.getAll()).find(
      (a) => a.activityType === "EXPENSE_UNDONE",
    );
    expect(undo).toMatchObject({
      actor: ALICE,
      expense_id: `1-${id32("dinner")}`,
      amount: 10n * AUSD,
    });
  });

  it("after a token settlement, the payer owes the money back", async () => {
    const indexer = await run([
      ...createTrip(),
      at(
        2,
        0,
        expenseRecorded(
          1n,
          "lunch",
          ALICE,
          30n * AUSD,
          0n,
          [BOB, ALICE],
          [15n * AUSD, 15n * AUSD],
        ),
      ),
      at(3, 0, settlementRecorded(1n, "s1", BOB, ALICE, 15n * AUSD, 2n)),
      at(3, 1, tokenSettled(1n, "s1", BOB, ALICE, 15n * AUSD)),
      at(4, 0, expenseUndone(1n, "lunch", ALICE)),
    ]);
    const balances = await nets(indexer, 1n);
    expect(balances[ALICE]).toBe(-15n * AUSD);
    expect(balances[BOB]).toBe(15n * AUSD);
    expect(balances).toEqual(await reconstruct(indexer, 1n));
  });

  it("applies a re-delivered ExpenseUndone once", async () => {
    const undo = expenseUndone(1n, "dinner", ALICE);
    const indexer = await run([
      ...createTrip(),
      dinner(2),
      at(3, 0, undo),
      // The same undo seen again at a later position (e.g. replayed by a faulty source).
      at(4, 0, undo),
    ]);
    expect((await nets(indexer, 1n))[ALICE]).toBe(0n);
    expect(
      (await indexer.GroupActivity.getAll()).filter(
        (a) => a.activityType === "EXPENSE_UNDONE",
      ),
    ).toHaveLength(1);
    expect(await indexer.Group.getOrThrow("1")).toMatchObject({
      expenseCount: 0,
      totalExpenseAmount: 0n,
    });
  });

  it("ignores an undo for an expense that was never indexed", async () => {
    const indexer = await run([
      ...createTrip(),
      at(2, 0, expenseUndone(1n, "missing", ALICE)),
    ]);
    expect((await nets(indexer, 1n))[ALICE]).toBe(0n);
    expect(await indexer.Group.getOrThrow("1")).toMatchObject({
      expenseCount: 0,
    });
  });

  it("incremental balances equal core.computeBalances with undos in the history", async () => {
    const indexer = await run([
      ...createTrip(),
      dinner(2),
      at(
        3,
        0,
        expenseRecorded(
          1n,
          "taxi",
          CAROL,
          6n * AUSD,
          1n,
          [DAVE, CAROL],
          [4n * AUSD, 2n * AUSD],
        ),
      ),
      at(4, 0, settlementRecorded(1n, "s1", DAVE, CAROL, 500_000n, 1n)),
      at(5, 0, expenseUndone(1n, "taxi", ALICE)), // undone by the admin
    ]);
    expect(await nets(indexer, 1n)).toEqual(await reconstruct(indexer, 1n));
    // DAVE owed 4, paid 0.5, then the taxi was undone: CAROL owes him 0.5 back.
    expect((await nets(indexer, 1n))[DAVE]).toBe(500_000n);
  });
});
