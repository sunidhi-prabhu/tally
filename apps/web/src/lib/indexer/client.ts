export type IndexerErrorKind = "network" | "timeout" | "graphql";

export class IndexerError extends Error {
  override readonly name = "IndexerError";
  constructor(
    readonly kind: IndexerErrorKind,
    message: string,
  ) {
    super(message);
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/** One GraphQL query over HTTP. Read-only: the indexer exposes no mutations we use. */
export async function gqlQuery<T>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
  {
    timeoutMs = 10_000,
    signal,
  }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("timeout")),
    timeoutMs,
  );
  signal?.addEventListener("abort", () => controller.abort(signal.reason), {
    once: true,
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch {
    const timedOut =
      controller.signal.reason instanceof Error &&
      controller.signal.reason.message === "timeout";
    throw new IndexerError(
      timedOut ? "timeout" : "network",
      timedOut
        ? "The indexer did not respond in time."
        : "Cannot reach the indexer.",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new IndexerError(
      "network",
      `Indexer responded with HTTP ${response.status}.`,
    );
  }
  const body = (await response.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    throw new IndexerError(
      "graphql",
      body.errors.map((e) => e.message).join("; "),
    );
  }
  if (!body.data)
    throw new IndexerError("graphql", "The indexer returned no data.");
  return body.data;
}
