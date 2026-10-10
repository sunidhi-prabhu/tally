"use client";

import { useEffect, useState } from "react";
import { erc20Abi, getAddress, type Address } from "viem";
import { useApp } from "@/providers/AppProviders";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";

export type TokenInfo =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      address: Address;
      symbol: string;
      decimals: number;
      /** False if the ledger's token differs from the configured/expected one. */
      matchesExpected: boolean;
    };

/** Reads the settlement token from the ledger itself (the contract is the source of truth). */
export function useSettlementToken(): TokenInfo {
  const { config, publicClient } = useApp();
  const [info, setInfo] = useState<TokenInfo>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const address = await publicClient.readContract({
        address: config.ledgerAddress,
        abi: tallyLedgerAbi,
        functionName: "settlementToken",
      });
      const [symbol, decimals] = await Promise.all([
        publicClient.readContract({
          address,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ]);
      if (cancelled) return;
      setInfo({
        status: "ready",
        address: getAddress(address),
        symbol,
        decimals,
        matchesExpected:
          config.expectedTokenAddress === undefined ||
          getAddress(address) === config.expectedTokenAddress,
      });
    })().catch(() => {
      if (!cancelled) {
        setInfo({
          status: "error",
          message: "Could not read the settlement token from the ledger.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [config, publicClient]);
  return info;
}
