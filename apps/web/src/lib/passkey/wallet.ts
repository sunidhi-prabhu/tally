import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  type Secp256k1SigningSession,
  type WebAuthnClient,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";
import { deriveEvmAccount } from "./derive";
import { describePasskeyError, type PasskeyFailure } from "./errors";
import type { StoredPasskey } from "./credentialStore";

/**
 * A user-owned wallet whose key is derived from a passkey with Mera (a regular EOA: no smart
 * account, no gas sponsorship). The signing key exists only inside an in-memory Mera session,
 * which ends on lock, sign-out or after `idleMs` without use. Nothing secret is persisted.
 */
export type PasskeyWalletState =
  | { status: "signed-out" }
  | {
      status: "working";
      action: "create" | "sign-in" | "unlock";
      address?: `0x${string}`;
    }
  | { status: "unlocked"; address: `0x${string}`; expiresAt: number }
  | {
      status: "locked";
      address: `0x${string}`;
      reason: "idle" | "manual" | "reload";
    }
  | { status: "error"; failure: PasskeyFailure; address?: `0x${string}` };

export class WalletLockedError extends Error {
  override readonly name = "WalletLockedError";
  constructor() {
    super(
      "Your passkey wallet is locked. Unlock it with your passkey, then try again.",
    );
  }
}

export interface PasskeyWalletOptions {
  rpId: string;
  appName?: string;
  idleMs?: number;
  now?: () => number;
  webAuthnClient?: WebAuthnClient;
  store: {
    get: () => StoredPasskey | undefined;
    save: (value: StoredPasskey | undefined) => void;
  };
}

export const DEFAULT_IDLE_MS = 10 * 60 * 1000;

export class PasskeyWallet {
  private state: PasskeyWalletState;
  private session: Secp256k1SigningSession | undefined;
  private account: LocalAccount | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(private readonly options: PasskeyWalletOptions) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.now = options.now ?? Date.now;
    const stored = this.storedForRp();
    // After a reload there is never a live session: the user must confirm with the passkey.
    this.state = stored
      ? { status: "locked", address: stored.address, reason: "reload" }
      : { status: "signed-out" };
  }

  getState = (): PasskeyWalletState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Creates a new passkey (one biometric/PIN prompt, sometimes two) and its wallet. */
  async create(label: string): Promise<PasskeyWalletState> {
    if (this.state.status === "working") return this.state;
    this.set({ status: "working", action: "create" });
    try {
      const result = await createPasskeyWithPrfOutput({
        rp: { id: this.options.rpId, name: this.options.appName ?? "Tally" },
        user: { name: label, displayName: label },
        webAuthnClient: this.options.webAuthnClient,
      });
      const { session, address } = deriveEvmAccount(result.prfOutput);
      this.options.store.save({
        credentialId: result.credentialId,
        transports: result.transports,
        address: address.toLowerCase() as `0x${string}`,
        rpId: this.options.rpId,
      });
      return this.start(session, address);
    } catch (error) {
      return this.fail(error);
    }
  }

  /** Signs in with an existing passkey. Restricts the prompt to the remembered one if known. */
  async signIn(): Promise<PasskeyWalletState> {
    return this.authenticate("sign-in");
  }

  /** Re-derives the session for the remembered passkey after a lock or reload. */
  async unlock(): Promise<PasskeyWalletState> {
    return this.authenticate("unlock");
  }

  /** Ends the session (zeroes the key). The address stays visible; signing needs the passkey again. */
  lock(reason: "idle" | "manual" = "manual"): void {
    const address = this.addressOf();
    this.endSession();
    this.set(
      address
        ? { status: "locked", address, reason }
        : { status: "signed-out" },
    );
  }

  /** Ends the session and forgets the remembered passkey on this device. */
  signOut(): void {
    this.endSession();
    this.options.store.save(undefined);
    this.set({ status: "signed-out" });
  }

  /**
   * Returns the viem account for `expectedAddress`, refreshing the idle timer. Throws if the
   * wallet is locked/expired or if a different account would sign.
   */
  getAccount(expectedAddress: string): LocalAccount {
    this.checkExpiry();
    if (this.state.status !== "unlocked" || !this.account)
      throw new WalletLockedError();
    if (this.account.address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error(
        "The passkey wallet is a different account than the requested sender. Nothing was sent.",
      );
    }
    this.set({ ...this.state, expiresAt: this.now() + this.idleMs });
    return this.account;
  }

  /** Locks if the idle window has passed. Call periodically. */
  checkExpiry(): void {
    if (this.state.status === "unlocked" && this.now() >= this.state.expiresAt)
      this.lock("idle");
  }

  dispose(): void {
    this.endSession();
    this.listeners.clear();
  }

  private async authenticate(
    action: "sign-in" | "unlock",
  ): Promise<PasskeyWalletState> {
    if (this.state.status === "working") return this.state;
    const stored = this.storedForRp();
    this.set({ status: "working", action, address: stored?.address });
    try {
      const result = await getPasskeyPrfOutput({
        rpId: this.options.rpId,
        credential: stored
          ? { credentialId: stored.credentialId, transports: stored.transports }
          : undefined,
        webAuthnClient: this.options.webAuthnClient,
      });
      const { session, address } = deriveEvmAccount(result.prfOutput);
      const lower = address.toLowerCase() as `0x${string}`;
      if (
        stored &&
        stored.credentialId === result.credentialId &&
        stored.address !== lower
      ) {
        // Same credential must always give the same address; anything else is a bug or tampering.
        session.end();
        throw new Error("Passkey produced an unexpected address.");
      }
      if (
        action === "unlock" &&
        stored &&
        stored.credentialId !== result.credentialId
      ) {
        // Unlock must not quietly switch accounts; switching is an explicit sign-in.
        session.end();
        throw new Error(
          "A different passkey was used. Use “Sign in” to switch accounts.",
        );
      }
      this.options.store.save({
        credentialId: result.credentialId,
        transports:
          stored?.credentialId === result.credentialId
            ? stored.transports
            : undefined,
        address: lower,
        rpId: this.options.rpId,
      });
      return this.start(session, address);
    } catch (error) {
      return this.fail(error, stored?.address);
    }
  }

  private start(
    session: Secp256k1SigningSession,
    address: `0x${string}`,
  ): PasskeyWalletState {
    this.endSession();
    this.session = session;
    this.account = toViemAccount(session);
    return this.set({
      status: "unlocked",
      address: address.toLowerCase() as `0x${string}`,
      expiresAt: this.now() + this.idleMs,
    });
  }

  private fail(error: unknown, address?: `0x${string}`): PasskeyWalletState {
    const own = [
      "Passkey produced an unexpected address.",
      "A different passkey was used. Use “Sign in” to switch accounts.",
    ];
    const failure =
      error instanceof Error && own.includes(error.message)
        ? { kind: "failed" as const, message: error.message }
        : describePasskeyError(error);
    const known = address ?? this.storedForRp()?.address;
    return this.set({ status: "error", failure, address: known });
  }

  private endSession() {
    this.session?.end();
    this.session = undefined;
    this.account = undefined;
  }

  private addressOf(): `0x${string}` | undefined {
    const s = this.state;
    if ("address" in s && s.address) return s.address;
    return this.storedForRp()?.address;
  }

  private storedForRp(): StoredPasskey | undefined {
    const stored = this.options.store.get();
    return stored && stored.rpId === this.options.rpId ? stored : undefined;
  }

  private set(state: PasskeyWalletState): PasskeyWalletState {
    this.state = state;
    for (const listener of this.listeners) listener();
    return state;
  }
}
