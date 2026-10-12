import { getAddress, isAddress, type Address } from "viem";

/**
 * Which network the app talks to. Chosen explicitly at build time; the app never switches
 * networks on its own.
 * - "local-demo": a local anvil node running packages/contracts/script/LocalDemo.s.sol, with
 *   its test-only MockToken. Writes are signed by anvil's unlocked dev accounts.
 * - "monad-testnet": a real TallyLedger deployment (none exists yet). Users sign with a Mera
 *   passkey wallet; there are no demo accounts.
 */
export type NetworkMode = "local-demo" | "monad-testnet";

export interface AppConfig {
  readonly mode: NetworkMode;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly ledgerAddress: Address;
  /** Expected settlement token. The app also reads `settlementToken()` from the ledger. */
  readonly expectedTokenAddress: Address | undefined;
  readonly indexerHttpUrl: string;
  readonly indexerWsUrl: string;
  /** Local demo only: anvil's unlocked dev accounts may sign. Passkey wallets work in every mode. */
  readonly allowDemoAccounts: boolean;
  /** WebAuthn relying-party ID for passkeys; undefined means "this page's hostname". */
  readonly passkeyRpId: string | undefined;
  /** TallyAccount: the EIP-7702 smart-account code passkey wallets delegate to. */
  readonly smartAccountAddress: Address | undefined;
  /**
   * Passkey wallets send through Tally's sponsor (/api/relay), which pays network fees.
   * Requires `smartAccountAddress`; off on testnet unless NEXT_PUBLIC_GASLESS=true.
   */
  readonly gasless: boolean;
  readonly label: string;
}

export type ConfigResult =
  | { readonly status: "ready"; readonly config: AppConfig }
  | { readonly status: "unconfigured"; readonly problems: readonly string[] };

/**
 * Local demo values. They exist only on a fresh anvil node after LocalDemo.s.sol: the
 * deterministic CREATE addresses of the deployer's first two transactions. MockToken is a
 * test token, NOT Agora AUSD.
 */
export const LOCAL_DEMO = {
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  ledgerAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  mockTokenAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  /** Deployed by anvil account 8 at nonce 0 in LocalDemo.s.sol. */
  smartAccountAddress: "0x95bD8D42f30351685e96C62EDdc0d0613bf9a87A",
  indexerHttpUrl: "http://localhost:8080/v1/graphql",
} as const;

export const MONAD_TESTNET_CHAIN_ID = 10143;
/** Agora AUSD on Monad testnet (docs.agora.finance/developer/contract-deployments). */
export const MONAD_TESTNET_AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";

export interface PublicEnv {
  readonly NEXT_PUBLIC_TALLY_NETWORK?: string;
  readonly NEXT_PUBLIC_CHAIN_ID?: string;
  readonly NEXT_PUBLIC_MONAD_RPC_URL?: string;
  readonly NEXT_PUBLIC_TALLY_LEDGER_ADDRESS?: string;
  readonly NEXT_PUBLIC_AUSD_ADDRESS?: string;
  readonly NEXT_PUBLIC_INDEXER_GRAPHQL_URL?: string;
  readonly NEXT_PUBLIC_PASSKEY_RP_ID?: string;
  readonly NEXT_PUBLIC_TALLY_ACCOUNT_ADDRESS?: string;
  readonly NEXT_PUBLIC_GASLESS?: string;
}

const blank = (value: string | undefined) => (value ?? "").trim() || undefined;

function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http(s?):\/\//, (_m, s: string) => `ws${s}://`);
}

