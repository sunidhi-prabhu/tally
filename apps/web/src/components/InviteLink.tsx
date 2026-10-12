"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import { useTransaction } from "@/hooks/useTransaction";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import {
  inviteKeyStore,
  inviteLink,
  inviteSignerOf,
  newInviteKey,
} from "@/lib/invite";
import { QrCode } from "./QrCode";
import { TxStatus } from "./TxStatus";
import { Button, ConfirmDialog } from "./ui";

/**
 * The invite card's link. With an active invite key (known on this device), it's a join link:
 * anyone who opens it can join with Face ID. Otherwise it's the group's page link, and the
 * admin can create an invite link (one transaction registers the key's address on-chain).
 */
export function InviteLink({
  groupId,
  groupName,
  isAdmin,
  canWrite,
}: {
  groupId: string;
  groupName: string;
  isAdmin: boolean;
  canWrite: boolean;
}) {
  const { config, publicClient } = useApp();
  const { address } = useAccount();
  const tx = useTransaction();
  const store = useMemo(
    () => inviteKeyStore(config.ledgerAddress, groupId),
    [config.ledgerAddress, groupId],
  );
  const storedKey = useSyncExternalStore(
    store.subscribe,
    store.get,
    () => undefined,
  ) as Hex | undefined;
  // undefined: loading; zeroAddress: invites off.
  const [signer, setSigner] = useState<Address | undefined>();
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"create" | "off" | undefined>();

  const readSigner = useCallback(
    () =>
      publicClient
        .readContract({
          address: config.ledgerAddress,
          abi: tallyLedgerAbi,
          functionName: "inviteSigner",
          args: [BigInt(groupId)],
        })
        .then((value) => setSigner(getAddress(value)))
        .catch(() => undefined),
    [publicClient, config.ledgerAddress, groupId],
  );
  useEffect(() => {
    void readSigner();
  }, [readSigner]);

  const active =
    storedKey !== undefined &&
    signer !== undefined &&
    signer !== zeroAddress &&
    inviteSignerOf(storedKey) === signer;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = active
    ? inviteLink(origin, groupId, storedKey)
    : `${origin}/groups/${groupId}`;
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const busy = ["preparing", "awaiting-signature", "pending"].includes(
    tx.state.status,
  );

  async function setInviteSigner(next: Address, key: Hex | undefined) {
    setConfirm(undefined);
    if (!address) return;
    const receipt = await tx.run(
      next === zeroAddress ? "Turn off invite link" : "Create invite link",
      {
        sender: getAddress(address),
        call: {
          address: config.ledgerAddress,
          abi: tallyLedgerAbi,
          functionName: "setInviteSigner",
          args: [BigInt(groupId), next],
        },
      },
    );
    if (receipt) {
      store.set(key);
      setCopied(false);
      await readSigner();
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {active
          ? "Anyone with this link can join with Face ID or their passkey, no address needed. Share it only with people you trust; reset it to stop old links working."
          : isAdmin
            ? "Create an invite link so friends can join themselves. Or add them by address below."
            : "Only the admin can create invite links. This is the group's page; send the admin your address to be added."}
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          aria-label={active ? "Invite link" : "Group link"}
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
        label={`QR code for the ${groupName} ${active ? "invite" : "group"} link`}
      />
      {canShare && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() =>
            void navigator
              .share({ title: `Join ${groupName} on Tally`, url: link })
              .catch(() => undefined)
          }
        >
          Share link
        </Button>
      )}
      {isAdmin && canWrite && signer !== undefined && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            className={active ? "" : "col-span-2"}
            variant={active ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => setConfirm("create")}
          >
            {active ? "Reset link" : "Create invite link"}
          </Button>
          {active && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirm("off")}
            >
              Turn off
            </Button>
          )}
        </div>
      )}
      <TxStatus state={tx.state} signerHint="Confirm in your wallet." />
      <ConfirmDialog
        open={confirm === "create"}
        title={active ? "Reset the invite link?" : "Create an invite link?"}
        confirmLabel={active ? "Reset" : "Create"}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          const { key, signer: next } = newInviteKey();
          void setInviteSigner(next, key);
        }}
      >
        <p>
          {active
            ? "The current link stops working and a new one replaces it."
            : "Anyone you give the link to can join this group."}{" "}
          The link&apos;s secret stays in the link itself; only its public
          address goes on-chain.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "off"}
        title="Turn off the invite link?"
        confirmLabel="Turn off"
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => void setInviteSigner(zeroAddress, undefined)}
      >
        <p>Nobody can join with it anymore. You can create a new one later.</p>
      </ConfirmDialog>
    </div>
  );
}
