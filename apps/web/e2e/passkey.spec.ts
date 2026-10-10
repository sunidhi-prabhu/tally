import { expect, test } from "@playwright/test";
import {
  addVirtualPasskeyAuthenticator,
  createPasskeyWallet,
  expectNoHorizontalScroll,
} from "./helpers";

// Real WebAuthn + Mera in Chromium with a virtual PRF authenticator (no physical device).
test.describe("passkey onboarding", () => {
  test("create, reload (locked), unlock to the same wallet", async ({
    page,
  }, info) => {
    await addVirtualPasskeyAuthenticator(page);
    const address = await createPasskeyWallet(page);
    await expect(page.getByText("Unlocked", { exact: true })).toBeVisible();
    await expect(page.getByTestId("account-chip")).toContainText(
      "Passkey wallet",
    );
    await expect(
      page.getByText(/This is not a smart account and fees are not sponsored/),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: `test-results/screens/${info.project.name}-account.png`,
      fullPage: true,
    });

    await page.reload();
    await expect(
      page.getByText("Your wallet locks whenever the page reloads.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("passkey-address")).toHaveText(address);
    await expect(page.getByTestId("account-chip")).toContainText("locked");

    await page.getByRole("button", { name: "Unlock with passkey" }).click();
    await expect(page.getByText("Unlocked", { exact: true })).toBeVisible();
    await expect(page.getByTestId("passkey-address")).toHaveText(address);
  });

  test("a cancelled passkey prompt changes nothing", async ({ page }) => {
    const auth = await addVirtualPasskeyAuthenticator(page);
    await auth.failVerification();
    await page.goto("/account");
    await page.getByRole("button", { name: "Create passkey wallet" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByTestId("passkey-address")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create passkey wallet" }),
    ).toBeEnabled();
  });

  test("view-only identities can't reach a send button", async ({ page }) => {
    await page.goto("/account");
    await page
      .getByLabel("Address (read-only)")
      .fill("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
    await page.getByRole("button", { name: "View read-only" }).click();
    await page.goto("/groups/1/expenses/new");
    await expect(
      page.getByText("View-only. Sign in with a passkey to send."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review expense" }),
    ).toHaveCount(0);
  });
});
