import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { monadTestnet } from "viem/chains";
import type { AppConfig } from "./config";

export function chainFor(config: AppConfig): Chain {
  if (config.mode === "monad-testnet") {
    return {
      ...monadTestnet,
      rpcUrls: { default: { http: [config.rpcUrl] } },
    };
  }
  return defineChain({
    id: config.chainId,
    name: "Anvil (local demo)",
    nativeCurrency: { name: "Local MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    testnet: true,
  });
}

export function createClients(config: AppConfig): {
  publicClient: PublicClient;
  chain: Chain;
} {
  const chain = chainFor(config);
  return {
    chain,
    publicClient: createPublicClient({ chain, transport: http(config.rpcUrl) }),
  };
}

/**
 * Local demo only: a JSON-RPC account, so the anvil node signs with its unlocked dev key.
 * No private key ever reaches the browser.
 */
export function createDemoWalletClient(
  config: AppConfig,
  chain: Chain,
  account: Address,
): WalletClient {
  if (config.mode !== "local-demo") {
    throw new Error("Demo accounts are only available in local-demo mode.");
  }
  return createWalletClient({ chain, account, transport: http(config.rpcUrl) });
}

/** A wallet client that signs locally with a Mera passkey account and sends raw transactions. */
export function createPasskeyWalletClient(
  config: AppConfig,
  chain: Chain,
  account: LocalAccount,
): WalletClient {
  return createWalletClient({ chain, account, transport: http(config.rpcUrl) });
}

/**
 * LOCAL DEMO ONLY: gives an address test MON on anvil so a passkey wallet can pay gas. Uses
 * anvil's dev-only `anvil_setBalance`; refuses on any other mode or chain.
 */
export async function fundLocalTestMon(
  config: AppConfig,
  chain: Chain,
  publicClient: PublicClient,
  address: Address,
  amountWei: bigint,
): Promise<void> {
  if (config.mode !== "local-demo")
    throw new Error("Test MON is only available in the local demo.");
  await assertExpectedChain(publicClient, config);
  const testClient = createTestClient({
    chain,
    mode: "anvil",
    transport: http(config.rpcUrl),
  });
  await testClient.setBalance({ address, value: amountWei });
}

/** Refuses to continue if the node is not on the configured chain. Never switches networks. */
export async function assertExpectedChain(
  publicClient: PublicClient,
  config: AppConfig,
): Promise<void> {
  const actual = await publicClient.getChainId();
  if (actual !== config.chainId) {
    throw new Error(
      `Connected node is on chain ${actual}, but this app is configured for ${config.label} ` +
        `(chain ${config.chainId}). Nothing was sent.`,
    );
  }
}
