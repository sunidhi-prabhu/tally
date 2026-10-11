import { expect, test } from "@playwright/test";
import {
  addVirtualPasskeyAuthenticator,
  createPasskeyWallet,
  expectNoHorizontalScroll,
  gotoUnlocked,
} from "./helpers";

// Sends real transactions to the LOCAL anvil chain, signed in the browser by a Mera passkey
// wallet (virtual PRF authenticator). Runs once, on the mobile viewport.
test("a passkey wallet creates a group, adds an expense, pays and acknowledges", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await addVirtualPasskeyAuthenticator(page);
  const me = await createPasskeyWallet(page);

  // No gas sponsorship: fund the wallet with test MON (local anvil only).
  await page.getByRole("button", { name: "Add 1 test MON" }).click();
  await expect(page.getByText(/^1 MON for network fees/)).toBeVisible();

  // Create a group with Demo 1 (0x7099…79c8) as a member; the passkey wallet is the admin.
  await gotoUnlocked(page, "/groups/new");
  await page.getByLabel("Group name").fill("Passkey trip");
  await page
    .getByLabel("Add members (optional)")
    .fill("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  await page.getByRole("button", { name: "Add to list" }).click();
  await page.getByRole("button", { name: "Create group" }).click();
  await page
    .getByRole("dialog", { name: "Create this group?" })
    .getByRole("button", { name: "Create" })
    .click();
  // The app opens the group only after the transaction is confirmed and indexed.
  await expect(page).toHaveURL(/\/groups\/\d+$/, { timeout: 60_000 });
  await expect(
    page.getByRole("heading", { name: "Passkey trip" }),
  ).toBeVisible();
  const groupUrl = page.url();

  // Reloading locks the wallet (as phones often do). The group page must say so and offer the
  // unlock, not silently hide "Add expense".
  await page.goto(groupUrl);
  const myCard = page.getByRole("region", {
    name: "Your balance in this group",
  });
  await expect(myCard.getByText("Your passkey wallet is locked")).toBeVisible();
  await expect(myCard.getByRole("link", { name: "Add expense" })).toHaveCount(
    0,
  );
  await myCard.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(myCard.getByRole("link", { name: "Add expense" })).toBeVisible();
  await expect(myCard.getByRole("link", { name: "Settle up" })).toBeVisible();

  // Expense paid by the passkey wallet: equal split → Demo 1 owes 5.
  await gotoUnlocked(page, `${groupUrl}/expenses/new`);
  await expect(page.getByLabel("Paid by")).toContainText("You");
  await page.getByLabel("Description").fill("Passkey dinner");
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Review expense" }).click();
  await page
    .getByRole("dialog", { name: "Add this expense?" })
    .getByRole("button", { name: "Add expense" })
    .click();
  await expect(page.getByText("Add expense: confirmed")).toBeVisible();
  await expect(page.getByText("Balances are updated.")).toBeVisible();

  // Acknowledge 1 AUSD received from Demo 1, signed by the passkey wallet.
  await gotoUnlocked(page, `${groupUrl}/settle`);
  const ack = page.getByRole("region", { name: "Mark as received" });
  await ack.getByLabel("Amount received").fill("1");
  await ack.getByRole("button", { name: /^Mark .* as received$/ }).click();
  await page
    .getByRole("dialog", { name: "Record a payment you received?" })
    .getByRole("button", { name: "Yes, I was paid" })
    .click();
  await expect(ack.getByText("Mark as received: confirmed")).toBeVisible();

  // Demo 1 records an expense the passkey wallet owes (custom split, all on the passkey wallet).
  await page.goto("/account");
  const demoSelect = page.getByRole("combobox", { name: "Demo account" });
  const demo1 = (await demoSelect
    .locator("option", { hasText: "Demo 1 ·" })
    .textContent())!.trim();
  await demoSelect.selectOption({ label: demo1 });
  await page.goto(`${groupUrl}/expenses/new`);
  await page.getByLabel("Description").fill("Demo 1 paid taxi");
  await page.getByLabel("Amount", { exact: true }).fill("12");
  await page.getByText("Custom amounts").click();
  await page.getByLabel("Share for you").fill("0");
  await page.getByLabel(/^Share for 0x/).fill("12");
  await page.getByRole("button", { name: "Review expense" }).click();
  await page
    .getByRole("dialog", { name: "Add this expense?" })
    .getByRole("button", { name: "Add expense" })
    .click();
  await expect(page.getByText("Add expense: confirmed")).toBeVisible();

  // Back to the passkey wallet, which now owes Demo 1: pay with tokens (mint → approve → pay).
  await gotoUnlocked(page, "/account"); // unlocking on /account also switches to the wallet
  const use = page.getByRole("button", { name: "Use this wallet" });
  if (await use.isVisible()) await use.click();
  await expect(page.getByTestId("account-chip")).toContainText(
    "Passkey wallet",
  );
  await gotoUnlocked(page, `${groupUrl}/settle`);
  const pay = page.getByRole("region", { name: "Pay with AUSD" });
  await expect(pay).toBeVisible();
  const mint = pay.getByRole("button", { name: /^Mint .* test tokens$/ });
  if (await mint.isVisible()) {
    await mint.click();
    await expect(pay.getByText("Mint test tokens: confirmed")).toBeVisible();
  }
  await pay.getByRole("button", { name: /^Approve / }).click();
  await page
    .getByRole("dialog", { name: "Approve token spending?" })
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(pay.getByText("Approve: confirmed")).toBeVisible();
  await pay.getByRole("button", { name: /^Pay .* AUSD$/ }).click();
  await page
    .getByRole("dialog", { name: "Send this payment?" })
    .getByRole("button", { name: "Pay now" })
    .click();
  await expect(pay.getByText("Pay: confirmed")).toBeVisible();
  await expect(pay.getByText(/Tx 0x[0-9a-f]{8}/).last()).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The payment shows as a verified token transfer from the passkey wallet.
  await page.goto(groupUrl);
  await page.getByRole("tab", { name: "Settlements" }).click();
  await expect(
    page.getByRole("tabpanel").getByText("Paid in AUSD").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("tabpanel").getByText("Marked as received").first(),
  ).toBeVisible();

  // Locked wallets can't send until unlocked with the passkey.
  await gotoUnlocked(page, "/account");
  await page.getByRole("button", { name: "Lock now" }).click();
  await expect(
    page.getByText("You locked your wallet.", { exact: false }),
  ).toBeVisible();
  await page.goto(`${groupUrl}/expenses/new`);
  await expect(
    page.getByText("Your passkey wallet is locked. Unlock it to send."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(
    page.getByRole("button", { name: "Review expense" }),
  ).toBeVisible();
  expect(me).toMatch(/^0x/);
});
