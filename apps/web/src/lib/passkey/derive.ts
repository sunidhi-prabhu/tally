import {
  createSecp256k1SigningSession,
  getEvmAddress,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** First Ethereum account on the standard BIP-44 path, as in Mera's getting-started guide. */
export const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

export interface DerivedAccount {
  session: Secp256k1SigningSession;
  address: `0x${string}`;
}

/**
 * Derives the EVM signing session for a passkey's 32-byte PRF output, following Mera's recipe:
 * PRF output → BIP-39 entropy → seed → BIP-44 key. The same passkey always yields the same
 * address. Every intermediate byte buffer, including `prfOutput`, is zeroed before returning;
 * the only remaining copy of the key lives inside the Mera session until `session.end()`.
 * (The intermediate mnemonic is a JS string and cannot be wiped; it is never stored.)
 */
export function deriveEvmAccount(prfOutput: Uint8Array): DerivedAccount {
  if (prfOutput.length !== 32) throw new Error("PRF output must be 32 bytes");
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive(EVM_DERIVATION_PATH);
  try {
    if (!node.privateKey) throw new Error("Derivation produced no private key");
    const session = createSecp256k1SigningSession({
      privateKey: node.privateKey,
    });
    return { session, address: getEvmAddress(session.publicKey) };
  } finally {
    node.wipePrivateData();
    root.wipePrivateData();
    seed.fill(0);
    prfOutput.fill(0);
  }
}
