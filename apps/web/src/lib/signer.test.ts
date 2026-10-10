// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { fakeAuthenticator } from "@/test/fakeAuthenticator";
import { PasskeyWallet, WalletLockedError } from "./passkey/wallet";
import type { StoredPasskey } from "./passkey/credentialStore";
import { resolveSigner } from "./signer";

const DEMO_0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const OTHER = "0x0000000000000000000000000000000000000001" as Address;

function passkeyWallet() {
  let stored: StoredPasskey | undefined;
  return new PasskeyWallet({
    rpId: "localhost",
    webAuthnClient: fakeAuthenticator().client,
    store: { get: () => stored, save: (v) => (stored = v) },
  });
}

const base = {
  allowDemoAccounts: true,
  demoAccounts: [DEMO_0],
  passkeyWallet: undefined,
};

describe("resolveSigner (unauthorized transaction attempts)", () => {
  it("view-only identities can never sign", () => {
    expect(() =>
      resolveSigner({ ...base, source: "view", sender: DEMO_0 }),
    ).toThrow(/View-only/);
  });

  it("demo accounts sign only in the local demo and only for the node's own accounts", () => {
    expect(resolveSigner({ ...base, source: "demo", sender: DEMO_0 })).toEqual({
      kind: "demo",
      address: DEMO_0,
    });
    expect(() =>
      resolveSigner({ ...base, source: "demo", sender: OTHER }),
    ).toThrow(/not one of this node's demo accounts/);
    expect(() =>
      resolveSigner({
        ...base,
        allowDemoAccounts: false,
        source: "demo",
        sender: DEMO_0,
      }),
    ).toThrow(/only exist in the local demo/);
  });

  it("passkey wallets sign only when unlocked, and only as themselves", async () => {
    const wallet = passkeyWallet();
    expect(() =>
      resolveSigner({
        ...base,
        source: "passkey",
        sender: DEMO_0,
        passkeyWallet: undefined,
        passkeyUnavailableReason: "wrong domain",
      }),
    ).toThrow("wrong domain");
    const state = await wallet.create("Tally");
    const me = (state.status === "unlocked" ? state.address : "") as Address;

    const ok = resolveSigner({
      ...base,
      source: "passkey",
      sender: me,
      passkeyWallet: wallet,
    });
    expect(ok.kind === "passkey" && ok.account.address.toLowerCase()).toBe(me);
    expect(() =>
      resolveSigner({
        ...base,
        source: "passkey",
        sender: DEMO_0,
        passkeyWallet: wallet,
      }),
    ).toThrow(/different account/);

    wallet.lock();
    expect(() =>
      resolveSigner({
        ...base,
        source: "passkey",
        sender: me,
        passkeyWallet: wallet,
      }),
    ).toThrow(WalletLockedError);
  });
});
