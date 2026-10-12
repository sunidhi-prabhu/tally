"use client";

import { plural } from "@/lib/format";
import { useMemo, useState } from "react";
import { useAccount } from "@/providers/AppProviders";
import { useLiveQuery } from "@/hooks/useLiveQuery";
import {
  GROUP_DETAIL,
  GROUP_EXPENSES,
  GROUP_SETTLEMENTS,
  parseExpenses,
  parseGroupDetail,
  parseSettlements,
} from "@/lib/indexer/queries";
import { suggestedTransfers, transfersInvolving } from "@/lib/balances";
import { DataState } from "@/components/DataState";
import { WriteGate } from "@/components/WriteGate";
import { BalanceBreakdown } from "@/components/BalanceBreakdown";
import { ExpenseList } from "@/components/ExpenseList";
import type { UndoContext } from "@/components/UndoExpense";
import { SettlementList } from "@/components/SettlementList";
import { useDemoNames } from "@/components/AppShell";
import {
  AddressLabel,
  Amount,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Notice,
} from "@/components/ui";

const PAGE = 10;
type Tab = "balances" | "expenses" | "settlements" | "members";
const TABS: { id: Tab; label: string }[] = [
  { id: "balances", label: "Balances" },
  { id: "expenses", label: "Expenses" },
  { id: "settlements", label: "Settlements" },
  { id: "members", label: "Members" },
];

