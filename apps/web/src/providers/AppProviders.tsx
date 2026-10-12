"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  createClients,
  createDemoWalletClient,
  createPasskeyWalletClient,
} from "@/lib/chain";
import { configResult, type AppConfig } from "@/lib/config";
import {
  connectedAccount,
  createInjectedWalletClient,
  ensureWalletChain,
  getInjectedProvider,
  requestAccount,
} from "@/lib/injected";
import { SubscriptionClient } from "@/lib/indexer/subscriptions";
import {
  accountSourceStore,
  createLocalValueStore,
  selectedAddressStore,
} from "@/lib/localStore";
import { getPasskeyWallet } from "@/lib/passkey/instance";
import { resolveRpId } from "@/lib/passkey/rpId";
import { resolveSigner, type AccountSource } from "@/lib/signer";
import type { PasskeyWallet, PasskeyWalletState } from "@/lib/passkey/wallet";
import { SetupRequired } from "@/components/SetupRequired";
import { IndexerHealthProvider } from "@/hooks/useIndexerHealth";

interface AppContextValue {
  config: AppConfig;
  chain: Chain;
  publicClient: PublicClient;
  subscriptions: SubscriptionClient;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProviders>");
  return value;
}

export type AccountsStatus = "loading" | "ready" | "unavailable";
/**
 * demo: anvil dev account (local demo only) · passkey: Mera wallet · injected: a browser wallet
 * such as MetaMask · view: read-only address.
 */
export type { AccountSource };

export interface PasskeyContext {
  /** Undefined during server rendering or when passkeys can't be used on this domain. */
  wallet: PasskeyWallet | undefined;
  state: PasskeyWalletState;
  /** Why passkeys are unavailable here (e.g. wrong domain for the configured rpId). */
  unavailableReason: string | undefined;
  rpId: string | undefined;
}

export interface InjectedContext {
  /** A browser wallet (window.ethereum) is installed. */
  available: boolean;
  /** The account it shared with this site (lowercase). */
  address: Address | undefined;
  /** Shows the wallet's connect prompt, then uses it to sign. */
  connect: () => Promise<void>;
  /** Stops using it here (the wallet itself stays connected; revoke there if needed). */
  disconnect: () => void;
}

export interface AccountContextValue {
  source: AccountSource;
  setSource: (source: AccountSource) => void;
  /** The identity whose data is shown (lowercase). */
  address: Address | undefined;
  /** Local demo: anvil's unlocked dev accounts. Empty elsewhere. */
  demoAccounts: Address[];
  accountsStatus: AccountsStatus;
  /** Choose a demo account (local demo) or an address to view read-only. */
  setAddress: (address: Address | undefined) => void;
  passkey: PasskeyContext;
  injected: InjectedContext;
  /** Whether the current identity can send transactions right now. */
  canWrite: boolean;
  /** Why it can't, in plain language. */
  writeBlockedReason: string | undefined;
  /** Addresses this source may sign for (demo: all dev accounts; passkey: the wallet itself). */
  signableAccounts: Address[];
  /**
   * The wallet client that will send as `sender`. Throws, before anything is signed, if this
   * source can't sign for exactly that address (wrong account, locked wallet, view-only, …).
   */
  getWalletClient: (sender: Address) => WalletClient;
  /**
   * Last step before signing as `sender`: a browser wallet is switched to the app's chain (the
   * user approves in the wallet). A no-op for passkey and demo accounts.
   */
  prepareSigner: (sender: Address) => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used inside <AppProviders>");
  return value;
}

const SIGNED_OUT: PasskeyWalletState = { status: "signed-out" };
const noopSubscribe = () => () => {};

