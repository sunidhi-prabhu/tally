import { simplifyDebts, type Transfer } from "@tally/core";
import type { GroupMember, MyMembership } from "./indexer/queries";

export interface BalanceSummary {
  /** Total the user owes across groups (positive number). */
  youOwe: bigint;
  /** Total owed to the user across groups. */
  owedToYou: bigint;
  net: bigint;
}

/** Sums per-group net balances. Each group's debts are separate; nothing is netted across groups. */
export function summarize(
  memberships: readonly MyMembership[],
): BalanceSummary {
  let youOwe = 0n;
  let owedToYou = 0n;
  for (const m of memberships) {
    if (m.netBalance < 0n) youOwe += -m.netBalance;
    else owedToYou += m.netBalance;
  }
  return { youOwe, owedToYou, net: owedToYou - youOwe };
}

/** Suggested payments that settle the group, from @tally/core's greedy simplification. */
export function suggestedTransfers(
  members: readonly GroupMember[],
): Transfer[] {
  return simplifyDebts(
    members.map((m) => ({ member: m.address, net: m.netBalance })),
  );
}

export function transfersInvolving(
  transfers: readonly Transfer[],
  address: string,
) {
  const me = address.toLowerCase();
  return {
    youPay: transfers.filter((t) => t.from === me),
    youReceive: transfers.filter((t) => t.to === me),
  };
}

/**
 * How many payments settling up would take without simplification: one per pair of people
 * with a net debt between them, from active expenses (each participant owes the payer their
 * share) and settlements (a payment reduces what the payer owes the recipient). Compare with
 * `suggestedTransfers(...).length`.
 */
export function pairwiseDebtCount(
  expenses: readonly {
    payer: string;
    shares: readonly { member: string; amount: bigint }[];
  }[],
  settlements: readonly { debtor: string; creditor: string; amount: bigint }[],
): number {
  // owes.get("a|b") > 0: a owes b. Each pair is stored once, in sorted key order.
  const owes = new Map<string, bigint>();
  const add = (debtor: string, creditor: string, amount: bigint) => {
    if (debtor === creditor || amount === 0n) return;
    const [x, y, sign] =
      debtor < creditor ? [debtor, creditor, 1n] : [creditor, debtor, -1n];
    const key = `${x}|${y}`;
    owes.set(key, (owes.get(key) ?? 0n) + sign * amount);
  };
  for (const e of expenses) {
    for (const s of e.shares) add(s.member, e.payer, s.amount);
  }
  for (const s of settlements) add(s.creditor, s.debtor, s.amount);
  return [...owes.values()].filter((v) => v !== 0n).length;
}
