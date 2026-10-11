"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getAddress, type Address, type Hex } from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import { useLiveQuery } from "@/hooks/useLiveQuery";
import { useTransaction } from "@/hooks/useTransaction";
import { useFreshOnReturn } from "@/hooks/useFreshOnReturn";
import { useWaitForIndexed } from "@/hooks/useWaitForIndexed";
import { GROUP_DETAIL, parseGroupDetail } from "@/lib/indexer/queries";
import {
  buildExpense,
  remainingToAssign,
  type SplitMode,
} from "@/lib/expenseForm";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { randomId } from "@/lib/ids";
import { shortAddress } from "@/lib/format";
import { DataState } from "@/components/DataState";
import { WriteGate } from "@/components/WriteGate";
import { TxStatus } from "@/components/TxStatus";
import { useDemoNames } from "@/components/AppShell";
import {
  AddressLabel,
  Amount,
  Button,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  Notice,
  TextField,
} from "@/components/ui";

export function NewExpense({ groupId }: { groupId: string }) {
  const group = useLiveQuery(GROUP_DETAIL, { id: groupId }, parseGroupDetail);
  const visit = useFreshOnReturn();
  return (
    <>
      <Link href={`/groups/${groupId}`} className="text-sm text-accent">
        ← Back to group
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Add expense</h1>
      <DataState result={group} label="group members">
        {(g) =>
          g ? (
            <ExpenseForm
              key={visit}
              groupId={groupId}
              members={g.members.filter((m) => m.active).map((m) => m.address)}
            />
          ) : (
            <EmptyState title="Group not found" />
          )
        }
      </DataState>
    </>
  );
}

