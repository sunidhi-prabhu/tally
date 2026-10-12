import {
  ANVIL_DEV_ACCOUNTS,
  EXPECTED_COMPILER,
  MONAD_MAINNET,
  MONAD_TESTNET,
} from "./networks.mjs";
import { SELECTORS, decodeAbiString } from "./rpc.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const pass = (name, detail) => ({ name, ok: true, detail });
const fail = (name, detail) => ({ name, ok: false, detail });

/** Variables that must never be used: signing must come from a keystore or hardware wallet. */
const FORBIDDEN_KEY_VARS = [
  "PRIVATE_KEY",
  "ETH_PRIVATE_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "MNEMONIC",
  "SEED_PHRASE",
];

export function isLocalRpc(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** Configuration from the environment. Never reads or prints secrets. */
export function checkEnv(env, { rehearsal = false } = {}) {
  const problems = [];
  const rpcUrl = (env.MONAD_TESTNET_RPC_URL ?? "").trim();
  const deployer = (env.DEPLOYER_ADDRESS ?? "").trim();
  const token = (env.AUSD_ADDRESS ?? "").trim();
  const account = (env.DEPLOYER_ACCOUNT ?? "").trim();
  const ledger = env.DEPLOYER_LEDGER === "true";

  if (!rpcUrl) problems.push("MONAD_TESTNET_RPC_URL is not set.");
  else {
    try {
      const host = new URL(rpcUrl).hostname;
      if (MONAD_MAINNET.publicRpcHosts.includes(host)) {
        problems.push(
          `MONAD_TESTNET_RPC_URL points at a Monad MAINNET endpoint (${host}).`,
        );
      }
    } catch {
      problems.push("MONAD_TESTNET_RPC_URL is not a valid URL.");
    }
  }
  if (!ADDRESS.test(deployer))
    problems.push(
      "DEPLOYER_ADDRESS must be the 0x address of your keystore or hardware wallet.",
    );
  if (!ADDRESS.test(token))
    problems.push(
      "AUSD_ADDRESS must be set to the Monad testnet AUSD address.",
    );
  // A local-fork rehearsal signs with anvil's --unlocked; real deployments need a keystore or Ledger.
  if (!rehearsal && !account && !ledger)
    problems.push(
      "Set DEPLOYER_ACCOUNT (Foundry keystore name) or DEPLOYER_LEDGER=true.",
    );
  if (account && ledger)
    problems.push("Set only one of DEPLOYER_ACCOUNT or DEPLOYER_LEDGER.");
  if (account && !/^[\w.-]+$/.test(account))
    problems.push(
      "DEPLOYER_ACCOUNT must be a keystore name, not a path or key.",
    );
  const leaked = FORBIDDEN_KEY_VARS.filter(
    (name) => (env[name] ?? "").trim() !== "",
  );
  if (leaked.length) {
    problems.push(
      `Refusing to run with ${leaked.join(", ")} set. Use a Foundry keystore (--account) or a hardware wallet.`,
    );
  }
  return problems.length
    ? fail("Configuration", problems.join(" "))
    : {
        ...pass(
          "Configuration",
          rehearsal
            ? "local-fork rehearsal (--unlocked)"
            : account
              ? `keystore "${account}"`
              : "hardware wallet (--ledger)",
        ),
        values: { rpcUrl, deployer, token, account, ledger },
      };
}

export async function checkChain(rpc) {
  try {
    const chainId = parseInt(await rpc("eth_chainId"), 16);
    if (chainId === MONAD_MAINNET.chainId)
      return fail(
        "Chain",
        "RPC is Monad MAINNET (143). This tooling only deploys to testnet.",
      );
    if (chainId !== MONAD_TESTNET.chainId)
      return fail(
        "Chain",
        `RPC chain ${chainId}, expected ${MONAD_TESTNET.chainId}.`,
      );
    const block = parseInt(await rpc("eth_blockNumber"), 16);
    return { ...pass("Chain", `chain ${chainId}, head block ${block}`), block };
  } catch (error) {
    return fail("Chain", `RPC unreachable: ${error.message}`);
  }
}

export async function checkToken(rpc, token) {
  const name = "Settlement token";
  const lower = token.toLowerCase();
  if (lower === MONAD_MAINNET.ausd.toLowerCase())
    return fail(
      name,
      `That is MAINNET AUSD. Testnet AUSD is ${MONAD_TESTNET.ausd.address}.`,
    );
  if (lower !== MONAD_TESTNET.ausd.address.toLowerCase()) {
    return fail(
      name,
      `${token} is not the verified testnet AUSD (${MONAD_TESTNET.ausd.address}).`,
    );
  }
  try {
    const code = await rpc("eth_getCode", [token, "latest"]);
    if (!code || code === "0x")
      return fail(name, `${token} has no code on this chain.`);
    const symbol = decodeAbiString(
      await rpc("eth_call", [{ to: token, data: SELECTORS.symbol }, "latest"]),
    );
    const decimals = parseInt(
      await rpc("eth_call", [
        { to: token, data: SELECTORS.decimals },
        "latest",
      ]),
      16,
    );
    if (
      symbol !== MONAD_TESTNET.ausd.symbol ||
      decimals !== MONAD_TESTNET.ausd.decimals
    ) {
      return fail(name, `metadata is ${symbol}/${decimals}, expected AUSD/6.`);
    }
    return pass(
      name,
      `${token} · ${symbol} · ${decimals} decimals · ${(code.length - 2) / 2} bytes`,
    );
  } catch (error) {
    return fail(name, `could not read token: ${error.message}`);
  }
}

/** Gas estimate for the CREATE transaction and the maximum it can cost (Monad charges the gas limit). */
export async function estimateDeployment(
  rpc,
  from,
  creationData,
  { limitMultiplierPct = 130n } = {},
) {
  const gas = BigInt(
    await rpc("eth_estimateGas", [{ from, data: creationData }]),
  );
  const gasPrice = BigInt(await rpc("eth_gasPrice"));
  const gasLimit = (gas * limitMultiplierPct) / 100n; // forge's default estimate multiplier
  return { gas, gasLimit, gasPrice, maxCostWei: gasLimit * gasPrice };
}

export async function checkDeployer(rpc, deployer, requiredWei) {
  const name = "Deployer";
  if (ANVIL_DEV_ACCOUNTS.includes(deployer.toLowerCase())) {
    return fail(
      name,
      `${deployer} is a public anvil dev account. Its key is public; never use it on a public network.`,
    );
  }
  try {
    const balance = BigInt(await rpc("eth_getBalance", [deployer, "latest"]));
    const fmt = (wei) => `${Number(wei / 10n ** 12n) / 1e6} MON`;
    if (requiredWei !== undefined && balance < requiredWei) {
      return fail(
        name,
        `${deployer} has ${fmt(balance)}; needs at least ${fmt(requiredWei)} (+ reserve). Fund it from ${MONAD_TESTNET.monFaucet}.`,
      );
    }
    return pass(
      name,
      `${deployer} · balance ${fmt(balance)}${requiredWei !== undefined ? ` · needs ≤ ${fmt(requiredWei)}` : ""}`,
    );
  } catch (error) {
    return fail(name, `could not read balance: ${error.message}`);
  }
}

/** Compiler settings in foundry.toml and in the build artifact must match what was tested. */
export function checkCompiler(forgeConfig, artifact) {
  const name = "Compiler";
  const problems = [];
  for (const [key, expected] of Object.entries(EXPECTED_COMPILER)) {
    if (forgeConfig[key] !== expected)
      problems.push(
        `${key}=${JSON.stringify(forgeConfig[key])} (expected ${JSON.stringify(expected)})`,
      );
  }
  const meta = artifact?.metadata;
  if (!meta) problems.push("build artifact missing; run forge build");
  else {
    if (
      !String(meta.compiler?.version ?? "").startsWith(EXPECTED_COMPILER.solc)
    )
      problems.push(`artifact compiled with ${meta.compiler?.version}`);
    if (meta.settings?.evmVersion !== EXPECTED_COMPILER.evm_version)
      problems.push(`artifact evmVersion ${meta.settings?.evmVersion}`);
    if (
      Boolean(meta.settings?.optimizer?.enabled) !== EXPECTED_COMPILER.optimizer
    )
      problems.push("artifact optimizer setting differs");
  }
  return problems.length
    ? fail(name, problems.join("; "))
    : pass(
        name,
        `solc ${meta.compiler.version} · evm ${meta.settings.evmVersion} · optimizer off · monad:MonadNine`,
      );
}

/** Creation bytecode with the ABI-encoded constructor argument (address token). */
export function creationData(artifact, token) {
  const bytecode = artifact.bytecode.object.replace(/^0x/, "");
  return `0x${bytecode}${token.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

/**
 * Whether broadcasting may proceed. Pure, so the gate itself is testable. All conditions are
 * required; any failure returns a reason and nothing is sent.
 */
export function decideBroadcast({
  preflightOk,
  env,
  isTTY,
  typedConfirmation,
  rehearsal,
  rpcUrl,
}) {
  if (!preflightOk)
    return { allowed: false, reason: "Preflight did not fully pass." };
  if (rehearsal) {
    if (!isLocalRpc(rpcUrl))
      return {
        allowed: false,
        reason: "--rehearsal only targets a local fork (127.0.0.1/localhost).",
      };
    return { allowed: true };
  }
  if (isLocalRpc(rpcUrl))
    return {
      allowed: false,
      reason:
        "RPC is local. Use --rehearsal for a local fork, or point at the real testnet RPC.",
    };
  if (env.TALLY_CONFIRM_DEPLOY !== `monad-testnet:${MONAD_TESTNET.chainId}`) {
    return {
      allowed: false,
      reason: `Set TALLY_CONFIRM_DEPLOY=monad-testnet:${MONAD_TESTNET.chainId} to confirm you intend to deploy.`,
    };
  }
  if (!isTTY)
    return {
      allowed: false,
      reason:
        "Broadcasting needs an interactive terminal for the final confirmation.",
    };
  if (typedConfirmation !== `deploy ${MONAD_TESTNET.chainId}`) {
    return {
      allowed: false,
      reason: "Confirmation text did not match. Nothing was sent.",
    };
  }
  return { allowed: true };
}

/** Zeroes immutable slots so runtime code can be compared with the artifact. */
export function maskImmutables(runtimeHex, immutableReferences) {
  let code = runtimeHex.replace(/^0x/, "").toLowerCase();
  for (const refs of Object.values(immutableReferences ?? {})) {
    for (const { start, length } of refs) {
      code =
        code.slice(0, start * 2) +
        "0".repeat(length * 2) +
        code.slice((start + length) * 2);
    }
  }
  return code;
}

/**
 * Builds the deployment manifest from a real broadcast record plus on-chain facts. Throws if any
 * fact disagrees; values are only ever copied from verified sources, never invented.
 */
export function buildManifest({
  broadcast,
  receipt,
  onchain,
  artifact,
  forgeConfig,
  recordedAt,
}) {
  const create = broadcast.transactions.find(
    (t) => t.transactionType === "CREATE" && t.contractName === "TallyLedger",
  );
  if (!create)
    throw new Error(
      "No TallyLedger CREATE transaction in the broadcast record.",
    );
  if (Number(broadcast.chain) !== MONAD_TESTNET.chainId)
    throw new Error(`Broadcast is for chain ${broadcast.chain}.`);
  if (!receipt || receipt.status !== "0x1")
    throw new Error("Deployment receipt missing or failed.");
  if (receipt.transactionHash?.toLowerCase() !== create.hash?.toLowerCase())
    throw new Error("Receipt hash differs from broadcast.");
  if (
    receipt.contractAddress?.toLowerCase() !==
    create.contractAddress?.toLowerCase()
  )
    throw new Error("Receipt address differs from broadcast.");
  if (onchain.chainId !== MONAD_TESTNET.chainId)
    throw new Error(`On-chain chain id ${onchain.chainId}.`);
  if (
    onchain.settlementToken.toLowerCase() !==
    MONAD_TESTNET.ausd.address.toLowerCase()
  )
    throw new Error("settlementToken() is not testnet AUSD.");
  const expected = maskImmutables(
    artifact.deployedBytecode.object,
    artifact.deployedBytecode.immutableReferences,
  );
  const actual = maskImmutables(
    onchain.code,
    artifact.deployedBytecode.immutableReferences,
  );
  if (expected !== actual)
    throw new Error(
      "On-chain runtime bytecode does not match the local build.",
    );
  return {
    network: MONAD_TESTNET.key,
    chainId: MONAD_TESTNET.chainId,
    status: "deployed",
    contract: "TallyLedger",
    address: receipt.contractAddress,
    deployer: receipt.from,
    settlementToken: {
      address: MONAD_TESTNET.ausd.address,
      symbol: "AUSD",
      decimals: 6,
    },
    constructorArgs: [MONAD_TESTNET.ausd.address],
    deploymentTxHash: receipt.transactionHash,
    deploymentBlock: parseInt(receipt.blockNumber, 16),
    gasUsed: parseInt(receipt.gasUsed, 16),
    compiler: {
      version: artifact.metadata.compiler.version,
      evmVersion: artifact.metadata.settings.evmVersion,
      optimizer: Boolean(artifact.metadata.settings.optimizer?.enabled),
      viaIR: Boolean(forgeConfig.via_ir),
      network: forgeConfig.network,
      hardfork: forgeConfig.hardfork,
    },
    runtimeBytecodeMatchesBuild: true,
    explorer: `${MONAD_TESTNET.explorer}/address/${receipt.contractAddress}`,
    recordedAt,
  };
}

/**
 * Verified record of the TallyAccount (EIP-7702 smart-account code) deployed in the same
 * broadcast as the ledger: the CREATE in the broadcast, a successful receipt for it, and
 * on-chain runtime code equal to the local build (immutables masked).
 */
export function buildAccountRecord({ broadcast, receipt, code, artifact }) {
  const create = broadcast.transactions.find(
    (t) => t.transactionType === "CREATE" && t.contractName === "TallyAccount",
  );
  if (!create)
    throw new Error(
      "No TallyAccount CREATE transaction in the broadcast record.",
    );
  if (!receipt || receipt.status !== "0x1")
    throw new Error("TallyAccount deployment receipt missing or failed.");
  if (receipt.transactionHash?.toLowerCase() !== create.hash?.toLowerCase())
    throw new Error("TallyAccount receipt hash differs from broadcast.");
  if (
    receipt.contractAddress?.toLowerCase() !==
    create.contractAddress?.toLowerCase()
  )
    throw new Error("TallyAccount receipt address differs from broadcast.");
  const refs = artifact.deployedBytecode.immutableReferences;
  if (
    maskImmutables(artifact.deployedBytecode.object, refs) !==
    maskImmutables(code, refs)
  )
    throw new Error(
      "TallyAccount on-chain runtime bytecode does not match the local build.",
    );
  return {
    contract: "TallyAccount",
    address: receipt.contractAddress,
    deploymentTxHash: receipt.transactionHash,
    deploymentBlock: parseInt(receipt.blockNumber, 16),
    gasUsed: parseInt(receipt.gasUsed, 16),
    runtimeBytecodeMatchesBuild: true,
    explorer: `${MONAD_TESTNET.explorer}/address/${receipt.contractAddress}`,
  };
}
