"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getAddress, zeroAddress, type Address } from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import { useLiveQuery } from "@/hooks/useLiveQuery";
import { useTransaction } from "@/hooks/useTransaction";
import { GROUP_DETAIL, parseGroupDetail } from "@/lib/indexer/queries";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { inviteSignerOf, keyFromFragment, signInvite } from "@/lib/invite";
import { describeError } from "@/lib/errors";
import { isConfirmed } from "@/lib/tx/machine";
import { DataState } from "@/components/DataState";
import { TxStatus } from "@/components/TxStatus";
import { Button, Card, EmptyState, Notice } from "@/components/ui";

const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

/** Opened from an invite link: /join/<groupId>#k=<invite key>. */
export function JoinGroup({ groupId }: { groupId: string }) {
  const { config, publicClient } = useApp();
  const { address, source, setSource, passkey, canWrite } = useAccount();
  const router = useRouter();
  const group = useLiveQuery(GROUP_DETAIL, { id: groupId }, parseGroupDetail);
  const key = useSyncExternalStore(
    subscribeHash,
    () => keyFromFragment(window.location.hash),
    () => undefined,
  );
  const tx = useTransaction();
  const [signer, setSigner] = useState<Address | undefined>();
  const [walletError, setWalletError] = useState<string | undefined>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicClient
      .readContract({
        address: config.ledgerAddress,
        abi: tallyLedgerAbi,
        functionName: "inviteSigner",
        args: [BigInt(groupId)],
      })
      .then((value) => !cancelled && setSigner(getAddress(value)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [publicClient, config.ledgerAddress, groupId]);

  const me = address?.toLowerCase();
  const isMember = useMemo(
    () =>
      group.data?.members.some((m) => m.address === me && m.active) ?? false,
    [group.data, me],
  );
  // Joined and indexed: go to the group.
  useEffect(() => {
    if (isConfirmed(tx.state) && isMember) router.push(`/groups/${groupId}`);
  }, [tx.state, isMember, router, groupId]);

  const valid =
    key !== undefined &&
    signer !== undefined &&
    signer !== zeroAddress &&
    inviteSignerOf(key) === signer;

  async function createWallet() {
    setWorking(true);
    setWalletError(undefined);
    try {
      const result = await passkey.wallet?.create("Tally wallet");
      if (result?.status === "unlocked") setSource("passkey");
      else if (result?.status === "error")
        setWalletError(result.failure.message);
    } catch (error) {
      setWalletError(describeError(error));
    } finally {
      setWorking(false);
    }
  }

  async function join() {
    if (!key || !address) return;
    const signature = await signInvite(key, {
      chainId: config.chainId,
      ledger: config.ledgerAddress,
      groupId: BigInt(groupId),
      joiner: getAddress(address),
    });
    await tx.run("Join group", {
      sender: getAddress(address),
      call: {
        address: config.ledgerAddress,
        abi: tallyLedgerAbi,
        functionName: "joinWithInvite",
        args: [BigInt(groupId), signature],
      },
    });
  }

  const busy = ["preparing", "awaiting-signature", "pending"].includes(
    tx.state.status,
  );
  const hasWallet = address !== undefined && source !== "view";
  const locked =
    source === "passkey" &&
    passkey.state.status !== "unlocked" &&
    "address" in passkey.state;

  return (
    <DataState result={group} label="this group">
      {(g) => {
        if (!g) return <EmptyState title="Group not found" />;
        return (
          <Card aria-labelledby="join-heading" className="space-y-4">
            <div>
              <p className="text-sm text-muted">You&apos;re invited to</p>
              <h1
                id="join-heading"
                className="text-2xl font-semibold tracking-tight"
              >
                {g.name}
              </h1>
              <p className="text-sm text-muted">
                {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
              </p>
            </div>

            {!key ? (
              <Notice tone="warning" title="This link is incomplete">
                Ask the person who shared it to send the whole invite link.
              </Notice>
            ) : signer !== undefined && !valid ? (
              <Notice
                tone="warning"
                title="This invite link is no longer valid"
              >
                The admin reset or turned off the link. Ask them for a new one.
              </Notice>
            ) : isMember ? (
              <>
                <Notice tone="positive" title="You're in this group">
                  {isConfirmed(tx.state) ? "Opening the group…" : null}
                </Notice>
                <Link
                  href={`/groups/${groupId}`}
                  className="block text-center text-sm text-accent"
                >
                  Open {g.name}
                </Link>
              </>
            ) : !hasWallet ? (
              <>
                <p className="text-sm">
                  Create a wallet with Face ID, Touch ID or your device PIN. No
                  app, no seed phrase
                  {config.gasless ? ", and no fees to pay" : ""}.
                </p>
                <Button
                  className="w-full"
                  disabled={working || !passkey.wallet}
                  onClick={() => void createWallet()}
                >
                  {working
                    ? "Waiting for your passkey…"
                    : "Create passkey wallet"}
                </Button>
                <Link
                  href="/account"
                  className="block text-center text-sm text-accent"
                >
                  I already have one
                </Link>
                {walletError && (
                  <Notice tone="negative" role="alert" title="That didn't work">
                    {walletError}
                  </Notice>
                )}
              </>
            ) : locked ? (
              <Button
                className="w-full"
                onClick={() => void passkey.wallet?.unlock()}
              >
                Unlock with passkey
              </Button>
            ) : (
              <>
                <Button
                  className="w-full"
                  disabled={busy || !canWrite || !valid}
                  onClick={() => void join()}
                >
                  {busy ? "Joining…" : `Join ${g.name}`}
                </Button>
                {config.gasless && source === "passkey" && (
                  <p className="text-center text-xs text-muted">
                    Tally pays the network fee.
                  </p>
                )}
                <TxStatus
                  state={tx.state}
                  signerHint="Confirm with your passkey."
                />
                {isConfirmed(tx.state) && (
                  <Notice role="status">
                    Joined. Waiting for the indexer…
                  </Notice>
                )}
              </>
            )}
          </Card>
        );
      }}
    </DataState>
  );
}
