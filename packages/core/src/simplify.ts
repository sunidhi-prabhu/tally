import { TallyError } from "./errors";
import { assertMemberId, compareIds } from "./members";
import { assertBalanced } from "./balances";
import type { MemberId, NetBalance, Transfer } from "./types";

interface Position {
  readonly member: MemberId;
  remaining: bigint;
}

/** Largest remaining first; ties broken by ascending member ID. */
function pickLargest(positions: readonly Position[]): Position | undefined {
  let best: Position | undefined;
  for (const p of positions) {
    if (
      !best ||
      p.remaining > best.remaining ||
      (p.remaining === best.remaining && compareIds(p.member, best.member) < 0)
    ) {
      best = p;
    }
  }
  return best;
}

/**
 * Turns net balances into a short list of payments that settles everyone.
 *
 * Greedy algorithm: repeatedly take the member who owes the most and the member who is owed
 * the most (ties: lower member ID first), and have the debtor pay the creditor the smaller
 * of the two amounts. Each step fully settles at least one of them, so the result has at
 * most `k - 1` transfers for `k` members with a non-zero balance.
 *
 * Guarantees: every transfer is positive and between two different members, every member's
 * net position is preserved exactly, and the output depends only on the balances (not their
 * order).
 *
 * Not guaranteed: the globally minimum number of transfers. Finding that is NP-hard. For
 * example, `{A: +6, B: +5, C: -5, D: -4, E: -2}` yields 4 transfers here, while 3 suffice
 * (C→B 5, D→A 4, E→A 2).
 *
 * @example
 * simplifyDebts([{ member: "alice", net: -40n }, { member: "bob", net: 0n }, { member: "carol", net: 40n }]);
 * // [{ from: "alice", to: "carol", amount: 40n }]
 * @throws TallyError INVALID_MEMBER_ID | DUPLICATE_MEMBER | INVALID_AMOUNT | UNBALANCED
 */
export function simplifyDebts(balances: readonly NetBalance[]): Transfer[] {
  const seen = new Set<MemberId>();
  for (const { member, net } of balances) {
    assertMemberId(member);
    if (seen.has(member)) {
      throw new TallyError(
        "DUPLICATE_MEMBER",
        "Member listed twice in balances",
        { member },
      );
    }
    if (typeof net !== "bigint") {
      throw new TallyError(
        "INVALID_AMOUNT",
        "Balance must be a bigint in base units",
        { member },
      );
    }
    seen.add(member);
  }
  assertBalanced(balances);

  let debtors: Position[] = balances
    .filter((b) => b.net < 0n)
    .map((b) => ({ member: b.member, remaining: -b.net }));
  let creditors: Position[] = balances
    .filter((b) => b.net > 0n)
    .map((b) => ({ member: b.member, remaining: b.net }));

  const transfers: Transfer[] = [];
  for (;;) {
    const debtor = pickLargest(debtors);
    const creditor = pickLargest(creditors);
    if (!debtor || !creditor) break;

    const amount =
      debtor.remaining < creditor.remaining
        ? debtor.remaining
        : creditor.remaining;
    transfers.push({ from: debtor.member, to: creditor.member, amount });
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    debtors = debtors.filter((p) => p.remaining > 0n);
    creditors = creditors.filter((p) => p.remaining > 0n);
  }
  return transfers;
}