function usePasskey(config: AppConfig): PasskeyContext {
  // Snapshot as a primitive string so useSyncExternalStore sees a stable value.
  const rpSnapshot = useSyncExternalStore(
    noopSubscribe,
    () =>
      JSON.stringify(resolveRpId(config.passkeyRpId, window.location.hostname)),
    () => undefined,
  );
  const rp = useMemo(
    () =>
      rpSnapshot
        ? (JSON.parse(rpSnapshot) as ReturnType<typeof resolveRpId>)
        : undefined,
    [rpSnapshot],
  );
  const rpOk = rp?.ok ? rp.rpId : undefined;
  const wallet = useSyncExternalStore(
    noopSubscribe,
    () => (rpOk ? getPasskeyWallet(rpOk) : undefined),
    () => undefined,
  );
  const state = useSyncExternalStore(
    wallet?.subscribe ?? noopSubscribe,
    () => wallet?.getState() ?? SIGNED_OUT,
    () => SIGNED_OUT,
  );

  // Idle lock, and no live key left behind when the page is hidden for navigation/close.
  useEffect(() => {
    if (!wallet) return;
    const timer = setInterval(() => wallet.checkExpiry(), 15_000);
    const onPageHide = () => {
      if (wallet.getState().status === "unlocked") wallet.lock("manual");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [wallet]);

  const unavailableReason = rp && !rp.ok ? rp.reason : undefined;
  return useMemo(
    () => ({ wallet, state, unavailableReason, rpId: rpOk }),
    [wallet, state, unavailableReason, rpOk],
  );
}

const injectedAccountStore = createLocalValueStore("tally:injected-address");

function useInjected(onConnected: () => void): InjectedContext {
  const available = useSyncExternalStore(
    noopSubscribe,
    () => getInjectedProvider() !== undefined,
    () => false,
  );
  const stored = useSyncExternalStore(
    injectedAccountStore.subscribe,
    injectedAccountStore.get,
    () => undefined,
  );
  const address =
    stored && isAddress(stored) ? (stored.toLowerCase() as Address) : undefined;

  // Follow the wallet: account switches and disconnects there apply here too.
  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) return;
    let cancelled = false;
    void connectedAccount(provider)
      .then((account) => {
        if (!cancelled && injectedAccountStore.get())
          injectedAccountStore.set(account);
      })
      .catch(() => undefined);
    const onAccounts = (accounts: unknown) => {
      if (!injectedAccountStore.get()) return;
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      injectedAccountStore.set(
        typeof first === "string" ? first.toLowerCase() : undefined,
      );
    };
    provider.on?.("accountsChanged", onAccounts as never);
    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", onAccounts as never);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) throw new Error("No browser wallet found.");
    injectedAccountStore.set(await requestAccount(provider));
    onConnected();
  }, [onConnected]);
  const disconnect = useCallback(() => injectedAccountStore.set(undefined), []);

  return useMemo(
    () => ({ available, address, connect, disconnect }),
    [available, address, connect, disconnect],
  );
}

function passkeyAddress(state: PasskeyWalletState): Address | undefined {
  return "address" in state && state.address
    ? (state.address.toLowerCase() as Address)
    : undefined;
}

