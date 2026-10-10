import type { WebAuthnClient } from "@category-labs/mera";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function prf(secret: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(secret.length + salt.length);
  input.set(secret);
  input.set(salt, secret.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

/**
 * TEST ONLY: an in-memory authenticator implementing Mera's WebAuthnClient. PRF output is a
 * deterministic function of (credential secret, salt), like a real PRF-capable passkey.
 */
export function fakeAuthenticator(options: { prf?: boolean } = {}) {
  const credentials = new Map<string, Uint8Array>();
  let counter = 0;
  let failNext: DOMException | undefined;
  /** Which credential a discoverable (no allowCredential) request returns. */
  let choose: string | undefined;
  const calls = { create: 0, get: 0 };

  const client: WebAuthnClient = {
    async createCredential(request) {
      calls.create += 1;
      if (failNext) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      counter += 1;
      const id = new Uint8Array(16).fill(counter);
      const secret = new Uint8Array(32).fill(counter * 7);
      credentials.set(hex(id), secret);
      choose ??= hex(id);
      if (options.prf === false) return { credentialId: id, prfEnabled: false };
      return {
        credentialId: id,
        prfEnabled: true,
        prfOutput: await prf(secret, request.prfSalt),
        transports: ["internal"],
      };
    },
    async getCredential(request) {
      calls.get += 1;
      if (failNext) {
        const error = failNext;
        failNext = undefined;
        throw error;
      }
      const key = request.allowCredential
        ? hex(request.allowCredential.credentialId)
        : choose;
      const secret = key ? credentials.get(key) : undefined;
      if (!key || !secret)
        throw new DOMException("No credential", "NotAllowedError");
      const id = Uint8Array.from(key.match(/../g)!.map((h) => parseInt(h, 16)));
      if (options.prf === false) return { credentialId: id };
      return {
        credentialId: id,
        prfOutput: await prf(secret, request.prfSalt),
      };
    },
  };

  return {
    client,
    calls,
    failNextWith(name: string) {
      failNext = new DOMException(`fake ${name}`, name);
    },
    /** Simulate the user picking credential N (1-based) in a discoverable prompt. */
    pick(n: number) {
      choose = hex(new Uint8Array(16).fill(n));
    },
  };
}
