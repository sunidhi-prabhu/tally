"use client";

import Link from "next/link";
import { useAccount } from "@/providers/AppProviders";
import { Button, Notice } from "./ui";

/** Explains why the current identity can't send, with the one action that fixes it. */
export function WriteGate() {
  const { canWrite, writeBlockedReason, source, passkey } = useAccount();
  if (canWrite) return null;
  const working = passkey.state.status === "working";
  const locked =
    source === "passkey" &&
    (passkey.state.status === "locked" || passkey.state.status === "error") &&
    passkey.wallet;
  return (
    <Notice tone="accent" role="status" title={writeBlockedReason}>
      {locked ? (
        <Button
          className="mt-2 min-h-10"
          onClick={() => void passkey.wallet?.unlock()}
          disabled={working}
        >
          {working ? "Waiting for passkey…" : "Unlock with passkey"}
        </Button>
      ) : (
        <Link href="/account" className="mt-1 inline-block underline">
          Account settings
        </Link>
      )}
    </Notice>
  );
}
