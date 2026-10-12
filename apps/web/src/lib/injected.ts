// A browser wallet (MetaMask, Rabby, Coinbase Wallet, …) exposed as `window.ethereum`
// (EIP-1193). The wallet holds the keys and shows its own confirmation for every transaction;
// Tally only asks it to sign the same simulated contract calls as for passkey wallets.
import {
  createWalletClient,
  custom,
  getAddress,
  numberToHex,
  type Address,
  type Chain,
  type EIP1193Provider,
  type WalletClient,
} from "viem";

export function getInjectedProvider(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const provider = (window as unknown as { ethereum?: EIP1193Provider })
    .ethereum;
  return provider && typeof provider.request === "function"
    ? provider
    : undefined;
}

const firstAccount = (accounts: unknown): Address | undefined => {
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  return typeof first === "string"
    ? (first.toLowerCase() as Address)
    : undefined;
};

/** Accounts already shared with this site, without prompting. */
export async function connectedAccount(
  provider: EIP1193Provider,
): Promise<Address | undefined> {
  return firstAccount(await provider.request({ method: "eth_accounts" }));
}

/** Asks the wallet to connect (shows the wallet's prompt). */
export async function requestAccount(
  provider: EIP1193Provider,
): Promise<Address> {
  const account = firstAccount(
    await provider.request({ method: "eth_requestAccounts" }),
  );
  if (!account) throw new Error("The wallet didn't share an account.");
  return account;
}

/** Wallet error code for "this chain hasn't been added to the wallet" (EIP-3085 / EIP-3326). */
const UNRECOGNIZED_CHAIN = 4902;

/**
 * Makes sure the wallet is on `chain` before anything is signed: switches, and adds the chain
 * first if the wallet doesn't know it. The user approves both in the wallet.
 */
export async function ensureWalletChain(
  provider: EIP1193Provider,
  chain: Chain,
): Promise<void> {
  const current = await provider.request({ method: "eth_chainId" });
  if (typeof current === "string" && Number(current) === chain.id) return;
  const chainId = numberToHex(chain.id);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== UNRECOGNIZED_CHAIN) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
          blockExplorerUrls: chain.blockExplorers
            ? [chain.blockExplorers.default.url]
            : undefined,
        },
      ],
    });
  }
  const after = await provider.request({ method: "eth_chainId" });
  if (typeof after !== "string" || Number(after) !== chain.id) {
    throw new Error(
      `Switch your wallet to ${chain.name} (chain ${chain.id}) to continue. Nothing was sent.`,
    );
  }
}

/** Sends through the browser wallet, which signs and broadcasts. */
export function createInjectedWalletClient(
  provider: EIP1193Provider,
  chain: Chain,
  account: Address,
): WalletClient {
  return createWalletClient({
    chain,
    account: getAddress(account),
    transport: custom(provider),
  });
}
