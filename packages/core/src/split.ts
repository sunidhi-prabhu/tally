import { TallyError } from "./errors";
import {
  assertEntityId,
  assertMember,
  assertUniqueParticipants,
  assertValidGroup,
  compareIds,
} from "./members";
import { assertNonNegativeAmount, assertPositiveAmount } from "./money";
import type {
  Expense,
  ExpenseInput,
  Group,
  MemberId,
  ParticipantShare,
} from "./types";

/**
 * Splits `amount` equally, allocating every base unit.
 *
 * Remainder rule: each participant gets `floor(amount / n)` units. The leftover
 * `amount % n` units (always fewer than n) go one each to the participants whose IDs sort
 * first (`compareIds`, ascending). The result therefore depends only on the set of
 * participants, not their order. Shares are returned in input order. When `amount < n`,
 * some participants get a zero share.
 *
 * @example splitEqual(100n, ["bob", "alice", "carol"])
 * // [{ member: "bob", amount: 33n }, { member: "alice", amount: 34n }, { member: "carol", amount: 33n }]
 * @throws TallyError for a non-positive amount or empty, invalid or duplicate participants
 */
export function splitEqual(
  amount: bigint,
  participants: readonly MemberId[],
): ParticipantShare[] {
  assertPositiveAmount(amount);
  assertUniqueParticipants(participants);

  const count = BigInt(participants.length);
  const base = amount / count;
  const remainder = Number(amount % count);
  const extra = new Set([...participants].sort(compareIds).slice(0, remainder));

  return participants.map((member) => ({
    member,
    amount: extra.has(member) ? base + 1n : base,
  }));
}

/**
 * Validates explicit shares for `amount` and returns a copy.
 *
 * Shares must be non-negative, belong to unique valid members, and add up to `amount` exactly.
 * Zero shares are allowed (a participant who owes nothing).
 *
 * @throws TallyError NON_POSITIVE_AMOUNT | NEGATIVE_AMOUNT | DUPLICATE_PARTICIPANT |
 *   SPLIT_TOTAL_MISMATCH | ...
 */
export function splitCustom(
  amount: bigint,
  shares: readonly ParticipantShare[],
): ParticipantShare[] {
  assertPositiveAmount(amount);
  assertUniqueParticipants(shares.map((share) => share.member));

  let total = 0n;
  for (const share of shares) {
    assertNonNegativeAmount(share.amount, "Share");
    total += share.amount;
  }
  if (total !== amount) {
    throw new TallyError(
      "SPLIT_TOTAL_MISMATCH",
      "Shares must add up to the expense amount",
      {
        expected: amount,
        actual: total,
      },
    );
  }
  return shares.map(({ member, amount: shareAmount }) => ({
    member,
    amount: shareAmount,
  }));
}

/**
 * Builds a validated expense for `group`.
 *
 * The payer may also be a participant; their own share is never treated as a debt to themselves.
 *
 * @example
 * createExpense(group, "e1", {
 *   payer: "alice",
 *   amount: parseAmount("30"),
 *   split: { type: "equal", participants: ["alice", "bob", "carol"] },
 *   description: "Dinner",
 * });
 * @throws TallyError if the group, payer, amount or split is invalid
 */
export function createExpense(
  group: Group,
  id: string,
  input: ExpenseInput,
): Expense {
  assertValidGroup(group);
  assertEntityId(id, "Expense");
  assertMember(group, input.payer, "Payer");

  const shares =
    input.split.type === "equal"
      ? splitEqual(input.amount, input.split.participants)
      : splitCustom(input.amount, input.split.shares);
  for (const share of shares) {
    assertMember(group, share.member, "Participant");
  }

  return {
    id,
    groupId: group.id,
    payer: input.payer,
    amount: input.amount,
    shares,
    description: input.description ?? "",
  };
}

/**
 * Re-validates an expense that came from elsewhere (storage, indexer) against `group`.
 *
 * @throws TallyError WRONG_GROUP | NOT_A_MEMBER | SPLIT_TOTAL_MISMATCH | ...
 */
export function assertValidExpense(group: Group, expense: Expense): void {
  assertEntityId(expense.id, "Expense");
  if (expense.groupId !== group.id) {
    throw new TallyError(
      "WRONG_GROUP",
      "Expense belongs to a different group",
      {
        expenseId: expense.id,
      },
    );
  }
  assertMember(group, expense.payer, "Payer");
  splitCustom(expense.amount, expense.shares);
  for (const share of expense.shares) {
    assertMember(group, share.member, "Participant");
  }
}
