import { expect, test, type Page } from "@playwright/test";

// "Pay with any wallet": a stand-in for MetaMask/Rabby (EIP-1193 `window.ethereum`) that
// forwards to the LOCAL anvil node, which signs with its unlocked dev account. It starts on the
// wrong network, so the app must switch it before signing. Sends real local transactions; runs
// once, on the mobile viewport (other projects ignore *flows.spec).
const CAROL = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"; // anvil #2, a Trip member

async function installFakeWallet(page: Page) {
  await page.addInitScript(
    ({ account, rpc }) => {
      let chainId = "0x1"; // wrong network until the app switches it
      const calls: string[] = [];
      const listeners: Record<string, ((v: unknown) => void)[]> = {};
      const forward = async (method: string, params: unknown) => {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const body = (await res.json()) as {
          result?: unknown;
          error?: { message: string };
        };
        if (body.error) throw new Error(body.error.message);
        return body.result;
      };
      (window as unknown as { __walletCalls: string[] }).__walletCalls = calls;
      (window as unknown as { ethereum: unknown }).ethereum = {
        async request({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }) {
          calls.push(method);
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [account];
            case "eth_chainId":
              return chainId;
            case "wallet_switchEthereumChain":
              chainId = (params![0] as { chainId: string }).chainId;
              listeners.chainChanged?.forEach((l) => l(chainId));
              return null;
            default:
              return forward(method, params ?? []);
          }
        },
        on(event: string, listener: (v: unknown) => void) {
          (listeners[event] ??= []).push(listener);
        },
        removeListener() {},
      };
    },
    { account: CAROL, rpc: "http://127.0.0.1:8545" },
  );
}

test("a browser wallet connects, switches network and pays for an expense", async ({
  page,
}) => {
  await installFakeWallet(page);
  await page.goto("/account");
  await page.getByRole("button", { name: "Connect browser wallet" }).click();
  await expect(page.getByTestId("injected-address")).toHaveText(CAROL);
  await expect(page.getByTestId("account-chip")).toContainText(
    "Browser wallet",
  );

  await page.goto("/groups/1/expenses/new");
  await page.getByLabel("Description").fill("E2E wallet lunch");
  await page.getByLabel("Amount", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Review expense" }).click();
  await page
    .getByRole("dialog", { name: "Add this expense?" })
    .getByRole("button", { name: "Add expense" })
    .click();
  await expect(page.getByText("Add expense: confirmed")).toBeVisible();
  // Measured, not claimed: "confirmed 0.42 s after sending".
  await expect(
    page.getByText(/confirmed \d+(\.\d+)? s after sending/),
  ).toBeVisible();
  await expect(page.getByText("Balances are updated.")).toBeVisible();

  const calls = await page.evaluate(
    () => (window as unknown as { __walletCalls: string[] }).__walletCalls,
  );
  // The wallet was switched to the app's chain before it was asked to send.
  expect(calls).toContain("wallet_switchEthereumChain");
  expect(calls.indexOf("wallet_switchEthereumChain")).toBeLessThan(
    calls.indexOf("eth_sendTransaction"),
  );
});