export function GroupDetail({ groupId }: { groupId: string }) {
  const { address, canWrite } = useAccount();
  const names = useDemoNames();
  const [tab, setTab] = useState<Tab>("balances");
  const group = useLiveQuery(GROUP_DETAIL, { id: groupId }, parseGroupDetail);

  return (
    <DataState result={group} label="this group">
      {(g) => {
        if (!g) {
          return (
            <EmptyState title="Group not found">
              It doesn&apos;t exist, or the indexer hasn&apos;t caught up yet.
            </EmptyState>
          );
        }
        const me = address?.toLowerCase();
        const myMembership = g.members.find((m) => m.address === me);
        const isActiveMember = myMembership?.active === true;
        const transfers = suggestedTransfers(g.members);
        const mine = me
          ? transfersInvolving(transfers, me)
          : { youPay: [], youReceive: [] };
        const canAct = canWrite && isActiveMember;

        return (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {g.name}
              </h1>
              <p className="text-sm text-muted">
                {plural(g.memberCount, "member")} ·{" "}
                {plural(g.expenseCount, "expense")} · total{" "}
                <Amount units={g.totalExpenseAmount} />
              </p>
            </div>

            {me && !isActiveMember && (
              <Notice tone="accent" title="You're not a member of this group">
                Only the group admin can add members. Share your address with
                them: <span className="font-mono break-all">{me}</span>
              </Notice>
            )}

            {myMembership && isActiveMember && (
              <Card aria-labelledby="my-balance">
                <h2 id="my-balance" className="text-sm text-muted">
                  Your balance in this group
                </h2>
                <p className="mt-1 text-2xl font-semibold">
                  <Amount units={myMembership.netBalance} signed />
                </p>
                <p className="text-xs text-muted">
                  {myMembership.netBalance > 0n
                    ? "Others owe you this much."
                    : myMembership.netBalance < 0n
                      ? "You owe this much in total."
                      : "You're settled up."}
                </p>
                {(mine.youPay.length > 0 || mine.youReceive.length > 0) && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {mine.youPay.map((t) => (
                      <li
                        key={t.to}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-1">
                          Pay{" "}
                          <AddressLabel address={t.to} me={me} names={names} />
                        </span>
                        <Amount units={t.amount} />
                      </li>
                    ))}
                    {mine.youReceive.map((t) => (
                      <li
                        key={t.from}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex items-center gap-1">
                          <AddressLabel
                            address={t.from}
                            me={me}
                            names={names}
                          />{" "}
                          pays you
                        </span>
                        <Amount units={t.amount} />
                      </li>
                    ))}
                  </ul>
                )}
                {/* A member always sees how to act: the buttons, or why they can't send yet
                    (locked after a reload, or view-only) with the one tap that fixes it. */}
                {!canAct && (
                  <div className="mt-4">
                    <WriteGate />
                  </div>
                )}
                {canAct && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <ButtonLink href={`/groups/${g.id}/expenses/new`}>
                      Add expense
                    </ButtonLink>
                    <ButtonLink
                      href={`/groups/${g.id}/settle`}
                      variant="secondary"
                    >
                      Settle up
                    </ButtonLink>
                  </div>
                )}
              </Card>
            )}

            <div
              role="tablist"
              aria-label="Group sections"
              className="grid grid-cols-4 gap-1 rounded-xl bg-surface p-1 text-sm"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`min-h-10 rounded-lg px-1 ${tab === t.id ? "bg-accent-bg font-medium text-accent" : "text-muted"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div
              role="tabpanel"
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
            >
              {tab === "balances" && (
                <BalanceBreakdown
                  members={g.members}
                  transfers={transfers}
                  me={me}
                  names={names}
                />
              )}
              {tab === "expenses" && (
                <Expenses
                  groupId={g.id}
                  me={me}
                  names={names}
                  undo={{
                    groupId: g.id,
                    admin: g.admin,
                    activeMembers: new Set(
                      g.members.filter((m) => m.active).map((m) => m.address),
                    ),
                    canAct,
                  }}
                />
              )}
              {tab === "settlements" && (
                <Settlements groupId={g.id} me={me} names={names} />
              )}
              {tab === "members" && (
                <div className="space-y-2">
                  <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
                    {g.members.map((m) => (
                      <li
                        key={m.address}
                        className="flex items-center justify-between gap-2 p-3 text-sm"
                      >
                        <AddressLabel
                          address={m.address}
                          me={me}
                          names={names}
                        />
                        <span className="flex gap-1">
                          {m.address === g.admin && (
                            <Badge tone="accent">Admin</Badge>
                          )}
                          {!m.active && <Badge>Left</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <ButtonLink
                    href={`/groups/${g.id}/members`}
                    variant="secondary"
                    className="w-full"
                  >
                    Invite &amp; manage members
                  </ButtonLink>
                </div>
              )}
            </div>
          </>
        );
      }}
    </DataState>
  );
}

function Expenses({
  groupId,
  me,
  names,
  undo,
}: {
  groupId: string;
  me?: string;
  names: Record<string, string>;
  undo: UndoContext;
}) {
  const [limit, setLimit] = useState(PAGE);
  const vars = useMemo(
    () => ({ id: groupId, limit: limit + 1, offset: 0 }),
    [groupId, limit],
  );
  const result = useLiveQuery(GROUP_EXPENSES, vars, parseExpenses);
  return (
    <DataState result={result} label="expenses">
      {(items) =>
        items.length === 0 ? (
          <EmptyState title="No expenses yet" />
        ) : (
          <>
            <ExpenseList
              items={items.slice(0, limit)}
              me={me}
              names={names}
              undo={undo}
            />
            {items.length > limit && (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => setLimit((l) => l + PAGE)}
              >
                Show more
              </Button>
            )}
          </>
        )
      }
    </DataState>
  );
}

function Settlements({
  groupId,
  me,
  names,
}: {
  groupId: string;
  me?: string;
  names: Record<string, string>;
}) {
  const [limit, setLimit] = useState(PAGE);
  const vars = useMemo(
    () => ({ id: groupId, limit: limit + 1, offset: 0 }),
    [groupId, limit],
  );
  const result = useLiveQuery(GROUP_SETTLEMENTS, vars, parseSettlements);
  return (
    <DataState result={result} label="settlements">
      {(items) =>
        items.length === 0 ? (
          <EmptyState title="No settlements yet" />
        ) : (
          <>
            <SettlementList
              items={items.slice(0, limit)}
              me={me}
              names={names}
            />
            {items.length > limit && (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => setLimit((l) => l + PAGE)}
              >
                Show more
              </Button>
            )}
          </>
        )
      }
    </DataState>
  );
}
