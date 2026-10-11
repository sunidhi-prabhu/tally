import { describe, expect, it } from "vitest";
import { classifyHealth } from "./useIndexerHealth";

const meta = (chainId: number, progressBlock: number, isReady = true) => ({
  chainId,
  progressBlock,
  sourceBlock: progressBlock,
  isReady,
});

describe("classifyHealth", () => {
  it("treats a few blocks of lag on Monad testnet as live", () => {
    const health = classifyHealth(
      meta(10143, 1000),
      false,
      1006n,
      false,
      10143,
    );
    expect(health).toMatchObject({ status: "synced", lagBlocks: 6 });
  });

  it("reports Monad testnet as behind once lag exceeds about 10 seconds", () => {
    expect(
      classifyHealth(meta(10143, 1000), false, 1025n, false, 10143).status,
    ).toBe("synced");
    expect(
      classifyHealth(meta(10143, 1000), false, 1026n, false, 10143).status,
    ).toBe("behind");
  });

  it("stays strict on the local anvil chain", () => {
    expect(
      classifyHealth(meta(31337, 10), false, 12n, false, 31337).status,
    ).toBe("synced");
    expect(
      classifyHealth(meta(31337, 10), false, 13n, false, 31337).status,
    ).toBe("behind");
  });

  it("is behind while the indexer is not ready, whatever the lag", () => {
    expect(
      classifyHealth(meta(10143, 1000, false), false, 1000n, false, 10143)
        .status,
    ).toBe("behind");
  });

  it("flags the wrong chain and offline services", () => {
    expect(classifyHealth(meta(1, 5), false, 5n, false, 10143).status).toBe(
      "wrong-chain",
    );
    expect(classifyHealth(undefined, true, 5n, false, 10143).status).toBe(
      "indexer-offline",
    );
    expect(
      classifyHealth(meta(10143, 5), false, undefined, true, 10143).status,
    ).toBe("rpc-offline");
  });
});