function AccountProvider({ children }: { children: ReactNode }) {
  const { config, chain } = useApp();
  const passkey = usePasskey(config);
  const injected = useInjected(
    useCallback(() => accountSourceStore.set("injected"), []),
  );

  const storedSource = useSyncExternalStore(
    accountSourceStore.subscribe,
    accountSourceStore.get,
    () => undefined,
  );
  const storedAddress = useSyncExternalStore(
    selectedAddressStore.subscribe,
    selectedAddressStore.get,
    () => undefined,
  );
  // An explicit choice wins; demo accounts exist only in the local demo. Default: demo accounts
  // in the local demo, otherwise the passkey wallet if one is remembered, else view-only.
  const source: AccountSource =
    storedSource === "passkey" ||
    storedSource === "view" ||
    storedSource === "injected"
      ? storedSource
      : config.allowDemoAccounts
        ? "demo"
        : passkeyAddress(passkey.state)
          ? "passkey"
          : "view";

  const [demoAccounts, setDemoAccounts] = useState<Address[]>([]);
  const [accountsStatus, setAccountsStatus] = useState<AccountsStatus>(
    config.allowDemoAccounts ? "loading" : "unavailable",
  );
  useEffect(() => {
    if (!config.allowDemoAccounts) return;
    let cancelled = false;
    // Demo only: list anvil's unlocked dev accounts (the node holds their keys, not the app).
    createWalletClient({ transport: http(config.rpcUrl) })
      .getAddresses()
      .then((accounts) => {
        if (cancelled) return;
        setDemoAccounts(accounts.map((a) => a.toLowerCase() as Address));
        setAccountsStatus("ready");
      })
      .catch(() => !cancelled && setAccountsStatus("unavailable"));
    return () => {
      cancelled = true;
    };
  }, [config.allowDemoAccounts, config.rpcUrl]);

  const selected =
    storedAddress && isAddress(storedAddress)
      ? (storedAddress.toLowerCase() as Address)
      : undefined;
  const address =
    source === "passkey"
      ? passkeyAddress(passkey.state)
      : source === "injected"
        ? injected.address
        : source === "demo"
          ? selected && demoAccounts.includes(selected)
            ? selected
            : undefined
          : selected;

  const setSource = useCallback(
    (next: AccountSource) => accountSourceStore.set(next),
    [],
  );
  const setAddress = useCallback((next: Address | undefined) => {
    selectedAddressStore.set(next ? next.toLowerCase() : undefined);
  }, []);

  const passkeyUnlocked = passkey.state.status === "unlocked";
  const { canWrite, writeBlockedReason } = (() => {
    if (source === "view")
      return {
        canWrite: false,
        writeBlockedReason: "View-only. Sign in with a passkey to send.",
      };
    if (source === "demo") {
      return address
        ? { canWrite: true, writeBlockedReason: undefined }
        : {
            canWrite: false,
            writeBlockedReason: "Choose a demo account first.",
          };
    }
    if (source === "injected") {
      return address
        ? { canWrite: true, writeBlockedReason: undefined }
        : {
            canWrite: false,
            writeBlockedReason: "Connect your browser wallet first.",
          };
    }
    if (!address)
      return {
        canWrite: false,
        writeBlockedReason: "Sign in with your passkey first.",
      };
    return passkeyUnlocked
      ? { canWrite: true, writeBlockedReason: undefined }
      : {
          canWrite: false,
          writeBlockedReason:
            "Your passkey wallet is locked. Unlock it to send.",
        };
  })();

  const signableAccounts = useMemo<Address[]>(() => {
    if (source === "demo") return demoAccounts;
    if ((source === "passkey" || source === "injected") && address)
      return [address];
    return [];
  }, [source, demoAccounts, address]);

  const getWalletClient = useCallback(
    (sender: Address): WalletClient => {
      const signer = resolveSigner({
        source,
        sender,
        allowDemoAccounts: config.allowDemoAccounts,
        demoAccounts,
        passkeyWallet: passkey.wallet,
        passkeyUnavailableReason: passkey.unavailableReason,
        injectedAddress: injected.address,
      });
      if (signer.kind === "demo")
        return createDemoWalletClient(
          config,
          chain,
          getAddress(signer.address),
        );
      if (signer.kind === "injected") {
        const provider = getInjectedProvider();
        if (!provider) throw new Error("No browser wallet found.");
        return createInjectedWalletClient(provider, chain, signer.address);
      }
      return createPasskeyWalletClient(config, chain, signer.account);
    },
    [
      source,
      config,
      chain,
      demoAccounts,
      passkey.wallet,
      passkey.unavailableReason,
      injected.address,
    ],
  );

  const prepareSigner = useCallback(
    async (sender: Address) => {
      if (source !== "injected") return;
      const provider = getInjectedProvider();
      if (!provider) throw new Error("No browser wallet found.");
      await ensureWalletChain(provider, chain);
      // The wallet may have changed accounts while switching networks.
      const account = await connectedAccount(provider);
      if (account?.toLowerCase() !== sender.toLowerCase()) {
        throw new Error(
          "Your browser wallet is on a different account than this sender. Nothing was sent.",
        );
      }
    },
    [source, chain],
  );

  const value = useMemo<AccountContextValue>(
    () => ({
      source,
      setSource,
      address,
      demoAccounts,
      accountsStatus,
      setAddress,
      passkey,
      injected,
      canWrite,
      writeBlockedReason,
      signableAccounts,
      getWalletClient,
      prepareSigner,
    }),
    [
      source,
      setSource,
      address,
      demoAccounts,
      accountsStatus,
      setAddress,
      passkey,
      injected,
      canWrite,
      writeBlockedReason,
      signableAccounts,
      getWalletClient,
      prepareSigner,
    ],
  );
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const value = useMemo(() => {
    if (configResult.status !== "ready") return null;
    const { publicClient, chain } = createClients(configResult.config);
    return {
      config: configResult.config,
      chain,
      publicClient,
      subscriptions: new SubscriptionClient(configResult.config.indexerWsUrl),
    };
  }, []);

  if (configResult.status !== "ready" || !value) {
    return (
      <SetupRequired
        problems={
          configResult.status === "unconfigured" ? configResult.problems : []
        }
      />
    );
  }
  return (
    <AppContext.Provider value={value}>
      <IndexerHealthProvider>
        <AccountProvider>{children}</AccountProvider>
      </IndexerHealthProvider>
    </AppContext.Provider>
  );
}
