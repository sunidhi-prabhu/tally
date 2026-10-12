// What Tally's sponsor is willing to pay gas for. Pure: no network, no secrets, fully tested.
// The sponsor only ever submits what the wallet signed (TallyAccount enforces that); this
// policy limits what it will spend its MON on, so the fee wallet can't be used for anything
// except Tally actions.
import {
  decodeFunctionData,
  erc20Abi,
  parseAbi,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";
import { tallyLedgerAbi } from "@/lib/contracts/tallyLedgerAbi";
import {
  MAX_DEADLINE_SECONDS,
  type AuthorizationJson,
  type RelayCall,
  type RelayRequest,
} from "./protocol";

/** Every TallyLedger write a member can make. */
export const SPONSORED_LEDGER_FUNCTIONS = new Set([
  "createGroup",
  "addMember",
  "removeMember",
  "leaveGroup",
  "setInviteSigner",
  "joinWithInvite",
  "recordEqualExpense",
  "recordCustomExpense",
  "undoExpense",
  "settleWithToken",
  "acknowledgeSettlement",
]);

export const MAX_CALLS = 4;

/** Local demo's MockToken faucet. Never sponsored on a public network. */
const mockMintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const LOCAL_CHAIN_ID = 31337;

export interface PolicyContext {
  chainId: number;
  ledger: Address;
  token: Address;
  smartAccount: Address;
  /** Unix seconds. */
  now: number;
}

export interface CheckedRequest {
  wallet: Address;
  calls: RelayCall[];
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
  authorization?: AuthorizationJson;
}

export type PolicyResult =
  { ok: true; request: CheckedRequest } | { ok: false; error: string };

const refuse = (error: string): PolicyResult => ({ ok: false, error });

function toBigInt(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) return undefined;
  return BigInt(value);
}

/** Why the sponsor won't pay for `call`, or undefined if it's a Tally action. */
export function checkCall(
  call: unknown,
  ctx: PolicyContext,
): string | undefined {
  const c = call as Partial<RelayCall> | null;
  if (!c || typeof c.to !== "string" || !isAddress(c.to))
    return "Each call needs a valid target address.";
  if (typeof c.data !== "string" || !isHex(c.data) || c.data.length < 10)
    return "Each call needs calldata.";
  const to = getAddress(c.to);
  if (to === ctx.ledger) {
    try {
      const { functionName } = decodeFunctionData({
        abi: tallyLedgerAbi,
        data: c.data,
      });
      return SPONSORED_LEDGER_FUNCTIONS.has(functionName)
        ? undefined
        : `TallyLedger.${functionName} isn't sponsored.`;
    } catch {
      return "Unrecognized TallyLedger call.";
    }
  }
  if (to === ctx.token) {
    if (ctx.chainId === LOCAL_CHAIN_ID) {
      try {
        decodeFunctionData({ abi: mockMintAbi, data: c.data });
        return undefined; // local test tokens only
      } catch {
        // not a mint; fall through to the approve rule
      }
    }
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: c.data });
      if (decoded.functionName !== "approve")
        return "Only AUSD approvals for the ledger are sponsored.";
      const [spender] = decoded.args as readonly [Address, bigint];
      return getAddress(spender) === ctx.ledger
        ? undefined
        : "AUSD approvals are only sponsored for the Tally ledger.";
    } catch {
      return "Unrecognized AUSD call.";
    }
  }
  return "Only Tally ledger and AUSD calls are sponsored.";
}

function checkAuthorization(
  value: unknown,
  ctx: PolicyContext,
): AuthorizationJson | string {
  const a = value as Partial<AuthorizationJson> | null;
  if (!a || typeof a.address !== "string" || !isAddress(a.address))
    return "Malformed authorization.";
  if (getAddress(a.address) !== ctx.smartAccount)
    return "The authorization must delegate to Tally's smart account.";
  // chainId 0 would be valid on every chain; only this chain is accepted.
  if (a.chainId !== ctx.chainId)
    return "The authorization is for another chain.";
  if (!Number.isSafeInteger(a.nonce) || (a.nonce as number) < 0)
    return "Malformed authorization nonce.";
  if (
    typeof a.r !== "string" ||
    !isHex(a.r) ||
    typeof a.s !== "string" ||
    !isHex(a.s) ||
    (a.yParity !== 0 && a.yParity !== 1)
  )
    return "Malformed authorization signature.";
  return {
    address: getAddress(a.address),
    chainId: a.chainId,
    nonce: a.nonce as number,
    r: a.r,
    s: a.s,
    yParity: a.yParity,
  };
}

/** Validates a POST /api/relay body against the sponsorship policy. */
export function checkRelayRequest(
  body: unknown,
  ctx: PolicyContext,
): PolicyResult {
  const b = body as Partial<RelayRequest> | null;
  if (!b || typeof b !== "object") return refuse("Expected a JSON object.");
  if (typeof b.wallet !== "string" || !isAddress(b.wallet))
    return refuse("Invalid wallet address.");
  if (!Array.isArray(b.calls) || b.calls.length === 0)
    return refuse("Nothing to send.");
  if (b.calls.length > MAX_CALLS)
    return refuse(`At most ${MAX_CALLS} calls per batch.`);
  for (const call of b.calls) {
    const problem = checkCall(call, ctx);
    if (problem) return refuse(problem);
  }
  const nonce = toBigInt(b.nonce);
  if (nonce === undefined) return refuse("Invalid nonce.");
  const deadline = toBigInt(b.deadline);
  if (deadline === undefined) return refuse("Invalid deadline.");
  if (deadline <= BigInt(ctx.now)) return refuse("This request has expired.");
  if (deadline > BigInt(ctx.now + MAX_DEADLINE_SECONDS))
    return refuse("The deadline is too far in the future.");
  if (
    typeof b.signature !== "string" ||
    !isHex(b.signature) ||
    b.signature.length !== 132
  )
    return refuse("Invalid signature.");
  let authorization: AuthorizationJson | undefined;
  if (b.authorization !== undefined) {
    const checked = checkAuthorization(b.authorization, ctx);
    if (typeof checked === "string") return refuse(checked);
    authorization = checked;
  }
  return {
    ok: true,
    request: {
      wallet: getAddress(b.wallet),
      calls: b.calls.map((c) => ({
        to: getAddress((c as RelayCall).to),
        data: (c as RelayCall).data,
      })),
      nonce,
      deadline,
      signature: b.signature,
      authorization,
    },
  };
}

/** A small fixed-window limiter. Per server instance only: a first line, not a guarantee. */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()): boolean => {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  };
}
