#!/usr/bin/env node
// Guarded Monad TESTNET deployment for TallyLedger.
//
//   node scripts/deploy-testnet.mjs [preflight]   checks + forge simulation. NEVER broadcasts.
//   node scripts/deploy-testnet.mjs broadcast     human-approved deployment (see docs/DEPLOYMENT.md)
//   node scripts/deploy-testnet.mjs record        verify a real deployment and write the manifest
//
// Flags: --rehearsal   run broadcast/record against a LOCAL fork (anvil --fork-url ...) only.
//
// Signing only ever happens inside forge, via a Foundry keystore (--account) or a hardware
// wallet (--ledger). This file never reads, accepts or prints a private key.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  buildManifest,
  checkChain,
  checkCompiler,
  checkDeployer,
  checkEnv,
  checkToken,
  creationData,
  decideBroadcast,
  estimateDeployment,
  isLocalRpc,
} from "./lib/checks.mjs";
import {
  MANIFEST_PATH,
  MONAD_TESTNET,
  SCRIPT_BROADCAST_DIR,
  SCRIPT_PATH,
} from "./lib/networks.mjs";
import { SELECTORS, createRpc } from "./lib/rpc.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) ?? "preflight";
const rehearsal = args.includes("--rehearsal");
const REHEARSAL_BROADCAST_DIR = "broadcast-rehearsal";

