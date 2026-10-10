import type { SettlementRow } from "@/lib/indexer/queries";
import { isVerifiedTokenPayment } from "@/lib/indexer/queries";
import { shortHash, timeAgo } from "@/lib/format";
import { AddressLabel, Amount, Badge } from "./ui";

/** How a settlement is presented. Only verified token transfers may be called "paid". */
export function settlementLabel(s: SettlementRow): {
  title: string;
  tone: "positive" | "warning";
  detail: string;
} {
  if (isVerifiedTokenPayment(s)) {
    return {
      title: "Paid in AUSD",
      tone: "positive",
      detail: "Tokens moved on-chain in this transaction.",
    };
  }
  if (s.kind === "TOKEN_TRANSFER") {
    return {
      title: "Token payment (confirming)",
      tone: "warning",
      detail: "Recorded; the token transfer details are still being indexed.",
    };
  }
  return {
    title: "Marked as received",
    tone: "warning",
    detail: "The recipient says they were paid outside Tally. No tokens moved.",
  };
}

export function SettlementList({
  items,
  me,
  names,
}: {
  items: SettlementRow[];
  me: string | undefined;
  names: Record<string, string>;
}) {
  return (
    <ul className="space-y-2">
      {items.map((s) => {
        const label = settlementLabel(s);
        return (
          <li
            key={s.id}
            className="rounded-2xl border border-border bg-surface p-3 text-sm"
            data-kind={s.kind}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="flex min-w-0 flex-wrap items-center gap-1">
                <AddressLabel address={s.debtor} me={me} names={names} />
                <span aria-hidden>→</span>
                <span className="sr-only">paid</span>
                <AddressLabel address={s.creditor} me={me} names={names} />
              </p>
              <Amount units={s.amount} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={label.tone}>{label.title}</Badge>
              <span>{label.detail}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {timeAgo(s.timestamp)} ·{" "}
              <span className="font-mono">Tx {shortHash(s.txHash)}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
