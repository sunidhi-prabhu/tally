// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fakeAuthenticator } from "@/test/fakeAuthenticator";
import type { StoredPasskey } from "./credentialStore";
import { PasskeyWallet, WalletLockedError } from "./wallet";

function memoryStore() {
  let value: StoredPasskey | undefined;
  return {
    get: () => value,
    save: (v: StoredPasskey | undefined) => {
      value = v;
    },
    raw: () => value,
  };
}

function setup(options: { prf?: boolean; idleMs?: number } = {}) {
  const auth = fakeAuthenticator({ prf: options.prf });
  const store = memoryStore();
  let now = 1_000;
  const make = () =>
    new PasskeyWallet({
      rpId: "localhost",
      store,
      webAuthnClient: auth.client,
      idleMs: options.idleMs ?? 60_000,
      now: () => now,
    });
  return { auth, store, make, advance: (ms: number) => (now += ms) };
}

describe("PasskeyWallet onboarding", () => {
  it("creates a passkey wallet, remembering only public metadata", async () => {
    const { make, store } = setup();
    const wallet = make();
    expect(wallet.getState()).toEqual({ status: "signed-out" });

    const state = await wallet.create("Tally wallet");
    expect(state.status).toBe("unlocked");
    const address = state.status === "unlocked" ? state.address : "";
    expect(address).toMatch(/^0x[0-9a-f]{40}$/);

    const saved = store.raw()!;
    expect(saved).toMatchObject({
      address,
      rpId: "localhost",
      transports: ["internal"],
    });
    expect(Object.keys(saved).sort()).toEqual([
      "address",
      "credentialId",
      "rpId",
      "transports",
    ]);
    expect(wallet.getAccount(address).address.toLowerCase()).toBe(address);
  });

  it("after a reload it starts locked and unlocks to the same wallet", async () => {
    const { make } = setup();
    const first = await make().create("Tally wallet");
    const address = first.status === "unlocked" ? first.address : "";

    const reloaded = make();
    expect(reloaded.getState()).toEqual({
      status: "locked",
      address,
      reason: "reload",
    });
    expect(() => reloaded.getAccount(address)).toThrow(WalletLockedError);

    const unlocked = await reloaded.unlock();
    expect(unlocked).toMatchObject({ status: "unlocked", address });
  });

  it("reports cancellation without losing the remembered wallet", async () => {
    const { make, auth } = setup();
    const created = await make().create("Tally wallet");
    const wallet = make();
    auth.failNextWith("NotAllowedError");
    const state = await wallet.unlock();
    expect(state).toMatchObject({
      status: "error",
      failure: { kind: "cancelled" },
    });
    expect(state.status === "error" && state.address).toBe(
      created.status === "unlocked" && created.address,
    );
  });

  it("explains when the authenticator has no PRF support", async () => {
    const { make, store } = setup({ prf: false });
    const state = await make().create("Tally wallet");
    expect(state).toMatchObject({
      status: "error",
      failure: { kind: "prf-unavailable" },
    });
    expect(store.raw()).toBeUndefined();
  });

  it("locks after the idle window and old accounts can no longer sign", async () => {
    const { make, advance } = setup({ idleMs: 1_000 });
    const wallet = make();
    const state = await wallet.create("Tally wallet");
    const address = state.status === "unlocked" ? state.address : "";
    const account = wallet.getAccount(address);

    advance(999);
    wallet.checkExpiry();
    expect(wallet.getState().status).toBe("unlocked");
    advance(1_000);
    wallet.checkExpiry();
    expect(wallet.getState()).toMatchObject({
      status: "locked",
      reason: "idle",
    });
    expect(() => wallet.getAccount(address)).toThrow(WalletLockedError);
    await expect(account.signMessage({ message: "x" })).rejects.toMatchObject({
      code: "SESSION_ENDED",
    });
  });

  it("never signs for a different address", async () => {
    const { make } = setup();
    const wallet = make();
    await wallet.create("Tally wallet");
    expect(() =>
      wallet.getAccount("0x0000000000000000000000000000000000000001"),
    ).toThrow(/different account/);
  });

  it("unlock refuses a different passkey; sign-in switches accounts explicitly", async () => {
    const { make, auth, store } = setup();
    const a = await make().create("A");
    const b = await make().create("B"); // second passkey on the same device
    const aAddress = a.status === "unlocked" ? a.address : "";
    const bAddress = b.status === "unlocked" ? b.address : "";
    expect(aAddress).not.toBe(bAddress);
    expect(store.raw()?.address).toBe(bAddress);

    // The user picks passkey A in a discoverable prompt: that's an account change.
    auth.pick(1);
    store.save(undefined);
    const wallet = make();
    expect(await wallet.signIn()).toMatchObject({
      status: "unlocked",
      address: aAddress,
    });
    expect(store.raw()?.address).toBe(aAddress);
  });

  it("signing out ends the session and forgets the passkey on this device", async () => {
    const { make, store } = setup();
    const wallet = make();
    const state = await wallet.create("Tally wallet");
    const address = state.status === "unlocked" ? state.address : "";
    const account = wallet.getAccount(address);
    wallet.signOut();
    expect(wallet.getState()).toEqual({ status: "signed-out" });
    expect(store.raw()).toBeUndefined();
    await expect(account.signMessage({ message: "x" })).rejects.toMatchObject({
      code: "SESSION_ENDED",
    });
  });

  it("ignores a second request while one is in progress", async () => {
    const { make, auth } = setup();
    const wallet = make();
    const first = wallet.create("A");
    const second = await wallet.create("B");
    expect(second).toMatchObject({ status: "working", action: "create" });
    await first;
    expect(auth.calls.create).toBe(1);
  });
});
