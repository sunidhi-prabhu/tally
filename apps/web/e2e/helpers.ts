import { expect, type Page } from "@playwright/test";

/** Picks anvil dev account N ("Demo N") in the local-demo account selector. */
export async function actAs(page: Page, n: number) {
  const select = page.getByLabel("Acting as");
  await expect(select).toBeEnabled();
  const option = select.locator("option", { hasText: `Demo ${n} ·` });
  await select.selectOption({ label: (await option.textContent())!.trim() });
}

/** Fails if the page scrolls horizontally (layout overflow). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

const INDEXER =
  process.env.E2E_INDEXER_URL ?? "http://localhost:8080/v1/graphql";

/** Current Trip (group 1) balances from the indexer, so tests don't depend on earlier runs. */
async function tripBalances(): Promise<{ address: string; net: bigint }[]> {
  const response = await fetch(INDEXER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query:
        '{ Membership(where: {group_id: {_eq: "1"}, active: {_eq: true}}) { address netBalance } }',
    }),
  });
  const body = (await response.json()) as {
    data: { Membership: { address: string; netBalance: string }[] };
  };
  return body.data.Membership.map((m) => ({
    address: m.address,
    net: BigInt(m.netBalance),
  }));
}

/** Selects the demo account for the first Trip member whose balance matches `sign`. */
export async function actAsTripMember(page: Page, sign: "debtor" | "creditor") {
  const select = page.getByLabel("Acting as");
  await expect(select).toBeEnabled();
  // Only demo accounts can be selected; other tests add passkey members to Trip too.
  const options = (await select.locator("option").allTextContents()).join(" ");
  const member = (await tripBalances()).find(
    (m) =>
      (sign === "debtor" ? m.net < 0n : m.net > 0n) &&
      options.includes(`${m.address.slice(0, 6)}…${m.address.slice(-4)}`),
  );
  if (!member)
    throw new Error(`No ${sign} in Trip; reset the local demo (see README).`);
  const short = `${member.address.slice(0, 6)}…${member.address.slice(-4)}`;
  const label = await select
    .locator("option", { hasText: short })
    .textContent();
  await select.selectOption({ label: label!.trim() });
}

/**
 * Adds a Chromium virtual WebAuthn authenticator with PRF (test-only DevTools facility), so the
 * real navigator.credentials + Mera browser path runs without a physical device.
 */
export async function addVirtualPasskeyAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        ctap2Version: "ctap2_1",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return {
    /** Makes the next user-verification fail, like cancelling Face ID. */
    async failVerification() {
      await cdp.send("WebAuthn.setUserVerified", {
        authenticatorId,
        isUserVerified: false,
      });
    },
    async passVerification() {
      await cdp.send("WebAuthn.setUserVerified", {
        authenticatorId,
        isUserVerified: true,
      });
    },
  };
}

/** Creates a passkey wallet on /account and returns its address. */
export async function createPasskeyWallet(page: Page): Promise<string> {
  await page.goto("/account");
  await page.getByRole("button", { name: "Create passkey wallet" }).click();
  const address = page.getByTestId("passkey-address");
  await expect(address).toHaveText(/^0x[0-9a-f]{40}$/);
  return (await address.textContent())!.trim();
}

/**
 * Full page loads discard the in-memory signing session by design, so the wallet comes back
 * locked. Navigates, then unlocks with the (virtual) passkey if the page asks for it.
 */
export async function gotoUnlocked(page: Page, url: string) {
  await page.goto(url);
  const unlock = page.getByRole("button", { name: "Unlock with passkey" });
  await page.waitForLoadState("networkidle");
  if (await unlock.isVisible()) {
    await unlock.click();
    await expect(unlock).toHaveCount(0);
  }
}
