// node --test scripts/  (no network: every RPC call is stubbed)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAccountRecord,
  buildManifest,
  checkChain,
  checkCompiler,
  checkDeployer,
  checkEnv,
  checkToken,
  creationData,
  decideBroadcast,
  maskImmutables,
} from "./lib/checks.mjs";
import {
  EXPECTED_COMPILER,
  MONAD_MAINNET,
  MONAD_TESTNET,
} from "./lib/networks.mjs";
import { decodeAbiString, SELECTORS } from "./lib/rpc.mjs";

const AUSD = MONAD_TESTNET.ausd.address;
const DEPLOYER = "0x1234567890123456789012345678901234567890";
const hex = (n) => `0x${BigInt(n).toString(16)}`;
const abiString = (s) => {
  const data = Buffer.from(s, "utf8").toString("hex");
  return `0x${"20".padStart(64, "0")}${s.length.toString(16).padStart(64, "0")}${data.padEnd(64, "0")}`;
};

/** Stub RPC answering like Monad testnet with real AUSD, overridable per test. */
function stubRpc(overrides = {}) {
  return async (method, params = []) => {
    if (method in overrides) {
      const value = overrides[method];
      return typeof value === "function" ? value(params) : value;
    }
    switch (method) {
      case "eth_chainId":
        return hex(10143);
      case "eth_blockNumber":
        return hex(69_859_365);
      case "eth_getCode":
        return "0x6080";
      case "eth_getBalance":
        return hex(10n ** 18n);
      case "eth_call":
        return params[0].data === SELECTORS.symbol ? abiString("AUSD") : hex(6);
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
}

const goodEnv = {
  MONAD_TESTNET_RPC_URL: "https://testnet-rpc.monad.xyz",
  DEPLOYER_ADDRESS: DEPLOYER,
  AUSD_ADDRESS: AUSD,
  DEPLOYER_ACCOUNT: "tally-deployer",
};

describe("configuration", () => {
  it("accepts a complete keystore configuration", () => {
    const result = checkEnv(goodEnv);
    assert.equal(result.ok, true);
    assert.equal(result.values.account, "tally-deployer");
  });

  it("fails closed on missing configuration", () => {
    const result = checkEnv({});
    assert.equal(result.ok, false);
    assert.match(result.detail, /MONAD_TESTNET_RPC_URL is not set/);
    assert.match(result.detail, /DEPLOYER_ADDRESS/);
    assert.match(result.detail, /AUSD_ADDRESS/);
    assert.match(result.detail, /DEPLOYER_ACCOUNT/);
  });

  it("refuses a mainnet RPC endpoint", () => {
    const result = checkEnv({
      ...goodEnv,
      MONAD_TESTNET_RPC_URL: "https://rpc.monad.xyz",
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /MAINNET endpoint/);
  });

  it("refuses to run when a private key or mnemonic is in the environment", () => {
    for (const name of ["PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY", "MNEMONIC"]) {
      const result = checkEnv({ ...goodEnv, [name]: "anything" });
      assert.equal(result.ok, false);
      assert.match(result.detail, /keystore/);
      assert.doesNotMatch(result.detail, /anything/);
    }
  });

  it("a local-fork rehearsal needs no signer configuration", () => {
    assert.equal(checkEnv({ ...goodEnv, DEPLOYER_ACCOUNT: "" }).ok, false);
    assert.equal(
      checkEnv({ ...goodEnv, DEPLOYER_ACCOUNT: "" }, { rehearsal: true }).ok,
      true,
    );
  });

  it("requires exactly one signer kind and a plain keystore name", () => {
    assert.equal(checkEnv({ ...goodEnv, DEPLOYER_LEDGER: "true" }).ok, false);
    assert.equal(
      checkEnv({ ...goodEnv, DEPLOYER_ACCOUNT: "../keys/x" }).ok,
      false,
    );
    assert.equal(
      checkEnv({ ...goodEnv, DEPLOYER_ACCOUNT: "", DEPLOYER_LEDGER: "true" })
        .ok,
      true,
    );
  });
});

describe("chain", () => {
  it("accepts Monad testnet", async () => {
    const result = await checkChain(stubRpc());
    assert.equal(result.ok, true);
    assert.equal(result.block, 69_859_365);
  });

  it("rejects mainnet and any other chain", async () => {
    const mainnet = await checkChain(stubRpc({ eth_chainId: hex(143) }));
    assert.equal(mainnet.ok, false);
    assert.match(mainnet.detail, /MAINNET/);
    const other = await checkChain(stubRpc({ eth_chainId: hex(31337) }));
    assert.equal(other.ok, false);
    assert.match(other.detail, /expected 10143/);
  });

  it("reports an unreachable RPC", async () => {
    const result = await checkChain(
      stubRpc({ eth_chainId: () => Promise.reject(new Error("ECONNREFUSED")) }),
    );
    assert.equal(result.ok, false);
    assert.match(result.detail, /unreachable/);
  });
});

describe("settlement token", () => {
  it("accepts verified testnet AUSD", async () => {
    assert.equal((await checkToken(stubRpc(), AUSD)).ok, true);
  });

  it("rejects mainnet AUSD and unknown tokens", async () => {
    const mainnet = await checkToken(stubRpc(), MONAD_MAINNET.ausd);
    assert.equal(mainnet.ok, false);
    assert.match(mainnet.detail, /MAINNET AUSD/);
    const other = await checkToken(stubRpc(), DEPLOYER);
    assert.equal(other.ok, false);
    assert.match(other.detail, /not the verified testnet AUSD/);
  });

  it("rejects a token with no code or wrong metadata", async () => {
    assert.match(
      (await checkToken(stubRpc({ eth_getCode: "0x" }), AUSD)).detail,
      /no code/,
    );
    const wrongSymbol = stubRpc({
      eth_call: ([call]) =>
        call.data === SELECTORS.symbol ? abiString("USDC") : hex(6),
    });
    assert.match((await checkToken(wrongSymbol, AUSD)).detail, /USDC\/6/);
    const wrongDecimals = stubRpc({
      eth_call: ([call]) =>
        call.data === SELECTORS.symbol ? abiString("AUSD") : hex(18),
    });
    assert.match((await checkToken(wrongDecimals, AUSD)).detail, /AUSD\/18/);
  });
});

describe("deployer", () => {
  it("rejects anvil development accounts", async () => {
    const result = await checkDeployer(
      stubRpc(),
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      1n,
    );
    assert.equal(result.ok, false);
    assert.match(result.detail, /public anvil dev account/);
  });

  it("fails when the balance can't cover the maximum cost", async () => {
    const result = await checkDeployer(
      stubRpc({ eth_getBalance: hex(0) }),
      DEPLOYER,
      10n ** 16n,
    );
    assert.equal(result.ok, false);
    assert.match(result.detail, /needs at least/);
    assert.equal(
      (await checkDeployer(stubRpc(), DEPLOYER, 10n ** 16n)).ok,
      true,
    );
  });
});

describe("compiler", () => {
  const artifact = {
    metadata: {
      compiler: { version: "0.8.37+commit.x" },
      settings: { evmVersion: "osaka", optimizer: { enabled: false } },
    },
  };
  it("accepts the tested configuration", () => {
    assert.equal(checkCompiler({ ...EXPECTED_COMPILER }, artifact).ok, true);
  });
  it("rejects drift in foundry.toml or the build", () => {
    assert.equal(
      checkCompiler({ ...EXPECTED_COMPILER, optimizer: true }, artifact).ok,
      false,
    );
    assert.equal(
      checkCompiler(
        { ...EXPECTED_COMPILER, hardfork: "monad:MonadTen" },
        artifact,
      ).ok,
      false,
    );
    const otherBuild = {
      metadata: {
        ...artifact.metadata,
        settings: { evmVersion: "prague", optimizer: { enabled: false } },
      },
    };
    assert.equal(checkCompiler({ ...EXPECTED_COMPILER }, otherBuild).ok, false);
    assert.equal(checkCompiler({ ...EXPECTED_COMPILER }, undefined).ok, false);
  });
});

describe("broadcast gate", () => {
  const base = {
    preflightOk: true,
    env: { TALLY_CONFIRM_DEPLOY: "monad-testnet:10143" },
    isTTY: true,
    typedConfirmation: "deploy 10143",
    rehearsal: false,
    rpcUrl: "https://testnet-rpc.monad.xyz",
  };
  it("allows only when every condition holds", () => {
    assert.deepEqual(decideBroadcast(base), { allowed: true });
  });
  for (const [label, change, reason] of [
    ["failed preflight", { preflightOk: false }, /Preflight/],
    ["no confirmation variable", { env: {} }, /TALLY_CONFIRM_DEPLOY/],
    [
      "wrong confirmation variable",
      { env: { TALLY_CONFIRM_DEPLOY: "monad-mainnet:143" } },
      /TALLY_CONFIRM_DEPLOY/,
    ],
    ["non-interactive", { isTTY: false }, /interactive terminal/],
    [
      "mistyped confirmation",
      { typedConfirmation: "deploy 143" },
      /did not match/,
    ],
    [
      "local RPC without rehearsal",
      { rpcUrl: "http://127.0.0.1:8545" },
      /--rehearsal/,
    ],
    ["rehearsal against a public RPC", { rehearsal: true }, /local fork/],
  ]) {
    it(`refuses: ${label}`, () => {
      const decision = decideBroadcast({ ...base, ...change });
      assert.equal(decision.allowed, false);
      assert.match(decision.reason, reason);
    });
  }
  it("rehearsal is allowed only against a local fork", () => {
    assert.equal(
      decideBroadcast({
        ...base,
        rehearsal: true,
        rpcUrl: "http://127.0.0.1:8545",
        env: {},
      }).allowed,
      true,
    );
  });
});

describe("encoding and manifest", () => {
  it("appends the ABI-encoded token address to the creation bytecode", () => {
    const data = creationData({ bytecode: { object: "0x6080" } }, AUSD);
    assert.equal(
      data,
      `0x6080${AUSD.slice(2).toLowerCase().padStart(64, "0")}`,
    );
  });

  it("decodes ABI strings", () => {
    assert.equal(decodeAbiString(abiString("AUSD")), "AUSD");
  });

  it("masks immutables before comparing runtime code", () => {
    assert.equal(
      maskImmutables("0xaabbccdd", { 1: [{ start: 1, length: 2 }] }),
      "aa0000dd",
    );
  });

  const ADDRESS = "0x00000000000000000000000000000000000000aa";
  const fixture = () => ({
    broadcast: {
      chain: 10143,
      transactions: [
        {
          transactionType: "CREATE",
          contractName: "TallyLedger",
          hash: "0xabc",
          contractAddress: ADDRESS,
        },
      ],
    },
    receipt: {
      status: "0x1",
      transactionHash: "0xabc",
      contractAddress: ADDRESS,
      from: DEPLOYER,
      blockNumber: hex(100),
      gasUsed: hex(2_900_000),
    },
    onchain: { chainId: 10143, code: "0x60ff11", settlementToken: AUSD },
    artifact: {
      deployedBytecode: {
        object: "0x600011",
        immutableReferences: { 7: [{ start: 1, length: 1 }] },
      },
      metadata: {
        compiler: { version: "0.8.37+commit.x" },
        settings: { evmVersion: "osaka", optimizer: { enabled: false } },
      },
    },
    forgeConfig: { ...EXPECTED_COMPILER },
    recordedAt: "2026-10-10T00:00:00.000Z",
  });

  it("records only verified values", () => {
    const manifest = buildManifest(fixture());
    assert.equal(manifest.status, "deployed");
    assert.equal(manifest.address, ADDRESS);
    assert.equal(manifest.deploymentBlock, 100);
    assert.equal(manifest.deploymentTxHash, "0xabc");
    assert.equal(manifest.deployer, DEPLOYER);
    assert.equal(manifest.chainId, 10143);
    assert.equal(manifest.runtimeBytecodeMatchesBuild, true);
  });

  for (const [label, mutate, message] of [
    ["failed receipt", (f) => (f.receipt.status = "0x0"), /failed/],
    ["wrong chain", (f) => (f.onchain.chainId = 143), /chain id 143/],
    [
      "wrong token",
      (f) => (f.onchain.settlementToken = MONAD_MAINNET.ausd),
      /not testnet AUSD/,
    ],
    [
      "different bytecode",
      (f) => (f.onchain.code = "0x60ff12"),
      /does not match/,
    ],
    [
      "address mismatch",
      (f) => (f.receipt.contractAddress = DEPLOYER),
      /address differs/,
    ],
    ["no create tx", (f) => (f.broadcast.transactions = []), /No TallyLedger/],
  ]) {
    it(`refuses to record: ${label}`, () => {
      const f = fixture();
      mutate(f);
      assert.throws(() => buildManifest(f), message);
    });
  }
});

describe("buildAccountRecord (TallyAccount in the same broadcast)", () => {
  const ACCOUNT = "0x00000000000000000000000000000000000000ac";
  const accountFixture = () => ({
    broadcast: {
      chain: 10143,
      transactions: [
        {
          transactionType: "CREATE",
          contractName: "TallyLedger",
          hash: "0x01",
          contractAddress: "0x0a",
        },
        {
          transactionType: "CREATE",
          contractName: "TallyAccount",
          hash: "0x02",
          contractAddress: ACCOUNT,
        },
      ],
    },
    receipt: {
      status: "0x1",
      transactionHash: "0x02",
      contractAddress: ACCOUNT,
      blockNumber: "0x10",
      gasUsed: "0x20",
    },
    // Runtime code with one 2-byte immutable at offset 1, different on-chain (masked).
    code: "0xaa1234bb",
    artifact: {
      deployedBytecode: {
        object: "0xaa0000bb",
        immutableReferences: { 7: [{ start: 1, length: 2 }] },
      },
    },
  });

  it("records only verified facts", () => {
    assert.deepEqual(buildAccountRecord(accountFixture()), {
      contract: "TallyAccount",
      address: ACCOUNT,
      deploymentTxHash: "0x02",
      deploymentBlock: 16,
      gasUsed: 32,
      runtimeBytecodeMatchesBuild: true,
      explorer: `https://testnet.monadscan.com/address/${ACCOUNT}`,
    });
  });

  for (const [name, mutate, message] of [
    [
      "no TallyAccount CREATE",
      (f) => (f.broadcast.transactions = f.broadcast.transactions.slice(0, 1)),
      /No TallyAccount CREATE/,
    ],
    ["failed receipt", (f) => (f.receipt.status = "0x0"), /missing or failed/],
    [
      "receipt for another tx",
      (f) => (f.receipt.transactionHash = "0x99"),
      /hash differs/,
    ],
    [
      "receipt at another address",
      (f) =>
        (f.receipt.contractAddress =
          "0x00000000000000000000000000000000000000ff"),
      /address differs/,
    ],
    [
      "different runtime code",
      (f) => (f.code = "0xcc1234bb"),
      /does not match the local build/,
    ],
  ]) {
    it(`refuses: ${name}`, () => {
      const f = accountFixture();
      mutate(f);
      assert.throws(() => buildAccountRecord(f), message);
    });
  }
});
