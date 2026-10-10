// @vitest-environment node
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { mnemonicToAccount } from "viem/accounts";
import { toViemAccount } from "@category-labs/mera/viem";
import { describe, expect, it } from "vitest";
import { EVM_DERIVATION_PATH, deriveEvmAccount } from "./derive";

const prfBytes = () =>
  Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);

describe("deriveEvmAccount", () => {
  it("matches an independent derivation (viem mnemonicToAccount, same BIP-44 path)", () => {
    const expected = mnemonicToAccount(
      entropyToMnemonic(prfBytes(), wordlist),
    ).address;
    const { session, address } = deriveEvmAccount(prfBytes());
    expect(EVM_DERIVATION_PATH).toBe("m/44'/60'/0'/0/0");
    expect(address).toBe(expected);
    session.end();
  });

  it("is deterministic, and different PRF output gives a different wallet", () => {
    const a = deriveEvmAccount(prfBytes());
    const b = deriveEvmAccount(prfBytes());
    const other = prfBytes();
    other[0] = (other[0] ?? 0) ^ 1;
    const c = deriveEvmAccount(other);
    expect(a.address).toBe(b.address);
    expect(c.address).not.toBe(a.address);
    [a, b, c].forEach((x) => x.session.end());
  });

  it("wipes the PRF output it was given", () => {
    const input = prfBytes();
    deriveEvmAccount(input).session.end();
    expect(input.every((b) => b === 0)).toBe(true);
  });

  it("rejects wrong-length input", () => {
    expect(() => deriveEvmAccount(new Uint8Array(31))).toThrow("32 bytes");
  });

  it("can sign while the session is live and never after end()", async () => {
    const { session } = deriveEvmAccount(prfBytes());
    const account = toViemAccount(session);
    await expect(account.signMessage({ message: "hi" })).resolves.toMatch(
      /^0x[0-9a-f]{130}$/,
    );
    session.end();
    await expect(account.signMessage({ message: "hi" })).rejects.toMatchObject({
      code: "SESSION_ENDED",
    });
  });
});
