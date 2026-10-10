#!/usr/bin/env node
// Gate for live Monad testnet indexing. Refuses to start unless the indexer is pointed at the
// VERIFIED deployment recorded in packages/contracts/deployments/monad-testnet.json.
//
//   node scripts/check-testnet.mjs                 verify env + manifest + chain, then exit
//   node scripts/check-testnet.mjs --config-only   only validate that the testnet config generates
//                                                  (uses obviously fake values; never indexes)
//   --manifest <path>                              check against another manifest (rehearsals)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestFlag = process.argv.indexOf("--manifest");
const MANIFEST =
  manifestFlag > -1
    ? resolve(process.argv[manifestFlag + 1] ?? "")
    : join(ROOT, "../contracts/deployments/monad-testnet.json");
const TESTNET_CHAIN_ID = 10143;
const configOnly = process.argv.includes("--config-only");

function loadDotEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function run(cmd, args, env = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

/** Regenerates types for the default (local) config afterwards, so local work is unaffected. */
function validateConfigGeneration(address, startBlock) {
  const gen = run("pnpm", ["exec", "envio", "codegen"], {
    ENVIO_CONFIG: "config.monad-testnet.yaml",
    ENVIO_TALLY_LEDGER_ADDRESS: address,
    ENVIO_TALLY_LEDGER_START_BLOCK: String(startBlock),
  });
  const types = existsSync(join(ROOT, ".envio/types.d.ts"))
    ? readFileSync(join(ROOT, ".envio/types.d.ts"), "utf8")
    : "";
  const ok = gen.status === 0 && types.includes(`${TESTNET_CHAIN_ID}`);
  run("pnpm", ["exec", "envio", "codegen"]); // restore local types
  return ok;
}

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

loadDotEnv();
const abi = run("node", ["scripts/sync-abi.mjs", "--check"]);
check(
  "ABI",
  abi.status === 0,
  abi.status === 0
    ? "abis/TallyLedger.json matches the contracts build"
    : (abi.stderr || abi.stdout).trim(),
);

if (configOnly) {
  // Fake, clearly-invalid values: proves the config parses and generates. Nothing is indexed.
  const ok = validateConfigGeneration(
    "0x000000000000000000000000000000000000dEaD",
    1,
  );
  check(
    "Config generation",
    ok,
    ok
      ? "config.monad-testnet.yaml generates for chain 10143 (placeholder values, no indexing)"
      : "envio codegen failed",
  );
} else {
  const manifest = existsSync(MANIFEST)
    ? JSON.parse(readFileSync(MANIFEST, "utf8"))
    : undefined;
  const deployed =
    manifest?.status === "deployed" &&
    manifest.address &&
    Number.isInteger(manifest.deploymentBlock);
  check(
    "Deployment",
    Boolean(deployed),
    deployed
      ? `${manifest.address} at block ${manifest.deploymentBlock}`
      : "No verified deployment in packages/contracts/deployments/monad-testnet.json. Deploy and run deploy:testnet:record first.",
  );
  const address = (process.env.ENVIO_TALLY_LEDGER_ADDRESS ?? "").trim();
  const start = Number(
    (process.env.ENVIO_TALLY_LEDGER_START_BLOCK ?? "").trim(),
  );
  if (deployed) {
    check(
      "Address",
      address.toLowerCase() === manifest.address.toLowerCase(),
      address
        ? `ENVIO_TALLY_LEDGER_ADDRESS=${address}`
        : "ENVIO_TALLY_LEDGER_ADDRESS is not set",
    );
    check(
      "Start block",
      Number.isInteger(start) && start > 0 && start <= manifest.deploymentBlock,
      Number.isInteger(start) && start > 0
        ? `${start} (deployment block ${manifest.deploymentBlock}; must not be later)`
        : "ENVIO_TALLY_LEDGER_START_BLOCK is not set",
    );
    const rpcUrl =
      process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
    try {
      const chain = parseInt(await rpc(rpcUrl, "eth_chainId"), 16);
      const code = await rpc(rpcUrl, "eth_getCode", [
        manifest.address,
        "latest",
      ]);
      check(
        "On-chain",
        chain === TESTNET_CHAIN_ID && code !== "0x",
        `chain ${chain}, ${code === "0x" ? "NO CODE" : "contract code present"}`,
      );
    } catch (error) {
      check("On-chain", false, `RPC error: ${error.message}`);
    }
  }
  check(
    "HyperSync token",
    Boolean((process.env.ENVIO_API_TOKEN ?? "").trim()),
    "ENVIO_API_TOKEN is required to read Monad testnet via HyperSync",
  );
  if (deployed && results.every((r) => r.ok)) {
    const ok = validateConfigGeneration(address, start);
    check(
      "Config generation",
      ok,
      ok
        ? "config.monad-testnet.yaml generates for chain 10143"
        : "envio codegen failed",
    );
  }
}

for (const r of results)
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(18)} ${r.detail}`);
const ok = results.every((r) => r.ok);
console.log(
  configOnly
    ? ok
      ? "\nTestnet config is valid. Live indexing still needs a verified deployment (run without --config-only)."
      : "\nTestnet config is NOT valid."
    : ok
      ? "\nReady for live testnet indexing."
      : "\nNot ready. Live testnet indexing was NOT started.",
);
process.exit(ok ? 0 : 1);
