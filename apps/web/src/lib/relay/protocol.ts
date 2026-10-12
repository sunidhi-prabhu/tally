// The gasless protocol, shared by the browser (which signs) and /api/relay (which checks and
// submits). A passkey wallet delegated to TallyAccount (EIP-7702) signs an EIP-712 `Execute`
// over the exact calls, a one-time nonce and a deadline; the sponsor submits it and pays gas.
import {
  encodeAbiParameters,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

/** ERC-7579/7821 single-batch mode: call type 0x01, everything else zero. */
export const BATCH_MODE = `0x01${"00".repeat(31)}` as Hex;

/** How long a signed batch stays valid; the sponsor refuses anything longer. */
export const MAX_DEADLINE_SECONDS = 600;

/** One call in a batch. Tally never sends MON value through the sponsor. */
export interface RelayCall {
  to: Address;
  data: Hex;
}

/** `abi.encode(Execution[])` with value 0, as TallyAccount (OpenZeppelin ERC7579Utils) expects. */
export function encodeExecutionData(calls: readonly RelayCall[]): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    [calls.map((c) => ({ target: c.to, value: 0n, callData: c.data }))],
  );
}

export const EXECUTE_TYPES = {
  Execute: [
    { name: "mode", type: "bytes32" },
    { name: "executionData", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** TallyAccount's EIP-712 domain, as seen from the delegated wallet. */
export function executeDomain(
  chainId: number,
  wallet: Address,
): TypedDataDomain {
  return {
    name: "TallyAccount",
    version: "1",
    chainId,
    verifyingContract: wallet,
  };
}

/** Code of a wallet delegated to `smartAccount` (EIP-7702 delegation designator). */
export function delegationDesignator(smartAccount: Address): Hex {
  return `0xef0100${smartAccount.slice(2).toLowerCase()}` as Hex;
}

/** A signed EIP-7702 authorization, JSON-safe (bigints as decimal strings). */
export interface AuthorizationJson {
  address: Address;
  chainId: number;
  nonce: number;
  r: Hex;
  s: Hex;
  yParity: number;
}

/** POST /api/relay body. */
export interface RelayRequest {
  wallet: Address;
  calls: RelayCall[];
  /** Decimal strings. */
  nonce: string;
  deadline: string;
  signature: Hex;
  /** First use only: delegates the wallet to TallyAccount in the same sponsored flow. */
  authorization?: AuthorizationJson;
}

export type RelayResponse =
  | { ok: true; hash: Hex; delegationHash?: Hex }
  | { ok: false; error: string; errorName?: string };
