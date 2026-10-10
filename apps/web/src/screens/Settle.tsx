"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, getAddress, parseAbi, type Hex } from "viem";
import {
  MAX_AMOUNT,
  isTallyError,
  parseAmount,
  type Transfer,
} from "@tally/core";
import { useAccount, useApp } from "@/providers/AppProviders";
import { useLiveQuery } from "@/hooks/useLiveQuery";
import { useTransaction } from "@/hooks/useTransaction";
import { useWaitForIndexed } from "@/hooks/useWaitForIndexed";
import { useSettlementToken } from "@/hooks/useSettlementToken";
import { GROUP_DETAIL, parseGroupDetail } from "@/lib/indexer/queries";
import { suggestedTransfers, transfersInvolving } from "@/lib/balances";
import { fundLocalTestMon } from "@/lib/chain";
import { LOCAL_DEMO } from "@/lib/config";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import { formatAusd, formatNative } from "@/lib/format";
import { randomId } from "@/lib/ids";
import { isConfirmed } from "@/lib/tx/machine";
import { DataState } from "@/components/DataState";
import { WriteGate } from "@/components/WriteGate";
import { TxStatus } from "@/components/TxStatus";
import { useDemoNames } from "@/components/AppShell";
import {
  AddressLabel,
  Amount,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  Notice,
  TextField,
} from "@/components/ui";

/** MockToken's test-only mint, plus its custom errors so reverts decode to friendly messages. */
const mockTokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "error InsufficientBalance(address account, uint256 balance, uint256 needed)",
  "error InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);
const ledgerWithTokenErrors = [
  ...tallyLedgerAbi,
  ...mockTokenAbi.slice(1),
] as const;

export function Settle({ groupId }: { groupId: string }) {
  const { address } = useAccount();
  const group = useLiveQuery(GROUP_DETAIL, { id: groupId }, parseGroupDetail);

  return (
    <>
      <Link href={`/groups/${groupId}`} className="text-sm text-accent">
        ← Back to group
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Settle up</h1>
      <DataState result={group} label="balances">
        {(g) => {
          if (!g) return <EmptyState title="Group not found" />;
          const me = address?.toLowerCase();
          if (!me) return <EmptyState title="Choose an account first" />;
          const { youPay, youReceive } = transfersInvolving(
            suggestedTransfers(g.members),
            me,
          );
          return (
            <SettlePicker
              groupId={groupId}
              me={me}
              options={[...youPay, ...youReceive]}
            />
          );
        }}
      </DataState>
    </>
  );
}

const transferKey = (t: Transfer) => `${t.from}-${t.to}`;

/**
 * Lets the user pick a suggested payment. Once a transaction starts, the choice is locked so
 * live balance updates (which change the suggestions) can't swap the panel and hide its result.
 */