/** Same file forge reads. Values already in the environment win. */
function loadDotEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function forge(argv, extraEnv = {}) {
  return spawnSync("forge", argv, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function readArtifact() {
  const path = join(ROOT, "out/TallyLedger.sol/TallyLedger.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

function report(results) {
  for (const r of results)
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(18)} ${r.detail}`);
}

async function preflight() {
  console.log(
    `Tally deployment preflight · Monad testnet (${MONAD_TESTNET.chainId})${rehearsal ? " · REHEARSAL (local fork)" : ""}`,
  );
  console.log("No transaction is broadcast by this command.\n");
  const results = [];
  const env = checkEnv(process.env, { rehearsal });
  results.push(env);
  if (!env.ok) return { ok: false, results };
  const { rpcUrl, deployer, token, account } = env.values;
  if (account && !rehearsal) {
    // Existence only; the encrypted keystore is opened by forge alone, with your password.
    const keystore = join(
      process.env.FOUNDRY_KEYSTORES_DIR ??
        join(homedir(), ".foundry/keystores"),
      account,
    );
    results.push(
      existsSync(keystore)
        ? {
            name: "Signer",
            ok: true,
            detail: `Foundry keystore "${account}" found (forge will ask for its password)`,
          }
        : {
            name: "Signer",
            ok: false,
            detail: `No Foundry keystore "${account}". Create one with: cast wallet import ${account} --interactive`,
          },
    );
  }
  if (isLocalRpc(rpcUrl) && !rehearsal) {
    results.push({
      name: "RPC",
      ok: false,
      detail:
        "RPC is local; use --rehearsal for a local fork, or the real testnet RPC.",
    });
    return { ok: false, results };
  }

  const build = forge(["build"]);
  const forgeConfig = JSON.parse(forge(["config", "--json"]).stdout || "{}");
  const artifact = readArtifact();
  results.push(
    build.status === 0
      ? checkCompiler(forgeConfig, artifact)
      : { name: "Compiler", ok: false, detail: "forge build failed" },
  );

  const rpc = createRpc(rpcUrl);
  const chain = await checkChain(rpc);
  results.push(chain);
  if (!chain.ok) return { ok: false, results };
  results.push(await checkToken(rpc, token));

  let required;
  if (artifact) {
    try {
      const estimate = await estimateDeployment(
        rpc,
        deployer,
        creationData(artifact, token),
      );
      // 20% reserve on top of the full gas limit for price movement between preflight and send.
      required = (estimate.maxCostWei * 120n) / 100n;
      results.push({
        name: "Cost estimate",
        ok: true,
        detail: `gas ${estimate.gas} · limit ${estimate.gasLimit} · price ${estimate.gasPrice} wei · max ${Number(estimate.maxCostWei / 10n ** 12n) / 1e6} MON`,
      });
    } catch (error) {
      results.push({ name: "Cost estimate", ok: false, detail: error.message });
    }
  }
  results.push(await checkDeployer(rpc, deployer, required));

  // Simulation only needs chain, token and compiler to be right; funding and signer can come later.
  const ready = results.every(
    (r) => r.ok || r.name === "Deployer" || r.name === "Signer",
  );
  if (ready) {
    // Simulation runs the real script against the live chain state. No --broadcast flag.
    const sim = forge(
      ["script", SCRIPT_PATH, "--rpc-url", rpcUrl, "--sender", deployer],
      { AUSD_ADDRESS: token },
    );
    const output = `${sim.stdout}\n${sim.stderr}`;
    const ok = sim.status === 0 && /Script ran successfully/.test(output);
    const predicted = /TallyLedger (0x[0-9a-fA-F]{40})/.exec(output)?.[1];
    results.push({
      name: "Simulation",
      ok,
      detail: ok
        ? `deploy script succeeds on current chain state${predicted ? ` (simulated address ${predicted}; final address depends on the deployer's nonce at send time)` : ""}`
        : output
            .split("\n")
            .filter((l) => /Error|revert/i.test(l))
            .slice(0, 3)
            .join(" | ") || "forge script failed",
    });
  } else {
    results.push({
      name: "Simulation",
      ok: false,
      detail: "skipped until the checks above pass",
    });
  }
  return { ok: results.every((r) => r.ok), results, values: env.values };
}

async function broadcast() {
  const pre = await preflight();
  report(pre.results);
  let typed;
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const early = decideBroadcast({
    preflightOk: pre.ok,
    env: process.env,
    isTTY,
    typedConfirmation: `deploy ${MONAD_TESTNET.chainId}`,
    rehearsal,
    rpcUrl: pre.values?.rpcUrl ?? "",
  });
  if (!early.allowed) {
    console.error(`\nNot broadcasting: ${early.reason}`);
    process.exit(1);
  }
  if (!rehearsal) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    console.log(
      `\nAbout to deploy TallyLedger to Monad TESTNET (${MONAD_TESTNET.chainId}) from ${pre.values.deployer}.`,
    );
    typed = (
      await rl.question(`Type "deploy ${MONAD_TESTNET.chainId}" to continue: `)
    ).trim();
    rl.close();
  }
  const decision = decideBroadcast({
    preflightOk: pre.ok,
    env: process.env,
    isTTY,
    typedConfirmation: typed,
    rehearsal,
    rpcUrl: pre.values.rpcUrl,
  });
  if (!decision.allowed) {
    console.error(`Not broadcasting: ${decision.reason}`);
    process.exit(1);
  }
  const { rpcUrl, deployer, token, account, ledger } = pre.values;
  const signer = rehearsal
    ? ["--unlocked"]
    : ledger
      ? ["--ledger"]
      : ["--account", account];
  const argv = [
    "script",
    SCRIPT_PATH,
    "--rpc-url",
    rpcUrl,
    "--sender",
    deployer,
    "--broadcast",
    "--slow",
    ...signer,
  ];
  console.log(`\nRunning: forge ${argv.join(" ")}`);
  const run = spawnSync("forge", argv, {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      AUSD_ADDRESS: token,
      ...(rehearsal ? { FOUNDRY_BROADCAST: REHEARSAL_BROADCAST_DIR } : {}),
    },
  });
  if (run.status !== 0) {
    console.error(
      "\nforge did not complete. Check the output above; nothing is recorded.",
    );
    process.exit(run.status ?? 1);
  }
  console.log(
    `\nNext: node scripts/deploy-testnet.mjs record${rehearsal ? " --rehearsal" : ""}`,
  );
}

async function record() {
  const env = checkEnv(process.env, { rehearsal });
  if (!env.ok) throw new Error(env.detail);
  const { rpcUrl } = env.values;
  if (isLocalRpc(rpcUrl) !== rehearsal)
    throw new Error(
      rehearsal
        ? "--rehearsal needs a local fork RPC."
        : "RPC is local; did you mean --rehearsal?",
    );
  const dir = rehearsal ? REHEARSAL_BROADCAST_DIR : "broadcast";
  const file = join(
    ROOT,
    dir,
    SCRIPT_BROADCAST_DIR,
    String(MONAD_TESTNET.chainId),
    "run-latest.json",
  );
  if (!existsSync(file))
    throw new Error(`No broadcast record at ${file}. Nothing was deployed.`);
  const broadcastRecord = JSON.parse(readFileSync(file, "utf8"));
  const create = broadcastRecord.transactions.find(
    (t) => t.transactionType === "CREATE" && t.contractName === "TallyLedger",
  );
  if (!create?.hash)
    throw new Error("Broadcast record has no TallyLedger transaction hash.");

  const rpc = createRpc(rpcUrl);
  const receipt = await rpc("eth_getTransactionReceipt", [create.hash]);
  const address = receipt?.contractAddress;
  const onchain = {
    chainId: parseInt(await rpc("eth_chainId"), 16),
    code: address ? await rpc("eth_getCode", [address, "latest"]) : "0x",
    settlementToken: address
      ? `0x${(await rpc("eth_call", [{ to: address, data: SELECTORS.settlementToken }, "latest"])).slice(-40)}`
      : "0x",
  };
  const forgeConfig = JSON.parse(forge(["config", "--json"]).stdout || "{}");
  const manifest = buildManifest({
    broadcast: broadcastRecord,
    receipt,
    onchain,
    artifact: readArtifact(),
    forgeConfig,
    recordedAt: new Date().toISOString(),
  });

  const target = rehearsal
    ? join(ROOT, "deployments/rehearsal/monad-testnet-fork.json")
    : join(ROOT, MANIFEST_PATH);
  if (!rehearsal && existsSync(target)) {
    const existing = JSON.parse(readFileSync(target, "utf8"));
    if (
      existing.status === "deployed" &&
      existing.address?.toLowerCase() !== manifest.address.toLowerCase() &&
      !args.includes("--replace")
    ) {
      throw new Error(
        `Manifest already records ${existing.address}. Pass --replace to record a redeployment.`,
      );
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Recorded verified deployment → ${target}`);
  console.log(
    JSON.stringify(
      {
        address: manifest.address,
        block: manifest.deploymentBlock,
        tx: manifest.deploymentTxHash,
      },
      null,
      2,
    ),
  );
}

loadDotEnv();
try {
  if (command === "preflight") {
    const result = await preflight();
    report(result.results);
    console.log(
      result.ok
        ? "\nPreflight PASSED. Nothing was broadcast."
        : "\nPreflight FAILED. Nothing was broadcast.",
    );
    process.exit(result.ok ? 0 : 1);
  } else if (command === "broadcast") {
    await broadcast();
  } else if (command === "record") {
    await record();
  } else {
    console.error(
      `Unknown command "${command}". Use preflight, broadcast or record.`,
    );
    process.exit(2);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
