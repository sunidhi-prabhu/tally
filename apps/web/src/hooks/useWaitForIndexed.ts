"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/providers/AppProviders";
import { gqlQuery } from "@/lib/indexer/client";
import { ENTITY_EXISTS } from "@/lib/indexer/queries";

export type IndexedStatus = "idle" | "waiting" | "indexed" | "timeout";

/**
 * After a confirmed transaction, waits until the indexer has the new entity. The transaction is
 * already final on-chain; this only tells the user when lists and balances will reflect it.
 */
export function useWaitForIndexed(
  target:
    { expenseId?: string; settlementId?: string; groupId?: string } | undefined,
  timeoutMs = 60_000,
): IndexedStatus {
  const { config } = useApp();
  const key = target ? JSON.stringify(target) : "";
  const [result, setResult] = useState<
    { key: string; status: IndexedStatus } | undefined
  >();

  useEffect(() => {
    if (!key) return;
    const t = JSON.parse(key) as {
      expenseId?: string;
      settlementId?: string;
      groupId?: string;
    };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      try {
        const data = await gqlQuery<{
          Expense: unknown[];
          Settlement: unknown[];
          Group: unknown[];
        }>(config.indexerHttpUrl, ENTITY_EXISTS, {
          expenseId: t.expenseId ?? "",
          settlementId: t.settlementId ?? "",
          groupId: t.groupId ?? "",
        });
        const found =
          (t.expenseId ? data.Expense.length > 0 : true) &&
          (t.settlementId ? data.Settlement.length > 0 : true) &&
          (t.groupId ? data.Group.length > 0 : true);
        if (cancelled) return;
        if (found) return setResult({ key, status: "indexed" });
      } catch {
        // keep waiting; the indexer may be restarting
      }
      if (cancelled) return;
      if (Date.now() - started > timeoutMs)
        return setResult({ key, status: "timeout" });
      timer = setTimeout(tick, 1_000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, config.indexerHttpUrl, timeoutMs]);

  if (!key) return "idle";
  return result?.key === key ? result.status : "waiting";
}
