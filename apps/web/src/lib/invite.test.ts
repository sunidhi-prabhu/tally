import { describe, expect, it } from "vitest";
import { hashMessage, recoverMessageAddress, type Address } from "viem";
import {
  invitePayloadHash,
  inviteLink,
  inviteSignerOf,
  keyFromFragment,
  newInviteKey,
  signInvite,
} from "./invite";

const LEDGER = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const JOINER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const input = { chainId: 31337, ledger: LEDGER, groupId: 1n, joiner: JOINER };

describe("invite signatures", () => {
  it("match TallyLedger.inviteDigest exactly", () => {
    // Vectors from the contract itself: cast keccak of abi.encode(...), and the value
    // `inviteDigest(1, joiner)` returned on a local anvil LocalDemo deployment.
    expect(invitePayloadHash(input)).toBe(
      "0x4816b6194c4ab0220d4d165a413564df03c5fe206c69c3a900daa2b4c8faa7bb",
    );
    expect(hashMessage({ raw: invitePayloadHash(input) })).toBe(
      "0xa290cd0972a34681be27d11a8d5e44f5fb04d8e057f23db82dadc136757cddfe",
    );
  });

  it("are signed by the invite key and bound to the joiner", async () => {
    const { key, signer } = newInviteKey();
    const signature = await signInvite(key, input);
    expect(
      await recoverMessageAddress({
        message: { raw: invitePayloadHash(input) },
        signature,
      }),
    ).toBe(signer);
    // The same signature names a different joiner's payload as someone else.
    expect(
      await recoverMessageAddress({
        message: {
          raw: invitePayloadHash({
            ...input,
            joiner: "0x0000000000000000000000000000000000000001",
          }),
        },
        signature,
      }),
    ).not.toBe(signer);
  });
});

describe("invite links", () => {
  it("carry the key only in the fragment, and parse back", () => {
    const { key } = newInviteKey();
    const link = inviteLink("https://tally.example", "7", key);
    const url = new URL(link);
    expect(url.pathname).toBe("/join/7");
    expect(url.search).toBe("");
    expect(keyFromFragment(url.hash)).toBe(key);
    expect(inviteSignerOf(keyFromFragment(url.hash)!)).toBe(
      inviteSignerOf(key),
    );
  });

  it("rejects malformed fragments", () => {
    expect(keyFromFragment("")).toBeUndefined();
    expect(keyFromFragment("#k=1234")).toBeUndefined();
    expect(keyFromFragment(`#x=${"a".repeat(64)}`)).toBeUndefined();
  });
});
