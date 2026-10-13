import type { Address, LocalAccount } from "viem";
import type { PasskeyWallet } from "./passkey/wallet";

export type AccountSource = "demo" | "passkey" | "view";

export type ResolvedSigner =
  | { kind: "demo"; address: Address }
  | { kind: "passkey"; account: LocalAccount };

/**
 * Decides who may sign as `sender`, before anything is signed. Throws with a user-facing reason
 * when the current source can't sign for exactly that address.
 */
export function resolveSigner(input: {
  source: AccountSource;
  sender: Address;
  allowDemoAccounts: boolean;
  demoAccounts: readonly Address[];
  passkeyWallet: PasskeyWallet | undefined;
  passkeyUnavailableReason?: string;
}): ResolvedSigner {
  const wanted = input.sender.toLowerCase() as Address;
  switch (input.source) {
    case "view":
      throw new Error("View-only accounts can't send transactions.");
    case "demo":
      if (!input.allowDemoAccounts)
        throw new Error("Demo accounts only exist in the local demo.");
      if (!input.demoAccounts.map((a) => a.toLowerCase()).includes(wanted)) {
        throw new Error(
          "That sender is not one of this node's demo accounts. Nothing was sent.",
        );
      }
      return { kind: "demo", address: wanted };
    case "passkey":
      if (!input.passkeyWallet) {
        throw new Error(
          input.passkeyUnavailableReason ?? "Passkeys aren't available here.",
        );
      }
      // Throws WalletLockedError, or a mismatch error if another address would sign.
      return {
        kind: "passkey",
        account: input.passkeyWallet.getAccount(wanted),
      };
  }
}
