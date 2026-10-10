import { describe, expect, it } from "vitest";
import { resolveRpId } from "./rpId";
import { detectPasskeySupport } from "./support";

const base = {
  isSecureContext: true,
  hasPublicKeyCredential: true,
  hasRandomValues: true,
};

describe("detectPasskeySupport", () => {
  it.each([
    [{ ...base, isSecureContext: false }, /secure page/],
    [{ ...base, hasPublicKeyCredential: false }, /does not support passkeys/],
    [{ ...base, hasRandomValues: false }, /secure random/],
    [
      {
        ...base,
        getClientCapabilities: async () => ({ "extension:prf": false }),
      },
      /PRF extension is missing/,
    ],
  ])("reports unsupported environments (%#)", async (probe, reason) => {
    const result = await detectPasskeySupport(probe);
    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") expect(result.reason).toMatch(reason);
  });

  it("reports PRF support when the browser says so, unknown otherwise", async () => {
    expect(
      await detectPasskeySupport({
        ...base,
        getClientCapabilities: async () => ({ "extension:prf": true }),
      }),
    ).toEqual({
      status: "supported",
      prf: "yes",
    });
    expect(await detectPasskeySupport(base)).toEqual({
      status: "supported",
      prf: "unknown",
    });
    expect(
      await detectPasskeySupport({
        ...base,
        getClientCapabilities: async () => {
          throw new Error("nope");
        },
      }),
    ).toEqual({ status: "supported", prf: "unknown" });
  });
});

describe("resolveRpId", () => {
  it("defaults to the page host and accepts subdomains of the configured rpId", () => {
    expect(resolveRpId(undefined, "localhost")).toEqual({
      ok: true,
      rpId: "localhost",
    });
    expect(resolveRpId("tally.app", "www.tally.app")).toEqual({
      ok: true,
      rpId: "tally.app",
    });
    expect(resolveRpId("TALLY.app", "tally.app")).toEqual({
      ok: true,
      rpId: "tally.app",
    });
  });

  it("rejects a host outside the passkey domain", () => {
    const result = resolveRpId("tally.app", "evil-tally.app");
    expect(result.ok).toBe(false);
  });
});
