"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import { useIndexerHealth } from "@/hooks/useIndexerHealth";
import { shortAddress } from "@/lib/format";
import { Avatar, Badge } from "./ui";

/** Labels for anvil's dev accounts in local-demo mode. */
export function useDemoNames(): Record<string, string> {
  const { demoAccounts } = useAccount();
  return useMemo(
    () => Object.fromEntries(demoAccounts.map((a, i) => [a, `Demo ${i}`])),
    [demoAccounts],
  );
}

function IndexerPill() {
  const health = useIndexerHealth();
  const view = {
    checking: { tone: "neutral", text: "Checking indexer…" },
    synced: { tone: "positive", text: "Live" },
    behind: {
      tone: "warning",
      text: `Indexing · ${health.lagBlocks ?? "?"} blocks behind`,
    },
    "indexer-offline": { tone: "negative", text: "Indexer offline" },
    "rpc-offline": { tone: "negative", text: "Node offline" },
    "wrong-chain": { tone: "negative", text: "Indexer on wrong chain" },
  }[health.status] as {
    tone: "neutral" | "positive" | "warning" | "negative";
    text: string;
  };
  return (
    <span
      role="status"
      aria-live="polite"
      title={
        health.progressBlock !== undefined
          ? `Indexed to block ${health.progressBlock}`
          : undefined
      }
    >
      <Badge tone={view.tone}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
        {view.text}
      </Badge>
    </span>
  );
}

function AccountPicker() {
  const { config } = useApp();
  const {
    source,
    setSource,
    address,
    demoAccounts,
    accountsStatus,
    setAddress,
    passkey,
  } = useAccount();
  const names = useDemoNames();

  if (config.allowDemoAccounts && source === "demo") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="sr-only">Acting as</span>
          {address && <Avatar address={address} size={24} />}
          <select
            className="min-h-11 w-full max-w-72 min-w-0 rounded-xl border border-border bg-surface px-2 text-sm"
            value={address ?? ""}
            disabled={accountsStatus !== "ready"}
            onChange={(e) => {
              setAddress((e.target.value || undefined) as Address | undefined);
              setSource("demo");
            }}
          >
            <option value="">
              {accountsStatus === "loading"
                ? "Loading accounts…"
                : "Choose demo account"}
            </option>
            {demoAccounts.map((a) => (
              <option key={a} value={a}>
                {names[a]} · {shortAddress(a)}
              </option>
            ))}
          </select>
        </label>
        <Link
          href="/account"
          className="min-h-11 shrink-0 content-center rounded-xl px-2 text-sm text-accent"
        >
          Passkey
        </Link>
      </div>
    );
  }

  const status = passkey.state.status;
  const label =
    source === "passkey" && address
      ? status === "unlocked"
        ? "Passkey wallet"
        : status === "working"
          ? "Waiting for passkey…"
          : "Passkey wallet · locked"
      : source === "view" && address
        ? "Viewing"
        : undefined;
  return (
    <Link
      href="/account"
      className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm"
      data-testid="account-chip"
    >
      {address ? (
        <>
          <Avatar address={address} size={24} />
          <span className="truncate">
            {label} · {shortAddress(address)}
          </span>
          {source === "passkey" && status !== "unlocked" && (
            <Badge tone="warning">Locked</Badge>
          )}
        </>
      ) : (
        <span>Sign in with a passkey</span>
      )}
    </Link>
  );
}

function ModeBanner() {
  const { config } = useApp();
  if (config.mode === "local-demo") {
    return (
      <p className="rounded-xl bg-warning-bg px-3 py-2 text-xs text-warning">
        <strong>Local demo</strong> · anvil chain {config.chainId}. Tokens are a
        test MockToken, not real AUSD. Nothing here touches a public network.
      </p>
    );
  }
  return (
    <p className="rounded-xl bg-accent-bg px-3 py-2 text-xs text-accent">
      <strong>{config.label}</strong> · Sign in with a passkey wallet to send.
      Network fees are paid in MON from your wallet.
    </p>
  );
}

/**
 * Remounts page content when the active identity changes, so forms and transaction states from
 * one account can never be shown or reused under another.
 */
function IdentityScope({ children }: { children: ReactNode }) {
  const { source, address } = useAccount();
  return (
    <main
      key={`${source}:${address ?? "none"}`}
      className="flex flex-1 flex-col gap-4 pb-10"
    >
      {children}
    </main>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 -mx-4 space-y-2 bg-background/95 px-4 pt-1 pb-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="text-xl font-semibold tracking-tight">
            Tally
          </Link>
          <IndexerPill />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AccountPicker />
        </div>
        <ModeBanner />
      </header>
      <IdentityScope>{children}</IdentityScope>
    </>
  );
}
