"use client";

import type { ReactNode } from "react";
import type { LiveQueryResult } from "@/hooks/useLiveQuery";
import { useIndexerHealth } from "@/hooks/useIndexerHealth";
import { LoadingList, Notice } from "./ui";

/**
 * Renders indexed data with honest status: loading skeletons, an error instead of guessed
 * numbers, and a note when the indexer is behind the chain or the live connection dropped.
 */
export function DataState<T>({
  result,
  label,
  children,
}: {
  result: LiveQueryResult<T>;
  label: string;
  children: (data: T) => ReactNode;
}) {
  const health = useIndexerHealth();
  if (result.data === undefined) {
    if (result.status === "error") {
      return (
        <Notice tone="negative" role="alert" title={`Can't load ${label}`}>
          {result.error ?? "The indexer is unavailable."} Nothing is shown
          rather than out-of-date or guessed numbers.{" "}
          <button className="underline" onClick={result.refetch}>
            Try again
          </button>
        </Notice>
      );
    }
    return <LoadingList label={`Loading ${label}`} />;
  }
  return (
    <>
      {result.status === "polling" && result.socket !== "open" && (
        <Notice tone="warning" role="status">
          Live updates reconnecting… refreshing every few seconds.
        </Notice>
      )}
      {result.status === "error" && (
        <Notice tone="warning" role="status">
          Showing the last data received. {result.error}
        </Notice>
      )}
      {health.status === "behind" && (
        <Notice tone="warning" role="status">
          The indexer is {health.lagBlocks} blocks behind the chain, so recent
          activity may be missing.
        </Notice>
      )}
      {children(result.data)}
    </>
  );
}