function SettlePicker({
  groupId,
  me,
  options,
}: {
  groupId: string;
  me: string;
  options: Transfer[];
}) {
  const names = useDemoNames();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [locked, setLocked] = useState<Transfer | undefined>(undefined);
  const current =
    locked ?? options.find((t) => transferKey(t) === selected) ?? options[0];
  if (!current) {
    return (
      <EmptyState title="Nothing to settle">
        You&apos;re settled up in this group.
      </EmptyState>
    );
  }
  const shown =
    locked && !options.some((t) => transferKey(t) === transferKey(locked))
      ? [locked, ...options]
      : options;
  const lock = () => setLocked(current);
  return (
    <>
      <fieldset className="space-y-2" disabled={locked !== undefined}>
        <legend className="mb-1 text-sm font-medium">Which payment?</legend>
        {shown.map((t) => (
          <label
            key={transferKey(t)}
            className={`flex cursor-pointer items-center justify-between gap-2 rounded-2xl border p-3 text-sm ${
              transferKey(t) === transferKey(current)
                ? "border-accent bg-accent-bg"
                : "border-border bg-surface"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <input
                type="radio"
                name="transfer"
                checked={transferKey(t) === transferKey(current)}
                onChange={() => setSelected(transferKey(t))}
                className="accent-[var(--accent)]"
              />
              {t.from === me ? (
                <span className="flex items-center gap-1">
                  You pay <AddressLabel address={t.to} me={me} names={names} />
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <AddressLabel address={t.from} me={me} names={names} /> pays
                  you
                </span>
              )}
            </span>
            <Amount units={t.amount} />
          </label>
        ))}
      </fieldset>
      {current.from === me ? (
        <PayWithToken
          key={transferKey(current)}
          groupId={groupId}
          transfer={current}
          names={names}
          onStart={lock}
        />
      ) : (
        <Acknowledge
          key={transferKey(current)}
          groupId={groupId}
          transfer={current}
          names={names}
          onStart={lock}
        />
      )}
    </>
  );
}

/** Parses the amount field and checks it against the contract's own maxSettleable. */
function useSettleAmount(groupId: string, transfer: Transfer) {
  const { config, publicClient } = useApp();
  const [text, setText] = useState(formatAusd(transfer.amount));
  const [onChainMax, setOnChainMax] = useState<bigint | undefined>(undefined);
  const readMax = useCallback(
    () =>
      publicClient.readContract({
        address: config.ledgerAddress,
        abi: tallyLedgerAbi,
        functionName: "maxSettleable",
        args: [
          BigInt(groupId),
          getAddress(transfer.from),
          getAddress(transfer.to),
        ],
      }),
    [config.ledgerAddress, publicClient, groupId, transfer.from, transfer.to],
  );
  const refreshMax = useCallback(async () => {
    const max = await readMax();
    setOnChainMax(max);
    return max;
  }, [readMax]);
  useEffect(() => {
    let cancelled = false;
    readMax().then(
      (max) => !cancelled && setOnChainMax(max),
      () => !cancelled && setOnChainMax(undefined),
    );
    return () => {
      cancelled = true;
    };
  }, [readMax]);

  let amount: bigint | undefined;
  let error: string | undefined;
  try {
    amount = parseAmount(text);
    if (amount === 0n) error = "Amount must be greater than zero.";
    else if (amount > MAX_AMOUNT)
      error = "Above the 1 trillion AUSD per-payment limit; settle in parts.";
    else if (onChainMax !== undefined && amount > onChainMax) {
      error = `The contract currently allows at most ${formatAusd(onChainMax)} AUSD between you two.`;
    }
  } catch (e) {
    error =
      isTallyError(e) && e.code === "EXCESS_PRECISION"
        ? "Use at most 6 decimal places."
        : "Enter an amount like 12.50.";
  }
  return {
    text,
    setText,
    amount: error ? undefined : amount,
    error,
    onChainMax,
    refreshMax,
  };
}

async function estimateMaxFee(
  publicClient: ReturnType<typeof useApp>["publicClient"],
  request: Parameters<
    ReturnType<typeof useApp>["publicClient"]["estimateContractGas"]
  >[0],
): Promise<bigint | undefined> {
  try {
    const [gas, fees] = await Promise.all([
      publicClient.estimateContractGas(request),
      publicClient.estimateFeesPerGas(),
    ]);
    return gas * (fees.maxFeePerGas ?? 0n);
  } catch {
    return undefined;
  }
}

function PayWithToken({
  groupId,
  transfer,
  names,
  onStart,
}: {
  groupId: string;
  transfer: Transfer;
  names: Record<string, string>;
  onStart: () => void;
}) {
  const { config, chain, publicClient } = useApp();
  const { address, canWrite } = useAccount();
  const token = useSettlementToken();
  const [nativeBalance, setNativeBalance] = useState<bigint | undefined>(
    undefined,
  );
  const [funding, setFunding] = useState<"idle" | "working" | "failed">("idle");
  const amountState = useSettleAmount(groupId, transfer);
  const approveTx = useTransaction();
  const settleTx = useTransaction();
  const mintTx = useTransaction();
  const [balance, setBalance] = useState<bigint | undefined>(undefined);
  const [allowance, setAllowance] = useState<bigint | undefined>(undefined);
  const [fees, setFees] = useState<{ approve?: bigint; settle?: bigint }>({});
  const [dialog, setDialog] = useState<"approve" | "settle" | undefined>(
    undefined,
  );
  const [settlementId, setSettlementId] = useState<Hex | undefined>(undefined);
  const account = address ? getAddress(address) : undefined;
  const tokenAddress = token.status === "ready" ? token.address : undefined;
  const isMockToken =
    config.mode === "local-demo" &&
    tokenAddress === getAddress(LOCAL_DEMO.mockTokenAddress);

  const readBalances = useCallback(async () => {
    if (!tokenAddress || !account) return undefined;
    return Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, config.ledgerAddress],
      }),
      // Native MON pays gas; Mera wallets have no sponsorship.
      publicClient.getBalance({ address: account }),
    ]);
  }, [tokenAddress, account, publicClient, config.ledgerAddress]);
  const refresh = useCallback(async () => {
    const values = await readBalances();
    if (values) {
      setBalance(values[0]);
      setAllowance(values[1]);
      setNativeBalance(values[2]);
    }
  }, [readBalances]);
  useEffect(() => {
    let cancelled = false;
    readBalances().then(
      (values) => {
        if (!cancelled && values) {
          setBalance(values[0]);
          setAllowance(values[1]);
          setNativeBalance(values[2]);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [readBalances]);

  const amount = amountState.amount;
  const needsApproval =
    amount !== undefined && allowance !== undefined && allowance < amount;
  const maxFeeNeeded = fees.settle ?? fees.approve;
  const lowGas =
    nativeBalance !== undefined &&
    (nativeBalance === 0n ||
      (maxFeeNeeded !== undefined && nativeBalance < maxFeeNeeded));
  const insufficient =
    amount !== undefined && balance !== undefined && balance < amount;

  useEffect(() => {
    if (!tokenAddress || !account || amount === undefined) return;
    let cancelled = false;
    void (async () => {
      const approve = await estimateMaxFee(publicClient, {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [config.ledgerAddress, amount],
        account,
      });
      const settle = needsApproval
        ? undefined
        : await estimateMaxFee(publicClient, {
            address: config.ledgerAddress,
            abi: ledgerWithTokenErrors,
            functionName: "settleWithToken",
            args: [
              BigInt(groupId),
              randomId(),
              getAddress(transfer.to),
              amount,
            ],
            account,
          });
      if (!cancelled) setFees({ approve, settle });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    tokenAddress,
    account,
    amount,
    needsApproval,
    publicClient,
    config.ledgerAddress,
    groupId,
    transfer.to,
  ]);

  const indexed = useWaitForIndexed(
    settlementId && isConfirmed(settleTx.state)
      ? { settlementId: `${groupId}-${settlementId.toLowerCase()}` }
      : undefined,
  );

  if (token.status === "loading")
    return <Notice>Reading the settlement token from the ledger…</Notice>;
  if (token.status === "error")
    return (
      <Notice tone="negative" role="alert">
        {token.message}
      </Notice>
    );
  if (!token.matchesExpected) {
    return (
      <Notice tone="negative" role="alert" title="Unexpected settlement token">
        The ledger settles in {token.address}, which is not the configured
        token. Token payments are disabled.
      </Notice>
    );
  }
  if (!account) return null;
  if (!canWrite) return <WriteGate />;
  const symbol = isMockToken
    ? `${token.symbol} (test stand-in for AUSD)`
    : token.symbol;
  const confirmed = isConfirmed(settleTx.state);
  const busy = [approveTx, settleTx, mintTx].some((t) =>
    ["preparing", "awaiting-signature", "pending"].includes(t.state.status),
  );

  async function addTestMon() {
    if (!account) return;
    setFunding("working");
    try {
      await fundLocalTestMon(config, chain, publicClient, account, 10n ** 18n);
      setFunding("idle");
      await refresh();
    } catch {
      setFunding("failed");
    }
  }

  async function approve() {
    setDialog(undefined);
    onStart();
    if (amount === undefined || !tokenAddress || !account) return;
    const call = {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.ledgerAddress, amount],
    } as const;
    await approveTx.run("Approve", { sender: account, call });
    await refresh();
  }

  async function settle() {
    setDialog(undefined);
    onStart();
    if (amount === undefined || !account) return;
    const max = await amountState.refreshMax();
    if (amount > max) return;
    const id = randomId();
    setSettlementId(id);
    const call = {
      address: config.ledgerAddress,
      abi: ledgerWithTokenErrors,
      functionName: "settleWithToken",
      args: [BigInt(groupId), id, getAddress(transfer.to), amount],
    } as const;
    await settleTx.run("Pay", { sender: account, call });
    await refresh();
  }

  async function mintTestTokens() {
    onStart();
    if (amount === undefined || !tokenAddress || !account) return;
    const call = {
      address: tokenAddress,
      abi: mockTokenAbi,
      functionName: "mint",
      args: [account, amount],
    } as const;
    await mintTx.run("Mint test tokens", { sender: account, call });
    await refresh();
  }

  return (
    <Card aria-labelledby="pay-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pay-heading" className="font-semibold">
          Pay with AUSD
        </h2>
        <Badge tone="positive">Moves tokens on-chain</Badge>
      </div>
      <p className="text-sm text-muted">
        Sends {symbol} from you to{" "}
        <AddressLabel
          address={transfer.to}
          me={address}
          names={names}
          withAvatar={false}
        />{" "}
        and records the settlement in the same transaction.
      </p>

      <fieldset disabled={busy || confirmed} className="space-y-3">
        <TextField
          label="Amount"
          inputMode="decimal"
          value={amountState.text}
          onChange={(e) => amountState.setText(e.target.value)}
          suffix="AUSD"
          error={amountState.error}
          hint={
            amountState.onChainMax !== undefined
              ? `Contract allows up to ${formatAusd(amountState.onChainMax)} between you two right now.`
              : undefined
          }
        />
      </fieldset>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-background p-2">
          <dt className="text-xs text-muted">Your {token.symbol} balance</dt>
          <dd className="tabular">
            {balance === undefined ? "…" : formatAusd(balance)}
          </dd>
        </div>
        <div className="rounded-xl bg-background p-2">
          <dt className="text-xs text-muted">Approved for Tally</dt>
          <dd className="tabular">
            {allowance === undefined ? "…" : formatAusd(allowance)}
          </dd>
        </div>
      </dl>

      {lowGas && !confirmed && (
        <Notice
          tone="warning"
          role="status"
          title="Not enough MON for network fees"
        >
          <p>
            Passkey wallets are regular accounts with no gas sponsorship, so
            they need MON to send transactions. Balance:{" "}
            {nativeBalance === undefined
              ? "…"
              : formatNative(nativeBalance, chain.nativeCurrency.symbol)}
            .
          </p>
          {config.mode === "local-demo" ? (
            <>
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
            </>
          ) : (
            <p className="mt-1">
              Get testnet MON from faucet.monad.xyz, then come back.
            </p>
          )}
        </Notice>
      )}
      {insufficient && !confirmed && (
        <Notice tone="warning" role="status" title="Not enough tokens">
          {isMockToken ? (
            <>
              This demo account needs test tokens.{" "}
              <Button
                variant="secondary"
                className="mt-2 min-h-9"
                onClick={() => void mintTestTokens()}
                disabled={busy}
              >
                Mint {amount !== undefined ? formatAusd(amount) : ""} test
                tokens
              </Button>
              <span className="mt-1 block text-xs">
                MockToken only. Real AUSD can&apos;t be minted.
              </span>
            </>
          ) : (
            "Add AUSD to this account before paying."
          )}
        </Notice>
      )}
      <TxStatus
        state={mintTx.state}
        signerHint="The local anvil node signs for demo accounts."
      />

      <ol className="space-y-3 text-sm">
        <li className="rounded-xl border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">1. Approve</span>
            {needsApproval && !confirmed ? (
              <Badge tone="warning">Required</Badge>
            ) : (
              <Badge tone="positive">Done</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            Lets the Tally ledger move exactly this amount from your account,
            once.
            {fees.approve !== undefined && needsApproval && (
              <>
                {" "}
                Max network fee ≈{" "}
                {formatNative(fees.approve, chain.nativeCurrency.symbol)}.
              </>
            )}
          </p>
          {needsApproval && !confirmed && (
            <Button
              className="mt-2 w-full"
              variant="secondary"
              disabled={busy || amount === undefined || insufficient}
              onClick={() => setDialog("approve")}
            >
              Approve {amount !== undefined ? formatAusd(amount) : ""}{" "}
              {token.symbol}
            </Button>
          )}
          <div className="mt-2">
            <TxStatus
              state={approveTx.state}
              signerHint="The local anvil node signs for demo accounts."
            />
          </div>
        </li>
        <li className="rounded-xl border border-border p-3">
          <span className="font-medium">2. Pay</span>
          <p className="mt-1 text-xs text-muted">
            {fees.settle !== undefined ? (
              <>
                Max network fee ≈{" "}
                {formatNative(fees.settle, chain.nativeCurrency.symbol)}. Monad
                charges for the full gas limit.
              </>
            ) : (
              "Fee estimate available after approval."
            )}
          </p>
          {!confirmed && (
            <Button
              className="mt-2 w-full"
              disabled={
                busy || amount === undefined || needsApproval || insufficient
              }
              onClick={() => setDialog("settle")}
            >
              Pay {amount !== undefined ? formatAusd(amount) : ""} AUSD
            </Button>
          )}
          <div className="mt-2">
            <TxStatus
              state={settleTx.state}
              signerHint="The local anvil node signs for demo accounts."
            />
          </div>
        </li>
      </ol>

      {confirmed && (
        <>
          <Notice tone="positive" role="status" title="Paid">
            The transfer is confirmed on-chain.{" "}
            {indexed === "indexed"
              ? "Balances are updated."
              : indexed === "timeout"
                ? "The indexer hasn't caught up yet; balances will update when it does."
                : "Waiting for the indexer to update balances…"}
          </Notice>
          <ButtonLink href={`/groups/${groupId}`} className="w-full">
            Back to group
          </ButtonLink>
        </>
      )}

      <ConfirmDialog
        open={dialog === "approve"}
        title="Approve token spending?"
        confirmLabel="Approve"
        onCancel={() => setDialog(undefined)}
        onConfirm={() => void approve()}
      >
        <p>
          Allow the Tally ledger to transfer up to{" "}
          <Amount units={amount ?? 0n} /> of your {symbol}. No tokens move yet.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "settle"}
        title="Send this payment?"
        confirmLabel="Pay now"
        onCancel={() => setDialog(undefined)}
        onConfirm={() => void settle()}
      >
        <p>
          Transfer <Amount units={amount ?? 0n} /> from you to{" "}
          <AddressLabel
            address={transfer.to}
            me={address}
            names={names}
            withAvatar={false}
          />
          . This can&apos;t be undone.
        </p>
        {fees.settle !== undefined && (
          <p className="text-xs text-muted">
            Max network fee ≈{" "}
            {formatNative(fees.settle, chain.nativeCurrency.symbol)}.
          </p>
        )}
      </ConfirmDialog>
    </Card>
  );
}

function Acknowledge({
  groupId,
  transfer,
  names,
  onStart,
}: {
  groupId: string;
  transfer: Transfer;
  names: Record<string, string>;
  onStart: () => void;
}) {
  const { config } = useApp();
  const { address, canWrite } = useAccount();
  const amountState = useSettleAmount(groupId, transfer);
  const tx = useTransaction();
  const [open, setOpen] = useState(false);
  const [settlementId, setSettlementId] = useState<Hex | undefined>(undefined);
  const indexed = useWaitForIndexed(
    settlementId && isConfirmed(tx.state)
      ? { settlementId: `${groupId}-${settlementId.toLowerCase()}` }
      : undefined,
  );
  const account = useMemo(
    () => (address ? getAddress(address) : undefined),
    [address],
  );
  if (!account) return null;
  if (!canWrite) return <WriteGate />;
  const amount = amountState.amount;
  const busy = ["preparing", "awaiting-signature", "pending"].includes(
    tx.state.status,
  );
  const confirmed = isConfirmed(tx.state);

  async function submit() {
    setOpen(false);
    onStart();
    if (amount === undefined || !account) return;
    const max = await amountState.refreshMax();
    if (amount > max) return;
    const id = randomId();
    setSettlementId(id);
    const call = {
      address: config.ledgerAddress,
      abi: tallyLedgerAbi,
      functionName: "acknowledgeSettlement",
      args: [BigInt(groupId), id, getAddress(transfer.from), amount],
    } as const;
    await tx.run("Mark as received", { sender: account, call });
  }

  return (
    <Card aria-labelledby="ack-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ack-heading" className="font-semibold">
          Mark as received
        </h2>
        <Badge tone="warning">No tokens move</Badge>
      </div>
      <p className="text-sm text-muted">
        Use this only if{" "}
        <AddressLabel
          address={transfer.from}
          me={address}
          names={names}
          withAvatar={false}
        />{" "}
        already paid you outside Tally (cash, bank transfer). It reduces what
        they owe you; it is not a token payment.
      </p>
      <fieldset disabled={busy || confirmed}>
        <TextField
          label="Amount received"
          inputMode="decimal"
          value={amountState.text}
          onChange={(e) => amountState.setText(e.target.value)}
          suffix="AUSD"
          error={amountState.error}
        />
      </fieldset>
      <TxStatus
        state={tx.state}
        signerHint="The local anvil node signs for demo accounts."
      />
      {confirmed ? (
        <>
          <Notice tone="positive" role="status" title="Recorded">
            Your acknowledgement is confirmed on-chain. No tokens were
            transferred.{" "}
            {indexed === "indexed"
              ? "Balances are updated."
              : "Waiting for the indexer…"}
          </Notice>
          <ButtonLink href={`/groups/${groupId}`} className="w-full">
            Back to group
          </ButtonLink>
        </>
      ) : (
        <Button
          className="w-full"
          variant="secondary"
          disabled={busy || amount === undefined}
          onClick={() => setOpen(true)}
        >
          Mark {amount !== undefined ? formatAusd(amount) : ""} AUSD as received
        </Button>
      )}
      <ConfirmDialog
        open={open}
        title="Record a payment you received?"
        confirmLabel="Yes, I was paid"
        onCancel={() => setOpen(false)}
        onConfirm={() => void submit()}
      >
        <p>
          You confirm that{" "}
          <AddressLabel
            address={transfer.from}
            me={address}
            names={names}
            withAvatar={false}
          />{" "}
          paid you <Amount units={amount ?? 0n} /> outside Tally.
        </p>
        <p className="font-medium">
          No tokens will move. This lowers what they owe you and can&apos;t be
          undone.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
