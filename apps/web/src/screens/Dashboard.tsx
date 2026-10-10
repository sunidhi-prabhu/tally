"use client";

import { plural } from "@/lib/format";
import Link from "next/link";
import { useMemo } from "react";
import { useAccount, useApp } from "@/providers/AppProviders";
import { useLiveQuery } from "@/hooks/useLiveQuery";
import {
  MY_MEMBERSHIPS,
  RECENT_ACTIVITY,
  parseActivity,
  parseMyMemberships,
} from "@/lib/indexer/queries";
import { summarize } from "@/lib/balances";
import { DataState } from "@/components/DataState";
import { ActivityList } from "@/components/ActivityList";
import { useDemoNames } from "@/components/AppShell";
import {
  Amount,
  ButtonLink,
  Card,
  EmptyState,
  Notice,
  SectionTitle,
} from "@/components/ui";

export function Dashboard() {
  const { config } = useApp();
  const { address, source, passkey } = useAccount();

  if (!address) {
    return (
      <Card aria-labelledby="welcome-heading" className="space-y-4">
        <h1
          id="welcome-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Split expenses. Settle up in AUSD.
        </h1>
        <p className="text-sm text-muted">
          Sign in with a passkey (Face ID, Touch ID or your device PIN) to get a
          wallet you own. No seed phrase to write down.
        </p>
        <div className="grid gap-2">
          <ButtonLink href="/account">
            {passkey.state.status === "signed-out"
              ? "Create or sign in with a passkey"
              : "Unlock your passkey wallet"}
          </ButtonLink>
          {config.allowDemoAccounts && source === "demo" && (
            <p className="text-center text-xs text-muted">
              or pick a demo account at the top
            </p>
          )}
        </div>
      </Card>
    );
  }
  return <DashboardFor address={address} />;
}

function DashboardFor({ address }: { address: string }) {
  const { canWrite } = useAccount();
  const names = useDemoNames();
  const memberships = useLiveQuery(
    MY_MEMBERSHIPS,
    { address },
    parseMyMemberships,
  );
  const activeGroups = useMemo(
    () => (memberships.data ?? []).filter((m) => m.active),
    [memberships.data],
  );
  const groupIds = useMemo(
    () => activeGroups.map((m) => m.groupId),
    [activeGroups],
  );
  const activity = useLiveQuery(
    RECENT_ACTIVITY,
    { groupIds, limit: 8 },
    parseActivity,
    { enabled: groupIds.length > 0 },
  );

  return (
    <>
      <DataState result={memberships} label="your balances">
        {(rows) => {
          const active = rows.filter((m) => m.active);
          const summary = summarize(active);
          return (
            <>
              <Card aria-labelledby="totals-heading">
                <h1 id="totals-heading" className="sr-only">
                  Your balances
                </h1>
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-negative-bg p-3">
                    <dt className="text-xs text-negative">You owe</dt>
                    <dd className="mt-1 text-xl font-semibold">
                      <Amount units={summary.youOwe} />
                    </dd>
                  </div>
                  <div className="rounded-xl bg-positive-bg p-3">
                    <dt className="text-xs text-positive">You&apos;re owed</dt>
                    <dd className="mt-1 text-xl font-semibold">
                      <Amount units={summary.owedToYou} />
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted">
                  Totals add up each group separately; debts in different groups
                  don&apos;t cancel out.
                </p>
              </Card>

              <section aria-labelledby="groups-heading">
                <SectionTitle
                  id="groups-heading"
                  action={
                    canWrite ? (
                      <ButtonLink
                        href="/groups/new"
                        variant="ghost"
                        className="min-h-9 px-2"
                      >
                        + New group
                      </ButtonLink>
                    ) : undefined
                  }
                >
                  Groups
                </SectionTitle>
                {active.length === 0 ? (
                  <EmptyState title="No groups yet">
                    {canWrite
                      ? "Create one, or ask a group admin to add your address."
                      : "This address isn't in any indexed group."}
                  </EmptyState>
                ) : (
                  <ul className="space-y-2">
                    {active.map((m) => (
                      <li key={m.groupId}>
                        <Link
                          href={`/groups/${m.groupId}`}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-accent"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {m.groupName}
                            </span>
                            <span className="text-xs text-muted">
                              {plural(m.memberCount, "member")} ·{" "}
                              {plural(m.expenseCount, "expense")}
                            </span>
                          </span>
                          <span className="text-right text-sm">
                            <span className="block text-xs text-muted">
                              {m.netBalance > 0n
                                ? "You're owed"
                                : m.netBalance < 0n
                                  ? "You owe"
                                  : "Settled"}
                            </span>
                            <Amount
                              units={
                                m.netBalance < 0n ? -m.netBalance : m.netBalance
                              }
                            />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          );
        }}
      </DataState>

      {groupIds.length > 0 && (
        <section aria-labelledby="activity-heading">
          <SectionTitle id="activity-heading">Recent activity</SectionTitle>
          <DataState result={activity} label="recent activity">
            {(items) =>
              items.length === 0 ? (
                <Notice>No activity yet.</Notice>
              ) : (
                <ActivityList
                  items={items}
                  me={address}
                  names={names}
                  showGroup
                />
              )
            }
          </DataState>
        </section>
      )}
    </>
  );
}
