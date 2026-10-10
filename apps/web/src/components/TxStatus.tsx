"use client";

import type { TxState } from "@/lib/tx/machine";
import { shortHash } from "@/lib/format";
import { Notice } from "./ui";

/** Announces each stage of a transaction. Never says "done" before a successful receipt. */
export function TxStatus({
  state,
  signerHint,
}: {
  state: TxState;
  signerHint?: string;
}) {
  if (state.status === "idle") return null;
  const hash = "hash" in state ? state.hash : undefined;
  const body = (() => {
    switch (state.status) {
      case "preparing":
        return {
          tone: "neutral" as const,
          title: `${state.label}: checking…`,
          text: "Simulating the call before asking to sign.",
        };
      case "awaiting-signature":
        return {
          tone: "accent" as const,
          title: `${state.label}: waiting for signature`,
          text: signerHint ?? "Confirm in your wallet.",
        };
      case "pending":
        return {
          tone: "warning" as const,
          title: `${state.label}: submitted, not confirmed yet`,
          text: "Waiting for the transaction to be included in a block.",
        };
      case "confirmed":
        return {
          tone: "positive" as const,
          title: `${state.label}: confirmed`,
          text: `Included in block ${state.blockNumber.toString()}.`,
        };
      case "reverted":
        return {
          tone: "negative" as const,
          title: `${state.label}: reverted`,
          text: state.message,
        };
      case "failed":
        return {
          tone: "negative" as const,
          title: `${state.label}: not completed`,
          text: state.message,
        };
    }
  })();
  return (
    <div aria-live="polite" data-tx-status={state.status}>
      <Notice
        tone={body.tone}
        title={body.title}
        role={
          state.status === "failed" || state.status === "reverted"
            ? "alert"
            : "status"
        }
      >
        <p>{body.text}</p>
        {hash && (
          <p className="mt-1 font-mono text-xs break-all" title={hash}>
            Tx {shortHash(hash)}
            <span className="sr-only"> full hash {hash}</span>
          </p>
        )}
      </Notice>
    </div>
  );
}
