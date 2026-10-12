import { configResult } from "@/lib/config";
import { handleRelay } from "@/lib/relay/server";

/**
 * Gas sponsor: submits a passkey wallet's signed batch (TallyAccount.executeWithSignature) and
 * pays the network fee. Only Tally actions are sponsored (lib/relay/policy.ts).
 */
export async function POST(request: Request) {
  if (configResult.status !== "ready")
    return Response.json(
      { ok: false, error: "Tally isn't configured." },
      { status: 503 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Expected a JSON body." },
      { status: 400 },
    );
  }
  const clientKey =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  try {
    const outcome = await handleRelay({
      config: configResult.config,
      sponsorKey: process.env.SPONSOR_PRIVATE_KEY,
      clientKey,
      body,
    });
    return Response.json(outcome.body, {
      status: outcome.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    // Never echo internals (RPC URLs, keys) back to the browser.
    return Response.json(
      { ok: false, error: "The gas sponsor couldn't send this. Try again." },
      { status: 502 },
    );
  }
}
