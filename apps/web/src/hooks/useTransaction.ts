"use client";

import { useCallback, useReducer } from "react";
import type { Abi, Address, Hash, TransactionReceipt } from "viem";
import { useAccount, useApp } from "@/providers/AppProviders";
import { assertExpectedChain } from "@/lib/chain";
import { describeError } from "@/lib/errors";
import { txReducer, type TxState } from "@/lib/tx/machine";

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
    request: { sender: Address; call: ContractCall },
  ) => Promise<TransactionReceipt | undefined>;
  reset: () => void;
}

export function useTransaction(): TransactionRunner {
  const { config, chain, publicClient } = useApp();
  const { getWalletClient } = useAccount();
  const [state, dispatch] = useReducer(txReducer, {
    status: "idle",
  } as TxState);

  const run = useCallback<TransactionRunner["run"]>(
    async (label, { sender, call }) => {
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
        dispatch({ type: "submitted", hash });
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
        });
        return receipt.status === "success" ? receipt : undefined;
      } catch (error) {
        dispatch({ type: "error", message: describeError(error) });
        return undefined;
      }
    },
    [config, chain, publicClient, getWalletClient],
  );

  return {
    state,
    run,
    reset: useCallback(() => dispatch({ type: "reset" }), []),
  };
}
