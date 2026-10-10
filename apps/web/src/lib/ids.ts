import { toHex, type Hex } from "viem";

/** Random non-zero bytes32 for expense and settlement IDs (unique per group on-chain). */
export function randomId(): Hex {
  const bytes = new Uint8Array(32);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes.every((b) => b === 0));
  return toHex(bytes);
}
