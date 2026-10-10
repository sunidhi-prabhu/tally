"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import {
  detectPasskeySupport,
  type PasskeySupport,
} from "@/lib/passkey/support";
import { DEFAULT_IDLE_MS } from "@/lib/passkey/wallet";
import { fundLocalTestMon } from "@/lib/chain";
import { formatNative, shortAddress } from "@/lib/format";
import { useDemoNames } from "@/components/AppShell";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Notice,
  TextField,
} from "@/components/ui";

export function AccountScreen() {
  const { config } = useApp();
  return (
    <>
      <Link href="/" className="text-sm text-accent">
        ← Home
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
      <PasskeyCard />
      <Limitations />
      {config.allowDemoAccounts && <DemoAccounts />}
      <ViewOnly />
    </>
  );
}

function usePasskeySupport(): PasskeySupport | undefined {
  const [support, setSupport] = useState<PasskeySupport | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    detectPasskeySupport().then((s) => !cancelled && setSupport(s));
    return () => {
      cancelled = true;
    };
  }, []);
  return support;
}

function useNativeBalance(
  address: Address | undefined,
): [bigint | undefined, () => void] {
  const { publicClient } = useApp();
  const [balance, setBalance] = useState<bigint | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    publicClient.getBalance({ address }).then(
      (b) => !cancelled && setBalance(b),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [address, publicClient, nonce]);
  return [address ? balance : undefined, () => setNonce((n) => n + 1)];
}

function PasskeyCard() {
  const { config, chain, publicClient } = useApp();
  const { passkey, source, setSource } = useAccount();
  const support = usePasskeySupport();
  const [label, setLabel] = useState("Tally wallet");
  const [copied, setCopied] = useState(false);
  const [funding, setFunding] = useState<"idle" | "working" | "failed">("idle");
  const state = passkey.state;
  const address = "address" in state ? state.address : undefined;
  const [native, refreshNative] = useNativeBalance(address);
  const wallet = passkey.wallet;

  async function create() {
    const result = await wallet?.create(label.trim() || "Tally wallet");
    if (result?.status === "unlocked") setSource("passkey");
  }
  async function signIn() {
    const result = await wallet?.signIn();
    if (result?.status === "unlocked") setSource("passkey");
  }
  async function unlock() {
    const result = await wallet?.unlock();
    if (result?.status === "unlocked") setSource("passkey");
  }
  async function addTestMon() {
    if (!address) return;
    setFunding("working");
    try {
      await fundLocalTestMon(
        config,
        chain,
        publicClient,
        address as Address,
        10n ** 18n,
      );
      setFunding("idle");
      refreshNative();
    } catch {
      setFunding("failed");
    }
  }

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h2 id="passkey-heading" className="font-semibold">
        Passkey wallet
      </h2>
      {state.status === "unlocked" && <Badge tone="positive">Unlocked</Badge>}
      {state.status === "locked" && <Badge tone="warning">Locked</Badge>}
      {source === "passkey" && address && <Badge tone="accent">In use</Badge>}
    </div>
  );

  if (passkey.unavailableReason) {
    return (
      <Card aria-labelledby="passkey-heading" className="space-y-3">
        {header}
        <Notice
          tone="negative"
          role="alert"
          title="Passkeys aren't available on this domain"
        >
          {passkey.unavailableReason}
        </Notice>
      </Card>
    );
  }
  if (!support || !wallet) {
    return (
      <Card aria-labelledby="passkey-heading" className="space-y-3">
        {header}
        <p role="status" className="text-sm text-muted">
          Checking passkey support…
        </p>
      </Card>
    );
  }
  if (support.status === "unsupported" && state.status === "signed-out") {
    return (
      <Card aria-labelledby="passkey-heading" className="space-y-3">
        {header}
        <Notice
          tone="warning"
          role="alert"
          title="This browser can't create a passkey wallet"
        >
          {support.reason}
        </Notice>
        <p className="text-sm text-muted">
          You can still view any address read-only below.
        </p>
      </Card>
    );
  }

  const working = state.status === "working";
  return (
    <Card aria-labelledby="passkey-heading" className="space-y-4">
      {header}

      {address && (
        <div className="flex items-center gap-3 rounded-xl bg-background p-3">
          <Avatar address={address} size={36} />
          <div className="min-w-0 flex-1">
            <p
              className="font-mono text-sm break-all"
              data-testid="passkey-address"
            >
              {address}
            </p>
            <p className="text-xs text-muted">
              {native === undefined
                ? "Balance …"
                : `${formatNative(native, chain.nativeCurrency.symbol)} for network fees`}
            </p>
          </div>
          <Button
            variant="ghost"
            className="min-h-9 px-2"
            onClick={() =>
              void navigator.clipboard?.writeText(address).then(
                () => setCopied(true),
                () => undefined,
              )
            }
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      <div aria-live="polite" role="status">
        {working && (
          <Notice tone="accent" title="Waiting for your passkey…">
            Confirm with Face ID, Touch ID or your device PIN in the browser
            prompt. Cancel it there to stop.
          </Notice>
        )}
        {state.status === "error" && (
          <Notice
            tone={state.failure.kind === "cancelled" ? "neutral" : "negative"}
            title={
              state.failure.kind === "cancelled"
                ? "Cancelled"
                : "That didn't work"
            }
          >
            {state.failure.message}
          </Notice>
        )}
        {state.status === "locked" && (
          <Notice tone="warning" title="Locked">
            {state.reason === "idle"
              ? "Locked after inactivity. "
              : state.reason === "reload"
                ? "Your wallet locks whenever the page reloads. "
                : "You locked your wallet. "}
            Unlock with your passkey to send transactions.
          </Notice>
        )}
      </div>

      {/* No known wallet yet: keep onboarding visible (disabled while a prompt is open). */}
      {!address ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Create a wallet secured by a passkey on this device, or sign in with
            one you already made for Tally (it syncs through iCloud Keychain,
            Google Password Manager or 1Password).
          </p>
          <TextField
            label="Name for your passkey"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            hint="Shown in your password manager. Not stored by Tally."
            maxLength={64}
          />
          <Button
            className="w-full"
            onClick={() => void create()}
            disabled={working}
          >
            Create passkey wallet
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => void signIn()}
            disabled={working}
          >
            Sign in with an existing passkey
          </Button>
          {support.status === "supported" && support.prf === "unknown" && (
            <p className="text-xs text-muted">
              Your browser can&apos;t tell in advance whether its passkeys
              support wallet keys (PRF). If creation fails, try iCloud Keychain,
              Google Password Manager or 1Password.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          {(state.status === "locked" || state.status === "error") && (
            <Button
              className="w-full"
              onClick={() => void unlock()}
              disabled={working}
            >
              Unlock with passkey
            </Button>
          )}
          {state.status === "unlocked" && source !== "passkey" && (
            <Button className="w-full" onClick={() => setSource("passkey")}>
              Use this wallet
            </Button>
          )}
          {state.status === "unlocked" && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => wallet.lock("manual")}
            >
              Lock now
            </Button>
          )}
          {state.status !== "working" && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => void signIn()}
              disabled={working}
            >
              Switch to another passkey
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full text-negative"
            onClick={() => {
              wallet.signOut();
              if (source === "passkey")
                setSource(config.allowDemoAccounts ? "demo" : "view");
            }}
          >
            Sign out and forget on this device
          </Button>
          {state.status === "unlocked" && (
            <p className="text-center text-xs text-muted">
              Locks automatically after {Math.round(DEFAULT_IDLE_MS / 60_000)}{" "}
              minutes without use.
            </p>
          )}
        </div>
      )}

      {address &&
        config.mode === "local-demo" &&
        native !== undefined &&
        native < 10n ** 16n && (
          <Notice tone="warning" title="This wallet has no MON for fees">
            <Button
              variant="secondary"
              className="mt-2 min-h-9"
              onClick={() => void addTestMon()}
              disabled={funding === "working"}
            >
              {funding === "working" ? "Adding…" : "Add 1 test MON"}
            </Button>
            <span className="mt-1 block text-xs">
              Local anvil only (dev-only anvil_setBalance).{" "}
              {funding === "failed" && "That didn't work; is anvil running?"}
            </span>
          </Notice>
        )}
    </Card>
  );
}

