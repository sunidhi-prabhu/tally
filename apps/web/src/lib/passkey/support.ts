/** What the current browser can do with passkeys. Mera additionally needs the PRF extension. */
export type PasskeySupport =
  | { status: "supported"; prf: "yes" | "unknown" }
  | { status: "unsupported"; reason: string };

interface CapabilityProbe {
  isSecureContext: boolean;
  hasPublicKeyCredential: boolean;
  hasRandomValues: boolean;
  /** PublicKeyCredential.getClientCapabilities(), where the browser implements it. */
  getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
}

export function probeFromWindow(): CapabilityProbe {
  const pkc = (
    globalThis as {
      PublicKeyCredential?: {
        getClientCapabilities?: () => Promise<Record<string, boolean>>;
      };
    }
  ).PublicKeyCredential;
  return {
    isSecureContext: globalThis.isSecureContext === true,
    hasPublicKeyCredential: typeof pkc === "function",
    hasRandomValues: typeof globalThis.crypto?.getRandomValues === "function",
    getClientCapabilities: pkc?.getClientCapabilities?.bind(pkc),
  };
}

/**
 * Checks passkey support. PRF support often can't be detected up front; "unknown" means we try
 * and report PRF_UNAVAILABLE clearly if the authenticator lacks it.
 */
export async function detectPasskeySupport(
  probe: CapabilityProbe = probeFromWindow(),
): Promise<PasskeySupport> {
  if (!probe.isSecureContext) {
    return {
      status: "unsupported",
      reason:
        "Passkeys need a secure page (HTTPS, or localhost during development).",
    };
  }
  if (!probe.hasPublicKeyCredential) {
    return {
      status: "unsupported",
      reason: "This browser does not support passkeys (WebAuthn).",
    };
  }
  if (!probe.hasRandomValues) {
    return {
      status: "unsupported",
      reason:
        "This browser lacks secure random numbers (crypto.getRandomValues).",
    };
  }
  if (probe.getClientCapabilities) {
    try {
      const caps = await probe.getClientCapabilities();
      if (caps["extension:prf"] === false) {
        return {
          status: "unsupported",
          reason:
            "This browser's passkeys can't derive a wallet key (the WebAuthn PRF extension is missing). Try iCloud Keychain, Google Password Manager or 1Password.",
        };
      }
      if (caps["extension:prf"] === true)
        return { status: "supported", prf: "yes" };
    } catch {
      // Capability query failed; fall through to "unknown".
    }
  }
  return { status: "supported", prf: "unknown" };
}
