"use client";

import { useState } from "react";
import { getAddress } from "viem";
import type { ExpenseRow } from "@/lib/indexer/queries";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { shortAddress } from "@/lib/format";
import { useTransaction } from "@/hooks/useTransaction";
import { useAccount, useApp } from "@/providers/AppProviders";
import { TxStatus } from "./TxStatus";
import { Amount, Button, ButtonLink, ConfirmDialog, Notice } from "./ui";

/** Who may undo, from the group's indexed state. */
export interface UndoContext {
  groupId: string;
  admin: string;
  /** Lowercase addresses of current members. */
  activeMembers: ReadonlySet<string>;
  /** The viewer can sign right now and is an active member. */
  canAct: boolean;
}

/**
 * Undo for one expense (payer or group admin only). Undoing reverses the expense's balance
 * changes on-chain; the expense stays in the history, marked undone. Afterwards the user can
 * add a corrected copy, prefilled from this one, which is how an expense is "edited".
 */
export function UndoExpense({
  expense,
  me,
  context,
}: {
  expense: ExpenseRow;
  me: string | undefined;
  context: UndoContext;
}) {
  const { config } = useApp();
  const { address } = useAccount();
  const tx = useTransaction();
  const [confirming, setConfirming] = useState(false);

  const correctedHref = `/groups/${context.groupId}/expenses/new?from=${encodeURIComponent(expense.id)}`;
  const done = tx.state.status === "confirmed";
  if (expense.undone || done) {
    const mine = me === expense.payer;
    return mine || done ? (
      <div className="mt-2 space-y-2">
        <TxStatus state={tx.state} />
        <ButtonLink href={correctedHref} variant="secondary" className="w-full">
          Add corrected version
        </ButtonLink>
      </div>
    ) : null;
  }

  const allowed =
    me !== undefined && (me === expense.payer || me === context.admin);
  if (!allowed || !context.canAct) return null;

  // The contract refuses while anyone involved has left: the undo would leave them a balance.
  const departed = [
    expense.payer,
    ...expense.shares.map((s) => s.member),
  ].filter((m) => !context.activeMembers.has(m));
  if (departed.length > 0) {
    return (
      <Notice tone="warning" title="Can't undo yet">
        {[...new Set(departed)].map(shortAddress).join(", ")} left the group.
        The admin must add them back before this expense can be undone.
      </Notice>
    );
  }

  const busy =
    tx.state.status === "preparing" ||
    tx.state.status === "awaiting-signature" ||
    tx.state.status === "pending";

  async function undo() {
    setConfirming(false);
    if (!address) return;
    await tx.run("Undo expense", {
      sender: getAddress(address),
      call: {
        address: config.ledgerAddress,
        abi: tallyLedgerAbi,
        functionName: "undoExpense",
        args: [
          BigInt(context.groupId),
          expense.expenseId,
          getAddress(expense.payer),
          expense.amount,
          expense.shares.map((s) => getAddress(s.member)),
          expense.shares.map((s) => s.amount),
        ],
      },
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <TxStatus state={tx.state} />
      <Button
        variant="secondary"
        className="w-full"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {busy ? "Working…" : "Undo expense"}
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Undo this expense?"
        confirmLabel="Undo expense"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void undo()}
      >
        <p>
          “{expense.description || "Expense"}” ·{" "}
          <Amount units={expense.amount} />
        </p>
        <p>
          Everyone&apos;s balances go back to how they would be without it. It
          stays in the history, marked as undone. This can&apos;t be reversed,
          but you can add a corrected version afterwards.
        </p>
      </ConfirmDialog>
    </div>
  );
}
