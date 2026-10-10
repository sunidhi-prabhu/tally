// Simulates an Envio Cloud build: copies only what would be uploaded from packages/indexer
// into a temp directory OUTSIDE the workspace, installs with the pnpm major Envio Cloud uses
// (no lockfile, no parent workspace), then runs codegen, typecheck and the unit tests there.
// Local verification only; it never contacts Envio Cloud and needs no API token.
//
//   pnpm --filter @tally/indexer verify:standalone [--keep]
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Envio Cloud's documented build image uses pnpm 10.x; pin the version we verified against.
const PNPM = "pnpm@10.32.0";
const keep = process.argv.includes("--keep");

const run = (cmd, args, cwd) => {
  console.log(`\n$ ${[cmd, ...args].join(" ")}`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      // Never forward a real token into the simulation.
      ENVIO_API_TOKEN: "",
      CI: "1",
    },
  });
};

// What a git-based upload contains: tracked + untracked-but-not-ignored files, minus build
// output and local-only dotfiles.
const uploaded = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "."],
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((f) => !/^(generated|node_modules)\//.test(f))
  .filter(
    (f) => f === ".npmrc" || !f.split("/").some((part) => part.startsWith(".")),
  );

const dir = mkdtempSync(join(tmpdir(), "tally-indexer-standalone-"));
console.log(`Copying ${uploaded.length} files to ${dir}`);
for (const file of uploaded) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  cpSync(join(ROOT, file), join(dir, file));
}

try {
  run(
    "corepack",
    [
      PNPM,
      "install",
      "--no-frozen-lockfile",
      "--config.confirmModulesPurge=false",
    ],
    dir,
  );
  run("corepack", [PNPM, "run", "build"], dir); // ABI/core checks skip: siblings absent
  run("corepack", [PNPM, "exec", "envio", "codegen"], dir);
  run("corepack", [PNPM, "exec", "tsc", "--noEmit"], dir);
  run("corepack", [PNPM, "exec", "vitest", "run"], dir);
  console.log(
    `\nStandalone build OK (${uploaded.length} files, ${PNPM}, outside the workspace).`,
  );
} finally {
  if (keep) console.log(`Kept ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}
