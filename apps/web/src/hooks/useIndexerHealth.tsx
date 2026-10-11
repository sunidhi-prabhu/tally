"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useApp } from "@/providers/AppProviders";
import { META, parseMeta, type IndexerMeta } from "@/lib/indexer/queries";
import { useLiveQuery } from "./useLiveQuery";

export type HealthStatus =
  | "checking"
  | "synced"
  | "behind"
  | "indexer-offline"
  | "rpc-offline"
  | "wrong-chain";

export interface IndexerHealth {
  status: HealthStatus;
  progressBlock: number | undefined;
  chainHead: bigint | undefined;
  lagBlocks: number | undefined;
}

/**
 * Blocks of lag tolerated before the UI calls indexed data "behind". Anvil only mines on demand,
 * so any real lag there is a problem. Monad produces a block about every 0.4 s and the chain head
 * is polled every 4 s, so a healthy hosted indexer routinely trails by several blocks; 25 blocks
 * is about 10 seconds.
 */
export function lagTolerance(chainId: number): number {
  return chainId === 31337 ? 2 : 25;
}

export function classifyHealth(
  meta: IndexerMeta | undefined,
  metaError: boolean,
  head: bigint | undefined,
  headError: boolean,
  expectedChainId: number,
): IndexerHealth {
  const progressBlock = meta?.progressBlock;
  if (metaError && !meta)
    return {
      status: "indexer-offline",
      progressBlock,
      chainHead: head,
      lagBlocks: undefined,
    };
  if (meta && meta.chainId !== expectedChainId) {
    return {
      status: "wrong-chain",
      progressBlock,
      chainHead: head,
      lagBlocks: undefined,
    };
  }
  if (headError && head === undefined) {
    return {
      status: "rpc-offline",
      progressBlock,
      chainHead: head,
      lagBlocks: undefined,
    };
  }
  if (!meta || head === undefined)
    return {
      status: "checking",
      progressBlock,
      chainHead: head,
      lagBlocks: undefined,
    };
  const lag = Math.max(0, Number(head) - meta.progressBlock);
  return {
    status:
      meta.isReady && lag <= lagTolerance(expectedChainId)
        ? "synced"
        : "behind",
    progressBlock,
    chainHead: head,
    lagBlocks: lag,
  };
}

function useIndexerHealthSource(): IndexerHealth {
  const { config, publicClient } = useApp();
  const meta = useLiveQuery(META, {}, parseMeta);
  const [head, setHead] = useState<bigint | undefined>(undefined);
  const [headError, setHeadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      publicClient
        .getBlockNumber({ cacheTime: 0 })
        .then((n) => {
          if (!cancelled) {
            setHead(n);
            setHeadError(false);
          }
        })
        .catch(() => !cancelled && setHeadError(true));
    void tick();
    const id = setInterval(tick, 4_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicClient]);

  return classifyHealth(
    meta.data,
    meta.status === "error",
    head,
    headError,
    config.chainId,
  );
}

const HealthContext = createContext<IndexerHealth | null>(null);

/** Computes indexer health once for the whole app (one _meta subscription, one block poll). */
export function IndexerHealthProvider({ children }: { children: ReactNode }) {
  const health = useIndexerHealthSource();
  return (
    <HealthContext.Provider value={health}>{children}</HealthContext.Provider>
  );
}

export function useIndexerHealth(): IndexerHealth {
  const value = useContext(HealthContext);
  if (!value)
    throw new Error(
      "useIndexerHealth must be used inside <IndexerHealthProvider>",
    );
  return value;
}
