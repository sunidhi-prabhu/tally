import { isMeraError } from "@category-labs/mera";

export type PasskeyErrorKind =
  "cancelled" | "prf-unavailable" | "unsupported" | "session-ended" | "failed";

export interface PasskeyFailure {
  kind: PasskeyErrorKind;
  message: string;
}

/** Finds the underlying WebAuthn error name (e.g. NotAllowedError). Structural check, because
 * DOMException is not an Error subclass in every environment. */
function causeName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    const name = (current as { name?: unknown }).name;
    if (typeof name === "string" && name !== "Error" && name !== "MeraError")
      return name;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Maps Mera / WebAuthn failures to user-facing messages. Never includes key material. */
export function describePasskeyError(error: unknown): PasskeyFailure {
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return {
          kind: "prf-unavailable",
          message:
            "This passkey provider can't derive a wallet key (no WebAuthn PRF support). Use iCloud Keychain, Google Password Manager or 1Password. Chrome's local profile, Bitwarden and Dashlane don't support it.",
        };
      case "CRYPTO_UNAVAILABLE":
        return {
          kind: "unsupported",
          message: "This browser lacks the cryptography passkey wallets need.",
        };
      case "SESSION_ENDED":
        return {
          kind: "session-ended",
          message:
            "Your wallet is locked. Confirm with your passkey to continue.",
        };
      case "PASSKEY_OPERATION_FAILED": {
        const name = causeName(error);
        if (name === "NotAllowedError" || name === "AbortError") {
          return {
            kind: "cancelled",
            message: "Passkey request cancelled or timed out. Nothing changed.",
          };
        }
        if (name === "InvalidStateError") {
          return {
            kind: "failed",
            message:
              "This device already has a matching passkey. Try signing in instead.",
          };
        }
        if (name === "SecurityError") {
          return {
            kind: "unsupported",
            message: "The browser blocked passkeys for this domain.",
          };
        }
        return {
          kind: "failed",
          message: "The passkey request didn't complete. Please try again.",
        };
      }
      default:
        return {
          kind: "failed",
          message: "Something went wrong with the passkey.",
        };
    }
  }
  return { kind: "failed", message: "Something went wrong with the passkey." };
}
