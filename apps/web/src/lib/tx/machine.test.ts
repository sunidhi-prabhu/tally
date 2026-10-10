import { describe, expect, it } from "vitest";
import {
  isBusy,
  isConfirmed,
  txReducer,
  type TxEvent,
  type TxState,
} from "./machine";

const HASH = `0x${"1".repeat(64)}` as const;
const run = (events: TxEvent[]) =>
  events.reduce<TxState>(txReducer, { status: "idle" });

describe("transaction state machine", () => {
  it("is confirmed only after a successful receipt", () => {
    const steps: TxEvent[] = [
      { type: "prepare", label: "Pay" },
      { type: "request-signature" },
      { type: "submitted", hash: HASH },
    ];
    const pending = run(steps);
    expect(pending).toEqual({ status: "pending", label: "Pay", hash: HASH });
    expect(isConfirmed(pending)).toBe(false);
    expect(isBusy(pending)).toBe(true);

    const done = txReducer(pending, {
      type: "receipt",
      success: true,
      blockNumber: 26n,
    });
    expect(done).toEqual({
      status: "confirmed",
      label: "Pay",
      hash: HASH,
      blockNumber: 26n,
    });
    expect(isConfirmed(done)).toBe(true);
  });

  it("reports a revert, with its hash, as not completed", () => {
    const state = run([
      { type: "prepare", label: "Pay" },
      { type: "request-signature" },
      { type: "submitted", hash: HASH },
      { type: "receipt", success: false, blockNumber: 3n },
    ]);
    expect(state.status).toBe("reverted");
    expect(isConfirmed(state)).toBe(false);
  });

  it("a rejected signature fails without a hash", () => {
    const state = run([
      { type: "prepare", label: "Approve" },
      { type: "request-signature" },
      { type: "error", message: "You rejected the request." },
    ]);
    expect(state).toEqual({
      status: "failed",
      label: "Approve",
      message: "You rejected the request.",
    });
  });

  it("losing track of a broadcast transaction never claims success", () => {
    const state = run([
      { type: "prepare", label: "Pay" },
      { type: "request-signature" },
      { type: "submitted", hash: HASH },
      { type: "error", message: "Timed out." },
    ]);
    expect(state.status).toBe("failed");
    if (state.status === "failed") expect(state.message).toContain(HASH);
  });

  it("ignores out-of-order events and double starts", () => {
    expect(
      txReducer(
        { status: "idle" },
        { type: "receipt", success: true, blockNumber: 1n },
      ),
    ).toEqual({ status: "idle" });
    const preparing = run([{ type: "prepare", label: "A" }]);
    expect(txReducer(preparing, { type: "prepare", label: "B" })).toBe(
      preparing,
    );
    expect(txReducer(preparing, { type: "reset" })).toEqual({ status: "idle" });
  });
});
