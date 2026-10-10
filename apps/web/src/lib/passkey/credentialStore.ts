// Remembers which passkey belongs to this app, as recommended by Mera's "Create passkey accounts"
// recipe: only the credential ID, its transport hints and the public address. None of these is
// secret or can sign anything. Private keys, PRF output and sessions are never stored.

export interface StoredPasskey {
  credentialId: string;
  transports?: readonly string[];
  address: `0x${string}`;
  rpId: string;
}

const KEY = "tally:passkey-credential";
const listeners = new Set<() => void>();
let cached:
  { raw: string | null; value: StoredPasskey | undefined } | undefined;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): StoredPasskey | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StoredPasskey>;
    if (
      typeof value.credentialId === "string" &&
      typeof value.rpId === "string" &&
      typeof value.address === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(value.address)
    ) {
      return {
        credentialId: value.credentialId,
        rpId: value.rpId,
        address: value.address as `0x${string}`,
        transports: Array.isArray(value.transports)
          ? value.transports.filter((t) => typeof t === "string")
          : undefined,
      };
    }
  } catch {
    // ignore corrupt data
  }
  return undefined;
}

/** Stable snapshot for useSyncExternalStore. */
export function getStoredPasskey(): StoredPasskey | undefined {
  const raw = readRaw();
  if (!cached || cached.raw !== raw) cached = { raw, value: parse(raw) };
  return cached.value;
}

export function saveStoredPasskey(value: StoredPasskey | undefined): void {
  try {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the user will pick the passkey from the browser prompt next time.
  }
  for (const listener of listeners) listener();
}

export function subscribeStoredPasskey(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
