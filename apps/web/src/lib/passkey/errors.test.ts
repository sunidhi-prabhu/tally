import { MeraError } from "@category-labs/mera";
import { describe, expect, it } from "vitest";
import { describePasskeyError } from "./errors";

describe("describePasskeyError", () => {
  it.each([
    [new MeraError("PRF_UNAVAILABLE", "x"), "prf-unavailable"],
    [new MeraError("SESSION_ENDED", "x"), "session-ended"],
    [new MeraError("CRYPTO_UNAVAILABLE", "x"), "unsupported"],
    [
      new MeraError("PASSKEY_OPERATION_FAILED", "x", {
        cause: new DOMException("x", "NotAllowedError"),
      }),
      "cancelled",
    ],
    [
      new MeraError("PASSKEY_OPERATION_FAILED", "x", {
        cause: new DOMException("x", "SecurityError"),
      }),
      "unsupported",
    ],
    [new MeraError("PASSKEY_OPERATION_FAILED", "x"), "failed"],
    [new Error("random"), "failed"],
  ])("maps %s → %s", (error, kind) => {
    expect(describePasskeyError(error).kind).toBe(kind);
  });

  it("never echoes raw error text that could contain sensitive data", () => {
    const failure = describePasskeyError(new Error("secret 0xdeadbeef"));
    expect(failure.message).not.toContain("0xdeadbeef");
  });
});
