"use client";

import Link from "next/link";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import { useLiveQuery } from "@/hooks/useLiveQuery";
import { useTransaction } from "@/hooks/useTransaction";
import { GROUP_DETAIL, parseGroupDetail } from "@/lib/indexer/queries";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { DataState } from "@/components/DataState";
import { QrCode } from "@/components/QrCode";
import { TxStatus } from "@/components/TxStatus";
import { useDemoNames } from "@/components/AppShell";
import {
  AddressLabel,
  Amount,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Notice,
  TextField,
} from "@/components/ui";

export function Members({ groupId }: { groupId: string }) {
  const { config } = useApp();
  const { address, canWrite: accountCanWrite } = useAccount();
  const names = useDemoNames();
  const group = useLiveQuery(GROUP_DETAIL, { id: groupId }, parseGroupDetail);
  const tx = useTransaction();
  const [newMember, setNewMember] = useState("");
  const [pending, setPending] = useState<
    { kind: "add" | "remove" | "leave"; member: string } | undefined
  >();
  const [copied, setCopied] = useState(false);
  // Native share sheet on phones; hidden where the browser has none.
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  // Rendered only after indexed data loads in the browser, so window is available.
  const link =
    typeof window === "undefined"
      ? `/groups/${groupId}`
      : `${window.location.origin}/groups/${groupId}`;

  async function run() {
    const action = pending;
    setPending(undefined);
    if (!action || !address) return;
    const sender = getAddress(address);
    const call =
      action.kind === "leave"
        ? ({
            address: config.ledgerAddress,
            abi: tallyLedgerAbi,
            functionName: "leaveGroup",
            args: [BigInt(groupId)],
          } as const)
        : ({
            address: config.ledgerAddress,
            abi: tallyLedgerAbi,
            functionName: action.kind === "add" ? "addMember" : "removeMember",
            args: [BigInt(groupId), getAddress(action.member)],
          } as const);
    const label =
      action.kind === "leave"
        ? "Leave group"
        : action.kind === "add"
          ? "Add member"
          : "Remove member";
    const ok = await tx.run(label, { sender, call });
    if (ok && action.kind === "add") setNewMember("");
  }

  return (
    <>
      <Link href={`/groups/${groupId}`} className="text-sm text-accent">
        ← Back to group
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      <DataState result={group} label="members">
        {(g) => {
          if (!g) return <EmptyState title="Group not found" />;
          const me = address?.toLowerCase();
          const isAdmin = me === g.admin;
          const mine = g.members.find((m) => m.address === me && m.active);
          const canWrite = accountCanWrite && !!me;
          const trimmed = newMember.trim();
          const memberError =
            trimmed === ""
              ? undefined
              : !isAddress(trimmed)
                ? "Enter a full 0x address."
                : g.members.some(
                      (m) => m.active && m.address === trimmed.toLowerCase(),
                    )
                  ? "Already a member."
                  : undefined;
          return (
            <>
              <Card aria-labelledby="invite-heading" className="space-y-3">
                <h2 id="invite-heading" className="font-semibold">
                  Invite someone
                </h2>
                <p className="text-sm text-muted">
                  Tally groups have no self-join or invite codes: the admin adds
                  each member by address. Share this link so people can see the
                  group and send the admin their address.
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    aria-label="Group link"
                    value={link}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
                  />
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void navigator.clipboard?.writeText(link).then(
                        () => setCopied(true),
                        () => setCopied(false),
                      )
                    }
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <QrCode
                  value={link}
                  label={`QR code for the ${g.name} group link`}
                />
                {canShare && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() =>
                      void navigator
                        .share({ title: `Join ${g.name} on Tally`, url: link })
                        .catch(() => undefined)
                    }
                  >
                    Share link
                  </Button>
                )}
                {isAdmin && canWrite ? (
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (isAddress(trimmed) && !memberError)
                        setPending({ kind: "add", member: trimmed });
                    }}
                  >
                    <TextField
                      label="Add member by address"
                      placeholder="0x…"
                      autoComplete="off"
                      spellCheck={false}
                      value={newMember}
                      onChange={(e) => setNewMember(e.target.value)}
                      error={memberError}
                    />
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!isAddress(trimmed) || !!memberError}
                    >
                      Add member
                    </Button>
                  </form>
                ) : (
                  <Notice tone="accent">
                    Only the admin (
                    <AddressLabel
                      address={g.admin}
                      me={me}
                      names={names}
                      withAvatar={false}
                    />
                    ) can add members.
                  </Notice>
                )}
                <TxStatus
                  state={tx.state}
                  signerHint="The local anvil node signs for demo accounts."
                />
              </Card>

              <ul
                className="divide-y divide-border rounded-2xl border border-border bg-surface"
                aria-label="Members"
              >
                {g.members.map((m) => (
                  <li
                    key={m.address}
                    className="flex items-center justify-between gap-2 p-3 text-sm"
                  >
                    <span className="min-w-0">
                      <AddressLabel address={m.address} me={me} names={names} />
                      <span className="mt-1 flex gap-1">
                        {m.address === g.admin && (
                          <Badge tone="accent">Admin</Badge>
                        )}
                        {!m.active && <Badge>Left</Badge>}
                      </span>
                    </span>
                    {m.active && (
                      <Amount units={m.netBalance} signed className="text-xs" />
                    )}
                    {isAdmin &&
                      canWrite &&
                      m.active &&
                      m.address !== g.admin && (
                        <Button
                          variant="ghost"
                          className="min-h-9 px-2"
                          disabled={m.netBalance !== 0n}
                          title={
                            m.netBalance !== 0n
                              ? "Only members with a zero balance can be removed"
                              : undefined
                          }
                          onClick={() =>
                            setPending({ kind: "remove", member: m.address })
                          }
                        >
                          Remove
                        </Button>
                      )}
                  </li>
                ))}
              </ul>
              {isAdmin && (
                <p className="text-xs text-muted">
                  Members can only be removed once their balance is exactly
                  zero.
                </p>
              )}

              {mine && !isAdmin && canWrite && (
                <Button
                  variant="secondary"
                  disabled={mine.netBalance !== 0n}
                  onClick={() =>
                    setPending({ kind: "leave", member: mine.address })
                  }
                >
                  {mine.netBalance === 0n
                    ? "Leave group"
                    : "Settle up before leaving"}
                </Button>
              )}

              <ConfirmDialog
                open={pending !== undefined}
                title={
                  pending?.kind === "add"
                    ? "Add this member?"
                    : pending?.kind === "remove"
                      ? "Remove this member?"
                      : "Leave this group?"
                }
                confirmLabel={
                  pending?.kind === "add"
                    ? "Add"
                    : pending?.kind === "remove"
                      ? "Remove"
                      : "Leave"
                }
                onCancel={() => setPending(undefined)}
                onConfirm={() => void run()}
              >
                {pending && pending.kind !== "leave" && (
                  <p className="font-mono text-xs break-all">
                    {pending.member}
                  </p>
                )}
                {pending?.kind === "add" && (
                  <p>
                    They&apos;ll be able to add expenses and settle in this
                    group.
                  </p>
                )}
                {pending?.kind === "leave" && (
                  <p>You can be re-added later by the admin.</p>
                )}
              </ConfirmDialog>
            </>
          );
        }}
      </DataState>
    </>
  );
}
