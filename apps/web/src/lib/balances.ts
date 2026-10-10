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