function ExpenseForm({
  groupId,
  members,
}: {
  groupId: string;
  members: string[];
}) {
  const { config } = useApp();
  const { address, canWrite, signableAccounts, source } = useAccount();
  const names = useDemoNames();
  const tx = useTransaction();

  const signable = members.filter((m) =>
    signableAccounts.includes(m as Address),
  );
  const [payer, setPayer] = useState<string>(
    address && signable.includes(address) ? address : (signable[0] ?? ""),
  );
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [participants, setParticipants] = useState<string[]>(members);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(
    {},
  );
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submittedId, setSubmittedId] = useState<Hex | undefined>(undefined);

  const result = useMemo(
    () =>
      buildExpense({
        description,
        amountText,
        splitMode,
        participants,
        customAmounts,
        members,
      }),
    [description, amountText, splitMode, participants, customAmounts, members],
  );
  const remaining =
    splitMode === "custom"
      ? remainingToAssign(amountText, customAmounts)
      : undefined;
  const errors = showErrors && !result.ok ? result.errors : {};
  const indexed = useWaitForIndexed(
    submittedId && tx.state.status === "confirmed"
      ? { expenseId: `${groupId}-${submittedId.toLowerCase()}` }
      : undefined,
  );

  if (!canWrite) return <WriteGate />;
  if (signable.length === 0) {
    return (
      <Notice tone="warning">
        {source === "passkey"
          ? `Your passkey wallet isn't a member of this group. Ask the admin to add ${address ?? "your address"}.`
          : "None of this group's members is a local demo account you can sign as."}
      </Notice>
    );
  }

  const busy =
    tx.state.status === "preparing" ||
    tx.state.status === "awaiting-signature" ||
    tx.state.status === "pending";
  const done = tx.state.status === "confirmed";

  async function submit() {
    setConfirming(false);
    if (!result.ok) return;
    const { payload } = result;
    const expenseId = randomId();
    setSubmittedId(expenseId);
    const participantsArg = payload.participants.map((p) => getAddress(p));
    const call =
      payload.splitMode === "equal"
        ? ({
            address: config.ledgerAddress,
            abi: tallyLedgerAbi,
            functionName: "recordEqualExpense",
            args: [
              BigInt(groupId),
              expenseId,
              payload.amount,
              participantsArg,
              payload.description,
            ],
          } as const)
        : ({
            address: config.ledgerAddress,
            abi: tallyLedgerAbi,
            functionName: "recordCustomExpense",
            args: [
              BigInt(groupId),
              expenseId,
              payload.amount,
              participantsArg,
              payload.shares,
              payload.description,
            ],
          } as const);
    // The contract records the sender as the payer, so the payer must be the signer.
    await tx.run("Add expense", { sender: getAddress(payer), call });
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setShowErrors(true);
        if (result.ok) setConfirming(true);
      }}
    >
      <fieldset disabled={busy || done} className="space-y-4">
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dinner, taxi, groceries…"
          maxLength={280}
          error={errors.description}
        />
        <TextField
          label="Amount"
          inputMode="decimal"
          autoComplete="off"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="0.00"
          suffix="AUSD"
          hint="Up to 6 decimal places."
          error={errors.amount}
        />

        <div className="space-y-1">
          <label htmlFor="payer" className="block text-sm font-medium">
            Paid by
          </label>
          <select
            id="payer"
            className="min-h-11 w-full rounded-xl border border-border bg-surface px-3"
            value={payer}
            onChange={(e) => setPayer(e.target.value)}
          >
            {signable.map((m) => (
              <option key={m} value={m}>
                {m === address ? "You" : (names[m] ?? m)} ({m.slice(0, 6)}…
                {m.slice(-4)})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            The contract records whoever sends the transaction as the payer, so
            the payer signs.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Split</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(["equal", "custom"] as const).map((mode) => (
              <label
                key={mode}
                className={`flex min-h-11 items-center justify-center rounded-xl border text-sm ${
                  splitMode === mode
                    ? "border-accent bg-accent-bg text-accent"
                    : "border-border bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="split"
                  value={mode}
                  checked={splitMode === mode}
                  onChange={() => setSplitMode(mode)}
                  className="sr-only"
                />
                {mode === "equal" ? "Equally" : "Custom amounts"}
              </label>
            ))}
          </div>

          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {members.map((m) => {
              const share = result.preview.find((s) => s.member === m)?.amount;
              return (
                <li
                  key={m}
                  className="flex items-center justify-between gap-2 p-3 text-sm"
                >
                  {splitMode === "equal" ? (
                    <>
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[var(--accent)]"
                          checked={participants.includes(m)}
                          onChange={(e) =>
                            setParticipants((p) =>
                              e.target.checked
                                ? [...p, m]
                                : p.filter((x) => x !== m),
                            )
                          }
                        />
                        <AddressLabel address={m} me={address} names={names} />
                      </label>
                      {share !== undefined && (
                        <Amount units={share} className="text-muted" />
                      )}
                    </>
                  ) : (
                    <>
                      <AddressLabel address={m} me={address} names={names} />
                      <span className="w-32">
                        <TextField
                          label={`Share for ${m === address ? "you" : (names[m] ?? shortAddress(m))}`}
                          hideLabel
                          inputMode="decimal"
                          autoComplete="off"
                          value={customAmounts[m] ?? ""}
                          onChange={(e) =>
                            setCustomAmounts((c) => ({
                              ...c,
                              [m]: e.target.value,
                            }))
                          }
                          placeholder="0.00"
                          error={errors[`share:${m}`]}
                        />
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {splitMode === "equal" && (
            <p className="text-xs text-muted">
              Leftover fractions of a cent go to the lowest addresses first,
              exactly as the contract does.
            </p>
          )}
          {splitMode === "custom" && remaining !== undefined && (
            <p
              className={`text-sm ${remaining === 0n ? "text-positive" : "text-warning"}`}
              aria-live="polite"
            >
              {remaining === 0n ? (
                "Shares add up to the amount."
              ) : remaining > 0n ? (
                <>
                  <Amount units={remaining} /> left to assign
                </>
              ) : (
                <>
                  <Amount units={-remaining} /> over the amount
                </>
              )}
            </p>
          )}
          {errors.split && (
            <p className="text-sm text-negative" role="alert">
              {errors.split}
            </p>
          )}
        </fieldset>
      </fieldset>

      <TxStatus
        state={tx.state}
        signerHint="The local anvil node signs for demo accounts."
      />
      {done && (
        <Notice
          tone={indexed === "indexed" ? "positive" : "neutral"}
          role="status"
        >
          {indexed === "indexed"
            ? "Balances are updated."
            : indexed === "timeout"
              ? "Confirmed on-chain, but the indexer hasn't caught up yet. Balances will update when it does."
              : "Confirmed on-chain. Waiting for the indexer to update balances…"}
        </Notice>
      )}

      {done ? (
        <ButtonLink href={`/groups/${groupId}`} className="w-full">
          Back to group
        </ButtonLink>
      ) : (
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Working…" : "Review expense"}
        </Button>
      )}

      {result.ok && (
        <ConfirmDialog
          open={confirming}
          title="Add this expense?"
          confirmLabel="Add expense"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void submit()}
        >
          <p>
            “{result.payload.description}” ·{" "}
            <Amount units={result.payload.amount} />
          </p>
          <p>
            Paid by{" "}
            <AddressLabel
              address={payer}
              me={address}
              names={names}
              withAvatar={false}
            />
            , split{" "}
            {result.payload.splitMode === "equal"
              ? "equally"
              : "with custom amounts"}
            :
          </p>
          <ul className="space-y-1">
            {result.preview.map((s) => (
              <li key={s.member} className="flex justify-between gap-2">
                <AddressLabel
                  address={s.member}
                  me={address}
                  names={names}
                  withAvatar={false}
                />
                <Amount units={s.amount} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            This is recorded on-chain and can&apos;t be edited later.
          </p>
        </ConfirmDialog>
      )}
    </form>
  );
}
