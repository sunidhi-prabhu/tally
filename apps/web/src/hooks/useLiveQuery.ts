"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { useApp } from "@/providers/AppProviders";
import { gqlQuery, IndexerError } from "@/lib/indexer/client";
import type { SocketState } from "@/lib/indexer/subscriptions";

export type LiveStatus = "loading" | "live" | "polling" | "error";

export interface LiveQueryResult<T> {
  data: T | undefined;
  status: LiveStatus;
  socket: SocketState;
  error: string | undefined;
  /** When data last arrived from the indexer (ms). */
  updatedAt: number | undefined;
  refetch: () => void;
}

interface Snapshot<T> {
  key: string;
  data: T | undefined;
  status: LiveStatus;
  error: string | undefined;
  updatedAt: number | undefined;
}

const POLL_MS = 5_000;

/**
 * Reads indexed data: one HTTP fetch, then a live subscription. While the WebSocket is down it
 * falls back to HTTP polling. Indexed data can lag the chain; pair with useIndexerHealth.
 */
export function useLiveQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  parse: (data: unknown) => T,
  { enabled = true }: { enabled?: boolean } = {},
): LiveQueryResult<T> {
  const { config, subscriptions } = useApp();
  const [nonce, setNonce] = useState(0);
  const key = `${query}|${JSON.stringify(variables)}|${nonce}`;
  const [snapshot, setSnapshot] = useState<Snapshot<T> | undefined>(undefined);
  const [socket, setSocket] = useState<SocketState>(subscriptions.currentState);

  const accept = useEffectEvent(
    (forKey: string, raw: unknown, live: boolean) => {
      setSnapshot((prev) => ({
        key: forKey,
        data: parse(raw),
        // An HTTP refresh never downgrades a live subscription; the socket state does that below.
        status:
          live || (prev?.key === forKey && prev.status === "live")
            ? "live"
            : "polling",
        error: undefined,
        updatedAt: Date.now(),
      }));
    },
  );
  const fail = useEffectEvent((forKey: string, message: string) => {
    setSnapshot((prev) =>
      prev?.key === forKey
        ? {
            ...prev,
            status: prev.data === undefined ? "error" : prev.status,
            error: message,
          }
        : {
            key: forKey,
            data: undefined,
            status: "error",
            error: message,
            updatedAt: undefined,
          },
    );
  });

  useEffect(() => subscriptions.onStateChange(setSocket), [subscriptions]);

  useEffect(() => {
    if (!enabled) return;
    const forKey = key;
    const vars = JSON.parse(key.split("|")[1] ?? "{}") as Record<
      string,
      unknown
    >;
    let cancelled = false;
    const controller = new AbortController();

    const fetchOnce = () =>
      gqlQuery(config.indexerHttpUrl, query, vars, {
        signal: controller.signal,
      })
        .then((raw) => !cancelled && accept(forKey, raw, false))
        .catch((e: unknown) => {
          if (!cancelled)
            fail(
              forKey,
              e instanceof IndexerError
                ? e.message
                : "Could not load indexed data.",
            );
        });

    void fetchOnce();
    const unsubscribe = subscriptions.subscribe(
      query.replace(/^\s*query\b/, "subscription"),
      vars,
      (raw) => !cancelled && accept(forKey, raw, true),
      (message) => !cancelled && fail(forKey, message),
    );
    const poll = setInterval(() => {
      if (subscriptions.currentState !== "open") void fetchOnce();
    }, POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(poll);
      unsubscribe();
    };
  }, [config.indexerHttpUrl, subscriptions, query, key, enabled]);

  const current = snapshot?.key === key ? snapshot : undefined;
  const status: LiveStatus =
    !enabled || !current
      ? "loading"
      : current.status === "live" && socket !== "open"
        ? "polling"
        : current.status;
  return {
    data: current?.data,
    status,
    socket,
    error: current?.error,
    updatedAt: current?.updatedAt,
    refetch: () => setNonce((n) => n + 1),
  };
}
