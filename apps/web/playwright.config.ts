import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the LOCAL DEMO (see README): anvil + LocalDemo.s.sol, `pnpm dev` in
 * packages/indexer, and `next dev` here with NEXT_PUBLIC_TALLY_NETWORK=local-demo.
 * Not part of `pnpm check`, because they need the local chain and indexer running.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-1440",
      testIgnore: /flows\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "tablet-834",
      testIgnore: /flows\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 834, height: 1112 },
        hasTouch: true,
      },
    },
    {
      // Largest phone width in the spec (390–430 px). Transaction flows run once, at 390.
      name: "mobile-430",
      testIgnore: /flows\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 430, height: 932 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-390",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
