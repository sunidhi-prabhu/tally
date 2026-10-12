// Invite links. The group admin registers an invite key's address on-chain
// (TallyLedger.setInviteSigner); the private key travels only in the link's #fragment, which
// browsers never send to a server. A joiner's app signs "this address joins this group" with
// the key, so the key never goes on-chain and a signature seen in the mempool only works for
// the address it names.
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createLocalValueStore } from "./localStore";

/** Keccak of the payload TallyLedger.inviteDigest wraps in an EIP-191 personal message. */
export function invitePayloadHash(input: {
  chainId: number;
  ledger: Address;
  groupId: bigint;
  joiner: Address;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        "TallyInvite",
        BigInt(input.chainId),
        input.ledger,
        input.groupId,
        input.joiner,
      ],
    ),
  );
}

/** The invite key's signature that lets `joiner` call joinWithInvite. */
export function signInvite(
  key: Hex,
  input: Parameters<typeof invitePayloadHash>[0],
): Promise<Hex> {
  return privateKeyToAccount(key).signMessage({
    message: { raw: invitePayloadHash(input) },
  });
}

export function newInviteKey(): { key: Hex; signer: Address } {
  const key = generatePrivateKey();
  return { key, signer: privateKeyToAccount(key).address };
}

export const inviteSignerOf = (key: Hex): Address =>
  privateKeyToAccount(key).address;

export function inviteLink(origin: string, groupId: string, key: Hex): string {
  return `${origin}/join/${groupId}#k=${key.slice(2)}`;
}

/** The key from a link's fragment ("#k=<64 hex>"), or undefined. */
export function keyFromFragment(fragment: string): Hex | undefined {
  const match = /^#?k=([0-9a-fA-F]{64})$/.exec(fragment.trim());
  return match ? (`0x${match[1]!.toLowerCase()}` as Hex) : undefined;
}

/**
 * The admin's copy of a group's current invite key, so the link can be shown again on this
 * device. A per-device convenience: losing it just means creating a new link.
 */
export function inviteKeyStore(ledger: Address, groupId: string) {
  return createLocalValueStore(
    `tally:invite:${ledger.toLowerCase()}:${groupId}`,
  );
}
