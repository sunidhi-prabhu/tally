import { describe, expect, it } from "vitest";
import { LOCAL_DEMO, MONAD_TESTNET_AUSD, resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("refuses to run without an explicit network", () => {
    const result = resolveConfig({});
    expect(result.status).toBe("unconfigured");
  });

  it("local-demo uses the documented local defaults and allows demo accounts", () => {
    const result = resolveConfig({ NEXT_PUBLIC_TALLY_NETWORK: "local-demo" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.config).toMatchObject({
      mode: "local-demo",
      chainId: 31337,
      rpcUrl: LOCAL_DEMO.rpcUrl,
      ledgerAddress: LOCAL_DEMO.ledgerAddress,
      expectedTokenAddress: LOCAL_DEMO.mockTokenAddress,
      indexerWsUrl: "ws://localhost:8080/v1/graphql",
      allowDemoAccounts: true,
    });
  });

  it("local-demo never talks to a remote node", () => {
    const result = resolveConfig({
      NEXT_PUBLIC_TALLY_NETWORK: "local-demo",
      NEXT_PUBLIC_MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
    });
    expect(result.status).toBe("unconfigured");
    if (result.status === "unconfigured") {
      expect(result.problems.join(" ")).toMatch(/only talks to a local node/);
    }
  });

  it("monad-testnet has no default ledger address and no demo accounts", () => {
    const missing = resolveConfig({
      NEXT_PUBLIC_TALLY_NETWORK: "monad-testnet",
      NEXT_PUBLIC_MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
      NEXT_PUBLIC_INDEXER_GRAPHQL_URL: "https://indexer.example/v1/graphql",
    });
    expect(missing.status).toBe("unconfigured");
    if (missing.status === "unconfigured") {
      expect(missing.problems.join(" ")).toMatch(
        /no public TallyLedger deployment/,
      );
    }

    const ready = resolveConfig({
      NEXT_PUBLIC_TALLY_NETWORK: "monad-testnet",
      NEXT_PUBLIC_MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
      NEXT_PUBLIC_INDEXER_GRAPHQL_URL: "https://indexer.example/v1/graphql",
      NEXT_PUBLIC_TALLY_LEDGER_ADDRESS:
        "0x000000000000000000000000000000000000dEaD",
    });
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") return;
    expect(ready.config.allowDemoAccounts).toBe(false);
    expect(ready.config.chainId).toBe(10143);
    expect(ready.config.expectedTokenAddress).toBe(MONAD_TESTNET_AUSD);
    expect(ready.config.indexerWsUrl).toBe("wss://indexer.example/v1/graphql");
  });

  it("rejects a chain id that contradicts the network and invalid addresses", () => {
    const result = resolveConfig({
      NEXT_PUBLIC_TALLY_NETWORK: "local-demo",
      NEXT_PUBLIC_CHAIN_ID: "10143",
      NEXT_PUBLIC_TALLY_LEDGER_ADDRESS: "0x123",
    });
    expect(result.status).toBe("unconfigured");
    if (result.status === "unconfigured") {
      expect(result.problems).toHaveLength(2);
    }
  });

  it("gasless: on by default in the local demo, opt-in on testnet", () => {
    const demo = resolveConfig({ NEXT_PUBLIC_TALLY_NETWORK: "local-demo" });
    expect(demo.status === "ready" && demo.config.gasless).toBe(true);
    const demoOff = resolveConfig({
      NEXT_PUBLIC_TALLY_NETWORK: "local-demo",
      NEXT_PUBLIC_GASLESS: "false",
    });
    expect(demoOff.status === "ready" && demoOff.config.gasless).toBe(false);

    const testnet = {
      NEXT_PUBLIC_TALLY_NETWORK: "monad-testnet",
      NEXT_PUBLIC_MONAD_RPC_URL: "https://testnet-rpc.monad.xyz",
      NEXT_PUBLIC_TALLY_LEDGER_ADDRESS:
        "0x1111111111111111111111111111111111111111",
      NEXT_PUBLIC_INDEXER_GRAPHQL_URL: "https://indexer.example/v1/graphql",
    };
    const off = resolveConfig(testnet);
    expect(off.status === "ready" && off.config.gasless).toBe(false);
    const on = resolveConfig({
      ...testnet,
      NEXT_PUBLIC_GASLESS: "true",
      NEXT_PUBLIC_TALLY_ACCOUNT_ADDRESS:
        "0x2222222222222222222222222222222222222222",
    });
    expect(on.status === "ready" && on.config.gasless).toBe(true);
    // Enabling gasless without the smart-account address is a configuration error.
    expect(
      resolveConfig({ ...testnet, NEXT_PUBLIC_GASLESS: "true" }).status,
    ).toBe("unconfigured");
  });
});
