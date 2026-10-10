"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { decodeEventLog, getAddress, isAddress } from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import { useTransaction } from "@/hooks/useTransaction";
import { useWaitForIndexed } from "@/hooks/useWaitForIndexed";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { TxStatus } from "@/components/TxStatus";
import { WriteGate } from "@/components/WriteGate";
import { useDemoNames } from "@/components/AppShell";
import {
  AddressLabel,
  Button,
  ConfirmDialog,
  Notice,
  TextField,
} from "@/components/ui";

export function CreateGroup() {
  const { config } = useApp();
  const { address, demoAccounts, canWrite, source } = useAccount();
  const names = useDemoNames();
  const router = useRouter();
  const tx = useTransaction();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [createdId, setCreatedId] = useState<string | undefined>(undefined);
  const indexed = useWaitForIndexed(
    createdId ? { groupId: createdId } : undefined,
  );

  useEffect(() => {
    if (indexed === "indexed" && createdId) router.push(`/groups/${createdId}`);
  }, [indexed, createdId, router]);

  if (!canWrite || !address) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">New group</h1>
        <WriteGate />
      </>
    );
  }

  const me = address.toLowerCase();
  const nameBytes = new TextEncoder().encode(name.trim()).length;
  const nameError = !touched
    ? undefined
    : nameBytes === 0
      ? "Give the group a name."
      : nameBytes > 64
        ? "Keep it under 64 bytes."
        : undefined;
  const draftTrimmed = draft.trim();
  const draftError =
    draftTrimmed === ""
      ? undefined
      : !isAddress(draftTrimmed)
        ? "Enter a full 0x address."
        : draftTrimmed.toLowerCase() === me
          ? "You're added automatically."
          : members.includes(draftTrimmed.toLowerCase())
            ? "Already added."
            : undefined;
  const busy = ["preparing", "awaiting-signature", "pending"].includes(
    tx.state.status,
  );

  async function create() {
    setConfirming(false);
    const account = getAddress(me);
    const call = {
      address: config.ledgerAddress,
      abi: tallyLedgerAbi,
      functionName: "createGroup",
      args: [name.trim(), members.map((m) => getAddress(m))],
    } as const;
    const receipt = await tx.run("Create group", { sender: account, call });
    if (!receipt) return;
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({
          abi: tallyLedgerAbi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "GroupCreated")
          setCreatedId(event.args.groupId.toString());
      } catch {
        // not a ledger event
      }
    }
  }

  return (
    <>
      <Link href="/" className="text-sm text-accent">
        ← Home
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New group</h1>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (nameBytes > 0 && nameBytes <= 64) setConfirming(true);
        }}
      >
        <fieldset
          disabled={busy || createdId !== undefined}
          className="space-y-4"
        >
          <TextField
            label="Group name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekend trip"
            error={nameError}
          />
          <div className="space-y-2">
            <TextField
              label="Add members (optional)"
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              error={draftError}
              hint="You become the admin. Only you can add or remove members later."
            />
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={!isAddress(draftTrimmed) || !!draftError}
              onClick={() => {
                setMembers((m) => [...m, draftTrimmed.toLowerCase()]);
                setDraft("");
              }}
            >
              Add to list
            </Button>
            {source === "demo" && demoAccounts.length > 0 && (
              <div
                className="flex flex-wrap gap-1"
                aria-label="Quick add demo accounts"
              >
                {demoAccounts
                  .filter((a) => a !== me && !members.includes(a))
                  .slice(0, 5)
                  .map((a) => (
                    <button
                      type="button"
                      key={a}
                      className="min-h-9 rounded-full border border-border px-3 text-xs"
                      onClick={() => setMembers((m) => [...m, a])}
                    >
                      + {names[a]}
                    </button>
                  ))}
              </div>
            )}
            {members.length > 0 && (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
                {members.map((m) => (
                  <li
                    key={m}
                    className="flex items-center justify-between gap-2 p-3 text-sm"
                  >
                    <AddressLabel address={m} me={me} names={names} />
                    <button
                      type="button"
                      className="text-xs text-negative underline"
                      onClick={() =>
                        setMembers((list) => list.filter((x) => x !== m))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </fieldset>
        <TxStatus
          state={tx.state}
          signerHint="The local anvil node signs for demo accounts."
        />
        {createdId && (
          <Notice
            tone={indexed === "timeout" ? "warning" : "positive"}
            role="status"
          >
            Group #{createdId} created on-chain.{" "}
            {indexed === "timeout"
              ? "The indexer hasn't caught up yet."
              : "Opening it once indexed…"}
          </Notice>
        )}
        {!createdId && (
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Working…" : "Create group"}
          </Button>
        )}
      </form>
      <ConfirmDialog
        open={confirming}
        title="Create this group?"
        confirmLabel="Create"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void create()}
      >
        <p>
          “{name.trim()}” with you as admin
          {members.length > 0
            ? ` and ${members.length} other member${members.length === 1 ? "" : "s"}`
            : ""}
          .
        </p>
      </ConfirmDialog>
    </>
  );
}
