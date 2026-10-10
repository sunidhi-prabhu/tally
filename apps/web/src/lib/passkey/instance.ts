import { PasskeyWallet } from "./wallet";
import { getStoredPasskey, saveStoredPasskey } from "./credentialStore";

let instance: { rpId: string; wallet: PasskeyWallet } | undefined;

/** One PasskeyWallet per page and rpId (browser only). */
export function getPasskeyWallet(rpId: string): PasskeyWallet {
  if (!instance || instance.rpId !== rpId) {
    instance?.wallet.dispose();
    instance = {
      rpId,
      wallet: new PasskeyWallet({
        rpId,
        store: { get: getStoredPasskey, save: saveStoredPasskey },
      }),
    };
  }
  return instance.wallet;
}
