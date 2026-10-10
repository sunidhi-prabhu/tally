"use client";

import Link from "next/link";
import type { Activity } from "@/lib/indexer/queries";
import { timeAgo } from "@/lib/format";
import { AddressLabel, Amount, Badge } from "./ui";

function describe(item: Activity, me: string, names: Record<string, string>) {
  const who = (a: string) => (
    <AddressLabel address={a} me={me} names={names} withAvatar={false} />
  );
  switch (item.type) {
    case "GROUP_CREATED":
      return <>{who(item.actor)} created the group</>;
    case "MEMBER_ADDED":
      return <>{who(item.member ?? item.actor)} joined</>;
    case "MEMBER_REMOVED":
      return <>{who(item.member ?? item.actor)} left</>;
    case "EXPENSE_RECORDED":
      return (
        <>
          {who(item.actor)} added “{item.description ?? "expense"}”
        </>
      );
    case "SETTLEMENT_TOKEN_TRANSFER":
      return <>{who(item.actor)} paid in AUSD</>;
    case "SETTLEMENT_ACKNOWLEDGED":
      return <>{who(item.actor)} marked a payment as received</>;
  }
}

export function ActivityList({
  items,
  me,
  names,
  showGroup = false,
}: {
  items: Activity[];
  me: string;
  names: Record<string, string>;
  showGroup?: boolean;
}) {
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-start justify-between gap-3 p-3 text-sm"
        >
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1">
              {describe(item, me, names)}
            </p>
            <p className="text-xs text-muted">
              {showGroup && (
                <>
                  <Link className="underline" href={`/groups/${item.groupId}`}>
                    {item.groupName}
                  </Link>{" "}
                  ·{" "}
                </>
              )}
              {timeAgo(item.timestamp)}
              {item.type === "SETTLEMENT_TOKEN_TRANSFER" && (
                <>
                  {" "}
                  · <Badge tone="positive">on-chain</Badge>
                </>
              )}
              {item.type === "SETTLEMENT_ACKNOWLEDGED" && (
                <>
                  {" "}
                  · <Badge tone="warning">no tokens moved</Badge>
                </>
              )}
            </p>
          </div>
          {item.amount !== undefined && (
            <Amount units={item.amount} className="text-sm" />
          )}
        </li>
      ))}
    </ul>
  );
}