/** Pure: resolves and validates configuration from public env vars. */
export function resolveConfig(env: PublicEnv): ConfigResult {
  const problems: string[] = [];
  const mode = blank(env.NEXT_PUBLIC_TALLY_NETWORK);
  if (mode !== "local-demo" && mode !== "monad-testnet") {
    return {
      status: "unconfigured",
      problems: [
        'Set NEXT_PUBLIC_TALLY_NETWORK to "local-demo" or "monad-testnet" (see apps/web/.env.example).',
      ],
    };
  }

  const demo = mode === "local-demo";
  const chainId = demo ? LOCAL_DEMO.chainId : MONAD_TESTNET_CHAIN_ID;
  const declaredChain = blank(env.NEXT_PUBLIC_CHAIN_ID);
  if (declaredChain && Number(declaredChain) !== chainId) {
    problems.push(
      `NEXT_PUBLIC_CHAIN_ID=${declaredChain} does not match ${mode} (chain ${chainId}).`,
    );
  }

  const rpcUrl =
    blank(env.NEXT_PUBLIC_MONAD_RPC_URL) ??
    (demo ? LOCAL_DEMO.rpcUrl : undefined);
  const ledger =
    blank(env.NEXT_PUBLIC_TALLY_LEDGER_ADDRESS) ??
    (demo ? LOCAL_DEMO.ledgerAddress : undefined);
  const token =
    blank(env.NEXT_PUBLIC_AUSD_ADDRESS) ??
    (demo ? LOCAL_DEMO.mockTokenAddress : MONAD_TESTNET_AUSD);
  const indexer =
    blank(env.NEXT_PUBLIC_INDEXER_GRAPHQL_URL) ??
    (demo ? LOCAL_DEMO.indexerHttpUrl : undefined);

  if (!rpcUrl) problems.push("NEXT_PUBLIC_MONAD_RPC_URL is not set.");
  if (!ledger) {
    problems.push(
      "NEXT_PUBLIC_TALLY_LEDGER_ADDRESS is not set. There is no public TallyLedger deployment yet.",
    );
  } else if (!isAddress(ledger)) {
    problems.push("NEXT_PUBLIC_TALLY_LEDGER_ADDRESS is not a valid address.");
  }
  if (!isAddress(token))
    problems.push("NEXT_PUBLIC_AUSD_ADDRESS is not a valid address.");
  if (!indexer) problems.push("NEXT_PUBLIC_INDEXER_GRAPHQL_URL is not set.");
  const smartAccount =
    blank(env.NEXT_PUBLIC_TALLY_ACCOUNT_ADDRESS) ??
    (demo ? LOCAL_DEMO.smartAccountAddress : undefined);
  if (smartAccount && !isAddress(smartAccount))
    problems.push("NEXT_PUBLIC_TALLY_ACCOUNT_ADDRESS is not a valid address.");
  const gaslessFlag = blank(env.NEXT_PUBLIC_GASLESS);
  // Local demo: on unless switched off. Testnet: only when explicitly enabled.
  const gaslessWanted = demo ? gaslessFlag !== "false" : gaslessFlag === "true";
  if (gaslessWanted && !smartAccount)
    problems.push(
      "NEXT_PUBLIC_GASLESS=true needs NEXT_PUBLIC_TALLY_ACCOUNT_ADDRESS (the TallyAccount deployment).",
    );
  if (
    demo &&
    rpcUrl &&
    !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(rpcUrl)
  ) {
    problems.push(
      "local-demo mode only talks to a local node (127.0.0.1 or localhost).",
    );
  }

  if (problems.length > 0 || !rpcUrl || !ledger || !indexer) {
    return { status: "unconfigured", problems };
  }
  return {
    status: "ready",
    config: {
      mode,
      chainId,
      rpcUrl,
      ledgerAddress: getAddress(ledger),
      expectedTokenAddress: getAddress(token),
      indexerHttpUrl: indexer,
      indexerWsUrl: toWsUrl(indexer),
      allowDemoAccounts: demo,
      passkeyRpId: blank(env.NEXT_PUBLIC_PASSKEY_RP_ID),
      smartAccountAddress:
        smartAccount && isAddress(smartAccount)
          ? getAddress(smartAccount)
          : undefined,
      gasless: gaslessWanted && smartAccount !== undefined,
      label: demo ? "Local demo · anvil" : "Monad testnet",
    },
  };
}

// Next.js inlines NEXT_PUBLIC_* only for literal `process.env.X` reads.
export const configResult: ConfigResult = resolveConfig({
  NEXT_PUBLIC_TALLY_NETWORK: process.env.NEXT_PUBLIC_TALLY_NETWORK,
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_MONAD_RPC_URL: process.env.NEXT_PUBLIC_MONAD_RPC_URL,
  NEXT_PUBLIC_TALLY_LEDGER_ADDRESS:
    process.env.NEXT_PUBLIC_TALLY_LEDGER_ADDRESS,
  NEXT_PUBLIC_AUSD_ADDRESS: process.env.NEXT_PUBLIC_AUSD_ADDRESS,
  NEXT_PUBLIC_INDEXER_GRAPHQL_URL: process.env.NEXT_PUBLIC_INDEXER_GRAPHQL_URL,
  NEXT_PUBLIC_PASSKEY_RP_ID: process.env.NEXT_PUBLIC_PASSKEY_RP_ID,
  NEXT_PUBLIC_TALLY_ACCOUNT_ADDRESS:
    process.env.NEXT_PUBLIC_TALLY_ACCOUNT_ADDRESS,
  NEXT_PUBLIC_GASLESS: process.env.NEXT_PUBLIC_GASLESS,
});
