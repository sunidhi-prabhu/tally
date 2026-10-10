// Envio Cloud uploads only packages/indexer, so the indexer must not depend on anything outside
// it. These checks keep it self-contained and keep the vendored core identical to packages/core.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODULES, checkCore } from "../scripts/sync-core.mjs";
import * as core from "../src/core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|mts|mjs|js)$/.test(name) ? [path] : [];
  });
}

const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

describe("standalone indexer (Envio Cloud uploads only this directory)", () => {
  const files = ["src", "test", "scripts"].flatMap((d) =>
    sources(join(ROOT, d)),
  );

  it("never imports workspace packages", () => {
    const offenders = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(IMPORT)]
        .map((m) => m[1]!)
        .filter((spec) => spec.startsWith("@tally/"))
        .map((spec) => `${relative(ROOT, file)}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("never imports files outside the indexer directory", () => {
    const offenders = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(IMPORT)]
        .map((m) => m[1]!)
        .filter((spec) => spec.startsWith("."))
        .filter((spec) =>
          relative(ROOT, resolve(dirname(file), spec)).startsWith(".."),
        )
        .map((spec) => `${relative(ROOT, file)}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("declares no workspace dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      expect(String(version), name).not.toMatch(/^(workspace|link|file):/);
    }
  });

  it("bundles the core accounting rules the handlers use", () => {
    for (const name of [
      "ledgerEntryDeltas",
      "computeBalances",
      "maxSettleable",
      "splitEqual",
      "splitCustom",
      "isTallyError",
    ]) {
      expect(typeof (core as Record<string, unknown>)[name], name).toBe(
        "function",
      );
    }
  });
});

describe.skipIf(!existsSync(resolve(ROOT, "../core/package.json")))(
  "vendored core (monorepo only)",
  () => {
    it("is byte-identical to packages/core/src", () => {
      expect(checkCore()).toEqual([]);
      expect(MODULES.length).toBeGreaterThan(0);
    });
  },
);
