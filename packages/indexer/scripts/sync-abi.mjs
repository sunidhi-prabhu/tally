// Copies the TallyLedger ABI from the Foundry build output into abis/.
// Run `pnpm --filter @tally/contracts build` first. `--check` fails if the copy is stale.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = resolve(
  root,
  "../contracts/out/TallyLedger.sol/TallyLedger.json",
);
const target = resolve(root, "abis/TallyLedger.json");

if (!existsSync(resolve(root, "../contracts/foundry.toml"))) {
  // Isolated checkout (e.g. Envio Cloud uploads only packages/indexer): use the committed ABI.
  console.log(
    "packages/contracts not present (standalone build); using the committed ABI.",
  );
  process.exit(0);
}
if (!existsSync(artifact)) {
  console.error(
    "Contracts are not built. Run: pnpm --filter @tally/contracts build",
  );
  process.exit(1);
}
const abi = `${JSON.stringify(JSON.parse(readFileSync(artifact, "utf8")).abi, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== abi) {
    console.error(
      "abis/TallyLedger.json is out of date. Run: pnpm --filter @tally/indexer abi:sync",
    );
    process.exit(1);
  }
  console.log("ABI is up to date.");
} else {
  writeFileSync(target, abi);
  console.log(`Wrote ${target}`);
}
