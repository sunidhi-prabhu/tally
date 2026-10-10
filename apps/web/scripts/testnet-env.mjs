#!/usr/bin/env node
// Prints the apps/web/.env.local block for Monad testnet from the VERIFIED deployment manifest.
// Refuses while no deployment is recorded, so no address is ever typed by hand or invented.
//
//   node scripts/testnet-env.mjs --indexer https://<your-envio-endpoint>/v1/graphql --rp-id tally.example
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const manifestPath =
  arg("--manifest") ??
  join(ROOT, "../../packages/contracts/deployments/monad-testnet.json");
const indexer = arg("--indexer");
const rpId = arg("--rp-id");
const problems = [];

const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : undefined;
if (manifest?.status !== "deployed" || !manifest.address) {
  problems.push(
    "No verified deployment recorded. Deploy, then run `pnpm --filter @tally/contracts deploy:testnet:record`.",
  );
} else if (manifest.chainId !== 10143) {
  problems.push(
    `Manifest is for chain ${manifest.chainId}, not Monad testnet (10143).`,
  );
}
if (!indexer)
  problems.push(
    "Pass --indexer <Envio GraphQL URL> (from your Envio deployment).",
  );
else if (!/^https:\/\//.test(indexer))
  problems.push("The indexer URL must be https:// for a public deployment.");
if (!rpId)
  problems.push(
    "Pass --rp-id <your production domain> (passkeys are bound to it).",
  );

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`# Monad testnet · TallyLedger ${manifest.address} (block ${manifest.deploymentBlock}, tx ${manifest.deploymentTxHash})
NEXT_PUBLIC_TALLY_NETWORK=monad-testnet
NEXT_PUBLIC_CHAIN_ID=10143
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_TALLY_LEDGER_ADDRESS=${manifest.address}
NEXT_PUBLIC_AUSD_ADDRESS=${manifest.settlementToken.address}
NEXT_PUBLIC_INDEXER_GRAPHQL_URL=${indexer}
NEXT_PUBLIC_PASSKEY_RP_ID=${rpId}`);
