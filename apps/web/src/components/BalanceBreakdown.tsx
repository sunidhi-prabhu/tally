import type { Transfer } from "@tally/core";
import type { GroupMember } from "@/lib/indexer/queries";
import { AddressLabel, Amount, EmptyState } from "./ui";

/** Each member's net position and the suggested payments that would settle the group. */
export function BalanceBreakdown({
  members,
  transfers,
  me,
  names,
}: {
  members: GroupMember[];
  transfers: Transfer[];
  me: string | undefined;
  names: Record<string, string>;
}) {
  const active = members.filter((m) => m.active);
  return (
    <div className="space-y-4">
      <ul
        className="divide-y divide-border rounded-2xl border border-border bg-surface"
        aria-label="Member balances"
      >
        {active.map((m) => (
          <li
            key={m.address}
            className="flex items-center justify-between gap-2 p-3 text-sm"
          >
            <AddressLabel address={m.address} me={me} names={names} />
            <span className="text-right">
              <span className="block text-xs text-muted">
                {m.netBalance > 0n
                  ? "is owed"
                  : m.netBalance < 0n
                    ? "owes"
                    : "settled up"}
              </span>
              <Amount units={m.netBalance} signed />
            </span>
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Who owes whom</h3>
        {transfers.length === 0 ? (
          <EmptyState title="Everyone is settled up" />
        ) : (
          <ul className="space-y-2" aria-label="Suggested payments">
            {transfers.map((t) => (
              <li
                key={`${t.from}-${t.to}`}
                className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-surface p-3 text-sm"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  <AddressLabel address={t.from} me={me} names={names} />
                  <span className="text-muted">pays</span>
                  <AddressLabel address={t.to} me={me} names={names} />
                </span>
                <Amount units={t.amount} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">
          Suggested with a greedy algorithm: few payments, not always the fewest
          possible.
        </p>
      </div>
    </div>
  );
}
