"use client";

import { useCallback, useReducer } from "react";
import type {
  Abi,
  Address,
  Hash,
  LocalAccount,
  TransactionReceipt,
} from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import { assertExpectedChain } from "@/lib/chain";
import { describeError } from "@/lib/errors";
import { txReducer, type TxState } from "@/lib/tx/machine";
import { sponsoredSend } from "@/lib/relay/client";

/** A contract write described as data, so the runner can both simulate and send it. */
export interface ContractCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

export interface TransactionRunner {
  state: TxState;
  /**
   * Sends `call` from `sender`. Before anything is signed it checks that the current account
   * source may sign for exactly `sender` (demo account, or an unlocked passkey wallet for that
   * address), that the node is on the configured chain, and that the call simulates without
   * reverting. Resolves with the receipt only when the transaction succeeded on-chain.
   */
  run: (
    label: string,
    request:
      | { sender: Address; call: ContractCall }
      | { sender: Address; calls: readonly ContractCall[] },
  ) => Promise<TransactionReceipt | undefined>;
  reset: () => void;
}

/**
 * Whether this identity's transactions go through Tally's gas sponsor: passkey wallets, when
 * gasless is enabled. They need no MON and can batch several calls into one signature.
 */
export function useIsSponsored(): boolean {
  const { config } = useApp();
  const { source } = useAccount();
  return source === "passkey" && config.gasless;
}

export function useTransaction(): TransactionRunner {
  const { config, chain, publicClient } = useApp();
  const { getWalletClient } = useAccount();
  const sponsored = useIsSponsored();
  const [state, dispatch] = useReducer(txReducer, {
    status: "idle",
  } as TxState);

  const run = useCallback<TransactionRunner["run"]>(
    async (label, request) => {
      const { sender } = request;
      const calls = "calls" in request ? request.calls : [request.call];
      dispatch({ type: "prepare", label });
      let hash: Hash;
      try {
        const wallet = getWalletClient(sender);
        const account = wallet.account;
        if (
          !account ||
          account.address.toLowerCase() !== sender.toLowerCase()
        ) {
          throw new Error(
            "The connected wallet is not the sender of this transaction. Nothing was sent.",
          );
        }
        await assertExpectedChain(publicClient, config);
        if (sponsored) {
          // Gasless: simulate the whole batch, sign once, Tally's sponsor submits and pays.
          const send = sponsoredSend({
            config,
            publicClient,
            account: account as LocalAccount,
            calls,
          });
          await send.prepare();
          dispatch({ type: "request-signature" });
          hash = await send.send();
        } else {
          if (calls.length !== 1)
            throw new Error(
              "This wallet sends one action at a time. Nothing was sent.",
            );
          const call = calls[0]!;
          // Loose typing here is deliberate: callers build `call` with `as const` ABIs.
          const params = call as unknown as Parameters<
            typeof publicClient.simulateContract
          >[0];
          await publicClient.simulateContract({ ...params, account: sender });
          dispatch({ type: "request-signature" });
          hash = await wallet.writeContract({
            ...(call as unknown as Parameters<typeof wallet.writeContract>[0]),
            account,
            chain,
          });
        }
        dispatch({ type: "submitted", hash, at: performance.now() });
      } catch (error) {
        dispatch({ type: "error", message: describeError(error) });
        return undefined;
      }
      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
        dispatch({
          type: "receipt",
          success: receipt.status === "success",
          blockNumber: receipt.blockNumber,
          at: performance.now(),
        });
        return receipt.status === "success" ? receipt : undefined;
      } catch (error) {
        dispatch({ type: "error", message: describeError(error) });
        return undefined;
      }
    },
    [config, chain, publicClient, getWalletClient, sponsored],
  );

  return {
    state,
    run,
    reset: useCallback(() => dispatch({ type: "reset" }), []),
  };
}
