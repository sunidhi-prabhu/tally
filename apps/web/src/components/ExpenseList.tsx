import type { ExpenseRow } from "@/lib/indexer/queries";
import { timeAgo } from "@/lib/format";
import { AddressLabel, Amount, Badge } from "./ui";

export function ExpenseList({
  items,
  me,
  names,
}: {
  items: ExpenseRow[];
  me: string | undefined;
  names: Record<string, string>;
}) {
  return (
    <ul className="space-y-2">
      {items.map((e) => {
        const myShare = me
          ? e.shares.find((s) => s.member === me.toLowerCase())?.amount
          : undefined;
        return (
          <li
            key={e.id}
            className="rounded-2xl border border-border bg-surface p-3 text-sm"
          >
            <details>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {e.description || "Expense"}
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted">
                    Paid by{" "}
                    <AddressLabel
                      address={e.payer}
                      me={me}
                      names={names}
                      withAvatar={false}
                    />{" "}
                    · {timeAgo(e.timestamp)}
                  </span>
                </span>
                <span className="text-right">
                  <Amount units={e.amount} />
                  {myShare !== undefined && (
                    <span className="block text-xs text-muted">
                      Your share <Amount units={myShare} />
                    </span>
                  )}
                </span>
              </summary>
              <div className="mt-3 space-y-1 border-t border-border pt-2">
                <p className="text-xs text-muted">
                  <Badge>
                    {e.splitType === "EQUAL" ? "Split equally" : "Custom split"}
                  </Badge>
                </p>
                <ul className="space-y-1" aria-label="Shares">
                  {e.shares.map((s) => (
                    <li
                      key={s.member}
                      className="flex items-center justify-between gap-2"
                    >
                      <AddressLabel address={s.member} me={me} names={names} />
                      <Amount units={s.amount} />
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