function Limitations() {
  return (
    <Card aria-labelledby="limits-heading" className="space-y-2 text-sm">
      <h2 id="limits-heading" className="font-semibold">
        What you should know
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        <li>
          <strong className="text-foreground">You own this wallet.</strong>{" "}
          It&apos;s a regular account whose key is derived from your passkey
          (via Mera). Tally never sees or stores the key; it exists only in this
          tab&apos;s memory while unlocked.
        </li>
        <li>
          <strong className="text-foreground">
            Recovery depends on your passkey.
          </strong>{" "}
          Signing in with the same passkey on another device (synced via iCloud
          Keychain, Google Password Manager or 1Password) gives the same wallet.
          If you delete the passkey, Tally can&apos;t recover the wallet or its
          funds.
        </li>
        <li>
          <strong className="text-foreground">You pay network fees.</strong>{" "}
          This is not a smart account and fees are not sponsored. Keep some MON
          in the wallet.
        </li>
        <li>
          <strong className="text-foreground">
            Each passkey is a different wallet.
          </strong>{" "}
          Creating a new passkey creates a new, empty wallet.
        </li>
      </ul>
    </Card>
  );
}

function DemoAccounts() {
  const { source, setSource, demoAccounts, address, setAddress } = useAccount();
  const names = useDemoNames();
  return (
    <Card aria-labelledby="demo-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="demo-heading" className="font-semibold">
          Local demo accounts
        </h2>
        {source === "demo" && <Badge tone="accent">In use</Badge>}
      </div>
      <p className="text-sm text-muted">
        anvil&apos;s built-in dev accounts, signed by the local node. Test only;
        they don&apos;t exist on any real network.
      </p>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Demo account</span>
        <select
          className="min-h-11 w-full rounded-xl border border-border bg-surface px-2"
          value={source === "demo" ? (address ?? "") : ""}
          onChange={(e) => {
            setAddress((e.target.value || undefined) as Address | undefined);
            setSource("demo");
          }}
        >
          <option value="">Choose…</option>
          {demoAccounts.map((a) => (
            <option key={a} value={a}>
              {names[a]} · {shortAddress(a)}
            </option>
          ))}
        </select>
      </label>
    </Card>
  );
}

function ViewOnly() {
  const { source, setSource, address, setAddress } = useAccount();
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  return (
    <Card aria-labelledby="view-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="view-heading" className="font-semibold">
          View an address
        </h2>
        {source === "view" && address && (
          <Badge>Viewing {shortAddress(address)}</Badge>
        )}
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isAddress(trimmed)) return;
          setAddress(trimmed as Address);
          setSource("view");
          setDraft("");
        }}
      >
        <TextField
          label="Address (read-only)"
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          error={
            trimmed && !isAddress(trimmed)
              ? "Enter a full 0x address."
              : undefined
          }
        />
        <Button
          type="submit"
          variant="secondary"
          className="w-full"
          disabled={!isAddress(trimmed)}
        >
          View read-only
        </Button>
      </form>
    </Card>
  );
}
