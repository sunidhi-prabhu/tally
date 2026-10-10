// Indexes REAL logs from a local anvil node running the LocalDemo deployment (see README).
// Opt-in: RUN_LOCAL_CHAIN_TESTS=true, with anvil on http://127.0.0.1:8545 and
// packages/contracts/script/LocalDemo.s.sol already broadcast to it.
import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import { computeBalances, type LedgerEntry } from "../src/core";

const RPC = "http://127.0.0.1:8545";
const enabled = process.env.RUN_LOCAL_CHAIN_TESTS === "true";

// anvil default accounts (lowercase, as indexed).
const ALICE = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const BOB = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const CAROL = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const DAVE = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const EVE = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65";
const MOCK_TOKEN = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const AUSD = 1_000_000n;

const LEDGER = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
// cast sig "netBalance(uint256,address)"
const NET_BALANCE = "0x9c32f4a1";

async function rpc(method: string, params: unknown[]): Promise<string> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result } = (await response.json()) as { result: string };
  return result;
}

async function latestBlock(): Promise<number> {
  return Number.parseInt(await rpc("eth_blockNumber", []), 16);
}

/** TallyLedger.netBalance(groupId, member) read straight from the contract. */
async function contractNetBalance(
  groupId: bigint,
  member: string,
): Promise<bigint> {
  const data =
    NET_BALANCE +
    groupId.toString(16).padStart(64, "0") +
    member.slice(2).padStart(64, "0");
  return BigInt.asIntN(
    256,
    BigInt(await rpc("eth_call", [{ to: LEDGER, data }, "latest"])),
  );
}

describe.skipIf(!enabled)("local anvil deployment (real logs)", () => {
  it("indexes the LocalDemo history and matches @tally/core", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 31337: { startBlock: 0, endBlock: await latestBlock() } },
    });

    const trip = await indexer.Group.getOrThrow("1");
    expect(trip).toMatchObject({
      name: "Trip",
      admin: ALICE,
      memberCount: 4,
      expenseCount: 3,
      settlementCount: 2,
      totalExpenseAmount: 52n * AUSD,
      totalTokenSettled: 5n * AUSD,
      totalAcknowledged: 1n * AUSD,
    });
    expect(await indexer.Group.getOrThrow("2")).toMatchObject({
      name: "Flat",
      admin: BOB,
      memberCount: 2,
    });

    const eve = await indexer.Membership.getOrThrow(`1-${EVE}`);
    expect(eve).toMatchObject({ active: false, netBalance: 0n });

    const settlements = await indexer.Settlement.getAll();
    const token = settlements.find((s) => s.kind === "TOKEN_TRANSFER");
    const ack = settlements.find((s) => s.kind === "ACKNOWLEDGED");
    expect(token).toMatchObject({
      debtor: CAROL,
      creditor: ALICE,
      amount: 5n * AUSD,
      token: MOCK_TOKEN,
      tokenTransferConfirmed: true,
    });
    expect(ack).toMatchObject({
      debtor: BOB,
      creditor: ALICE,
      amount: 1n * AUSD,
      token: undefined,
      tokenTransferConfirmed: false,
    });
    // Real transaction hashes and the multi-event createGroup transaction.
    const creation = (await indexer.GroupActivity.getAll())
      .filter(
        (a) => a.group_id === "1" && a.blockNumber === trip.createdAtBlock,
      )
      .sort((a, b) => a.logIndex - b.logIndex);
    expect(creation.map((a) => a.activityType)).toEqual([
      "GROUP_CREATED",
      "MEMBER_ADDED",
      "MEMBER_ADDED",
      "MEMBER_ADDED",
      "MEMBER_ADDED",
    ]);
    expect(new Set(creation.map((a) => a.txHash)).size).toBe(1);
    expect(creation[0]!.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    // Rebuild group 1 from indexed rows in chain order and compare with core.
    const expenses = (await indexer.Expense.getAll()).filter(
      (e) => e.group_id === "1",
    );
    const shares = await indexer.ExpenseShare.getAll();
    const entries = [
      ...expenses.map((e) => ({
        at: [e.blockNumber, e.logIndex],
        entry: {
          kind: "expense",
          expense: {
            id: e.id,
            groupId: "1",
            payer: e.payer,
            amount: e.amount,
            description: e.description,
            shares: shares
              .filter((s) => s.expense_id === e.id)
              .sort((a, b) => a.position - b.position)
              .map((s) => ({ member: s.member, amount: s.amount })),
          },
        } as LedgerEntry,
      })),
      ...settlements
        .filter((s) => s.group_id === "1")
        .map((s) => ({
          at: [s.blockNumber, s.logIndex],
          entry: {
            kind: "settlement",
            settlement: {
              id: s.id,
              groupId: "1",
              from: s.debtor,
              to: s.creditor,
              amount: s.amount,
              kind: s.kind === "TOKEN_TRANSFER" ? "token" : "acknowledged",
            },
          } as LedgerEntry,
        })),
    ].sort((a, b) => a.at[0]! - b.at[0]! || a.at[1]! - b.at[1]!);
    const core = computeBalances(
      { id: "1", name: "Trip", members: [ALICE, BOB, CAROL, DAVE, EVE] },
      entries.map((e) => e.entry),
    );
    for (const { member, net } of core) {
      expect(
        (await indexer.Membership.getOrThrow(`1-${member}`)).netBalance,
      ).toBe(net);
    }

    // Every indexed balance, in every group, equals the contract's own netBalance().
    const memberships = await indexer.Membership.getAll();
    expect(memberships.length).toBeGreaterThan(0);
    for (const m of memberships) {
      expect(m.netBalance).toBe(
        await contractNetBalance(BigInt(m.group_id), m.address),
      );
    }
  }, 60_000);
});
