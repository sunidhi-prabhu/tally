// Small localStorage-backed value stores for per-viewer conveniences, exposed for
// useSyncExternalStore. Never use these for secrets.

export interface LocalValueStore {
  get: () => string | undefined;
  set: (value: string | undefined) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLocalValueStore(key: string): LocalValueStore {
  const listeners = new Set<() => void>();
  let memory: string | undefined;
  return {
    get() {
      try {
        return window.localStorage.getItem(key) ?? memory;
      } catch {
        return memory;
      }
    },
    set(value) {
      memory = value;
      try {
        if (value === undefined) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch {
        // Storage unavailable (private mode): value lasts for this page only.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (e: StorageEvent) => e.key === key && listener();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

/** Which identity the viewer is using: anvil demo account, passkey wallet, or view-only. */
export const accountSourceStore = createLocalValueStore("tally:account-source");
/** Address chosen for demo or view-only use (public). */
export const selectedAddressStore = createLocalValueStore(
  "tally:selected-address",
);
