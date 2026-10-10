// GENERATED from packages/core/src/balances.ts by scripts/sync-core.mjs. Do not edit here.
import { TallyError } from "./errors";
import { assertEntityId, assertMember, assertValidGroup } from "./members";
import { assertPositiveAmount } from "./money";
import { assertValidExpense } from "./split";
import type {
  Group,
  LedgerEntry,
  MemberId,
  NetBalance,
  Settlement,
  SettlementInput,
  SettlementKind,
} from "./types";

/**
 * The most `from` can pay `to` right now: the smaller of what `from` owes and what `to` is
 * owed. Returns 0n when either side has nothing outstanding, or for unknown members.
 */
export function maxSettleable(
  balances: readonly NetBalance[],
  from: MemberId,
  to: MemberId,
): bigint {
  if (from === to) return 0n;
  const debt = -(balances.find((b) => b.member === from)?.net ?? 0n);
  const credit = balances.find((b) => b.member === to)?.net ?? 0n;
  if (debt <= 0n || credit <= 0n) return 0n;
  return debt < credit ? debt : credit;
}

/**
 * Checks that a settlement is allowed given the current balances: both parties are members,
 * the amount is positive, and it does not exceed `maxSettleable`. Because an applied
 * settlement reduces both balances, the same debt can never be cleared twice.
 *
 * @throws TallyError SELF_SETTLEMENT | NOT_A_MEMBER | NON_POSITIVE_AMOUNT | SETTLEMENT_EXCEEDS_DEBT
 */
export function assertSettlementAllowed(
  group: Group,
  balances: readonly NetBalance[],
  settlement: SettlementInput,
): void {
  if (settlement.from === settlement.to) {
    throw new TallyError("SELF_SETTLEMENT", "A member cannot pay themselves");
  }
  assertMember(group, settlement.from, "Payer");
  assertMember(group, settlement.to, "Recipient");
  assertPositiveAmount(settlement.amount, "Settlement amount");

  const max = maxSettleable(balances, settlement.from, settlement.to);
  if (settlement.amount > max) {
    throw new TallyError(
      "SETTLEMENT_EXCEEDS_DEBT",
      "Settlement is larger than the outstanding debt",
      { requested: settlement.amount, max },
    );
  }
}

export const SETTLEMENT_KINDS: readonly SettlementKind[] = [
  "acknowledged",
  "token",
];

/**
 * True only for settlements where tokens moved on-chain. Use this, never mere presence of a
 * settlement, before telling a user they were paid.
 */
export function isTokenSettlement(settlement: Settlement): boolean {
  return settlement.kind === "token";
}

function assertSettlementEntry(group: Group, settlement: Settlement): void {
  assertEntityId(settlement.id, "Settlement");
  if (!SETTLEMENT_KINDS.includes(settlement.kind)) {
    throw new TallyError(
      "INVALID_SETTLEMENT_KIND",
      'Settlement kind must be "acknowledged" or "token"',
      { settlementId: settlement.id },
    );
  }
  if (settlement.groupId !== group.id) {
    throw new TallyError(
      "WRONG_GROUP",
      "Settlement belongs to a different group",
      {
        settlementId: settlement.id,
      },
    );
  }
}

/**
 * Replays a group's ledger (oldest first) and returns each member's net balance, in
 * `group.members` order.
 *
 * - Expense: the payer is credited the full amount; each participant is debited their share.
 *   A payer who also participates therefore nets `amount - ownShare`.
 * - Settlement (either kind): validated against the balances at that point in the ledger
 *   (`assertSettlementAllowed`), then the payer's debt and the recipient's credit both
 *   shrink by the amount. IDs are unique across both kinds, as in the contract.
 *
 * Every entry is validated; IDs must be unique per entry kind. Net balances always sum to zero.
 *
 * @example
 * computeBalances(group, [{ kind: "expense", expense }]);
 * // [{ member: "alice", net: 20_000_000n }, { member: "bob", net: -10_000_000n }, ...]
 * @throws TallyError for any invalid, duplicate or over-paying entry
 */
export function computeBalances(
  group: Group,
  entries: readonly LedgerEntry[],
): NetBalance[] {
  assertValidGroup(group);

  const net = new Map<MemberId, bigint>(
    group.members.map((member) => [member, 0n]),
  );
  const add = (member: MemberId, delta: bigint) =>
    net.set(member, (net.get(member) ?? 0n) + delta);
  const snapshot = (): NetBalance[] =>
    group.members.map((member) => ({ member, net: net.get(member) ?? 0n }));
  const seenExpenses = new Set<string>();
  const seenSettlements = new Set<string>();

  for (const entry of entries) {
    if (entry.kind === "expense") {
      const { expense } = entry;
      assertValidExpense(group, expense);
      if (seenExpenses.has(expense.id)) {
        throw new TallyError("DUPLICATE_ENTRY", "Expense recorded twice", {
          id: expense.id,
        });
      }
      seenExpenses.add(expense.id);
    } else {
      const { settlement } = entry;
      assertSettlementEntry(group, settlement);
      if (seenSettlements.has(settlement.id)) {
        throw new TallyError("DUPLICATE_ENTRY", "Settlement recorded twice", {
          id: settlement.id,
        });
      }
      assertSettlementAllowed(group, snapshot(), settlement);
      seenSettlements.add(settlement.id);
    }
    for (const { member, delta } of ledgerEntryDeltas(entry)) {
      add(member, delta);
    }
  }

  const balances = snapshot();
  assertBalanced(balances);
  return balances;
}

/**
 * The balance changes one ledger entry causes, without validation. This is the single
 * accounting rule shared by `computeBalances` and incremental consumers such as the indexer:
 *
 * - Expense: payer +amount, each participant −share (a participating payer nets
 *   `amount − ownShare`).
 * - Settlement (either kind, counted once): debtor (`from`) +amount, creditor (`to`) −amount.
 *
 * Deltas for the same member are combined, and zero deltas are omitted, so the result always
 * sums to zero. Validate entries first (`assertValidExpense`, `assertSettlementAllowed`).
 *
 * @example
 * ledgerEntryDeltas({ kind: "settlement", settlement }); // [{ member: from, delta: amount }, { member: to, delta: -amount }]
 */
export function ledgerEntryDeltas(
  entry: LedgerEntry,
): { member: MemberId; delta: bigint }[] {
  const deltas = new Map<MemberId, bigint>();
  const add = (member: MemberId, delta: bigint) =>
    deltas.set(member, (deltas.get(member) ?? 0n) + delta);
  if (entry.kind === "expense") {
    add(entry.expense.payer, entry.expense.amount);
    for (const share of entry.expense.shares) add(share.member, -share.amount);
  } else {
    add(entry.settlement.from, entry.settlement.amount);
    add(entry.settlement.to, -entry.settlement.amount);
  }
  return [...deltas]
    .filter(([, delta]) => delta !== 0n)
    .map(([member, delta]) => ({ member, delta }));
}

/** @throws TallyError UNBALANCED if the nets do not sum to zero */
export function assertBalanced(balances: readonly NetBalance[]): void {
  const sum = balances.reduce((total, b) => total + b.net, 0n);
  if (sum !== 0n) {
    throw new TallyError("UNBALANCED", "Net balances must sum to zero", {
      sum,
    });
  }
}
