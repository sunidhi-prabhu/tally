import { expect, test } from "@playwright/test";
import { actAs, actAsTripMember, expectNoHorizontalScroll } from "./helpers";

// Sends transactions to the LOCAL anvil demo chain only. Runs once, on the mobile viewport
// (the desktop and tablet projects ignore this file in playwright.config.ts).
test.describe.configure({ mode: "serial" });

test("add an equal-split expense", async ({ page }) => {
  await page.goto("/");
  await actAs(page, 0);
  await page.goto("/groups/1/expenses/new");
  await page.getByLabel("Description").fill("E2E lunch");
  await page.getByLabel("Amount", { exact: true }).fill("9");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Review expense" }).click();

  const dialog = page.getByRole("dialog", { name: "Add this expense?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("E2E lunch")).toBeVisible();
  await dialog.getByRole("button", { name: "Add expense" }).click();

  await expect(page.getByText("Add expense: confirmed")).toBeVisible();
  await expect(page.getByText(/Tx 0x[0-9a-f]{8}/)).toBeVisible();
  await expect(page.getByText("Balances are updated.")).toBeVisible();
});

test("add a second expense after going back to the group", async ({ page }) => {
  await page.goto("/");
  await actAs(page, 0);
  await page.goto("/groups/1/expenses/new");

  for (const [description, amount] of [
    ["E2E first", "3"],
    ["E2E second", "4"],
  ]) {
    // A fresh, editable form every time, even though Next.js keeps visited pages alive.
    await expect(page.getByLabel("Description")).toHaveValue("");
    await expect(page.getByLabel("Description")).toBeEnabled();
    await page.getByLabel("Description").fill(description!);
    await page.getByLabel("Amount", { exact: true }).fill(amount!);
    await page.getByRole("button", { name: "Review expense" }).click();
    await page
      .getByRole("dialog", { name: "Add this expense?" })
      .getByRole("button", { name: "Add expense" })
      .click();
    await expect(page.getByText("Balances are updated.")).toBeVisible();

    // Client-side navigation, like a user: back to the group, then "Add expense" again.
    await page
      .getByRole("link", { name: "Back to group", exact: true })
      .click();
    await expect(page).toHaveURL(/\/groups\/1$/);
    await page.getByRole("link", { name: "Add expense", exact: true }).click();
    await expect(page).toHaveURL(/\/groups\/1\/expenses\/new$/);
  }
  await expect(
    page.getByRole("button", { name: "Review expense" }),
  ).toBeEnabled();
});

test("custom split must add up before review", async ({ page }) => {
  await page.goto("/");
  await actAs(page, 0);
  await page.goto("/groups/1/expenses/new");
  await page.getByLabel("Description").fill("Mismatch");
  await page.getByLabel("Amount", { exact: true }).fill("10");
  await page.getByText("Custom amounts").click();
  await page.getByLabel("Share for you").fill("4");
  await expect(page.getByText("6.00 AUSD left to assign")).toBeVisible();
  await page.getByRole("button", { name: "Review expense" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Shares add up to less than the amount." }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Share for you").fill("12.1234567");
  await page.getByRole("button", { name: "Review expense" }).click();
  await expect(page.getByText("Use at most 6 decimal places.")).toBeVisible();
});

test("pay a debt with tokens: approve, pay, confirmed, indexed", async ({
  page,
}) => {
  await page.goto("/");
  await actAsTripMember(page, "debtor");
  await page.goto("/groups/1/settle");
  const card = page.getByRole("region", { name: "Pay with AUSD" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Moves tokens on-chain")).toBeVisible();

  const mint = card.getByRole("button", { name: /^Mint .* test tokens$/ });
  if (await mint.isVisible()) {
    await mint.click();
    await expect(card.getByText("Mint test tokens: confirmed")).toBeVisible();
  }
  await expect(card.getByText("Required")).toBeVisible();
  await card.getByRole("button", { name: /^Approve / }).click();
  await page
    .getByRole("dialog", { name: "Approve token spending?" })
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(card.getByText("Approve: confirmed")).toBeVisible();
  await expect(card.getByText(/Max network fee ≈ .* MON/)).toBeVisible();

  await card.getByRole("button", { name: /^Pay .* AUSD$/ }).click();
  const confirm = page.getByRole("dialog", { name: "Send this payment?" });
  await expect(
    confirm.getByText("This can't be undone.", { exact: false }),
  ).toBeVisible();
  await confirm.getByRole("button", { name: "Pay now" }).click();
  await expect(card.getByText("Pay: confirmed")).toBeVisible();
  await expect(
    card.getByText("Balances are updated.", { exact: false }),
  ).toBeVisible();
  // After paying, stale prompts (mint / approve) must not suggest more action is needed.
  await expect(card.getByText("Not enough tokens")).toHaveCount(0);
  await expect(card.getByText("Required")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: "test-results/screens/mobile-390-paid.png",
    fullPage: true,
  });
});

test("mark a payment as received: no tokens move", async ({ page }) => {
  await page.goto("/");
  await actAsTripMember(page, "creditor");
  await page.goto("/groups/1/settle");
  await page
    .getByRole("radio", { name: /pays you/ })
    .first()
    .check();
  const card = page.getByRole("region", { name: "Mark as received" });
  await expect(card.getByText("No tokens move")).toBeVisible();
  await card.getByLabel("Amount received").fill("0.1");
  await card.getByRole("button", { name: /^Mark .* as received$/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Record a payment you received?",
  });
  await expect(
    dialog.getByText("No tokens will move.", { exact: false }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Yes, I was paid" }).click();
  await expect(card.getByText("Mark as received: confirmed")).toBeVisible();
  await expect(
    card.getByText("No tokens were transferred.", { exact: false }),
  ).toBeVisible();

  await page.goto("/groups/1");
  await page.getByRole("tab", { name: "Settlements" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("Marked as received").first()).toBeVisible();
  await expect(panel.getByText("Paid in AUSD").first()).toBeVisible();
});

test("undo an expense, then add a corrected version", async ({ page }) => {
  await page.goto("/");
  await actAs(page, 0);
  await page.goto("/groups/1");
  const myCard = page.getByRole("region", {
    name: "Your balance in this group",
  });
  const balance = myCard.locator("p").first();
  await expect(balance).toHaveText(/AUSD|\d/);
  const before = await balance.textContent();

  // Record an expense that changes the balance.
  await myCard.getByRole("link", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Description").fill("E2E typo");
  await page.getByLabel("Amount", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Review expense" }).click();
  await page
    .getByRole("dialog", { name: "Add this expense?" })
    .getByRole("button", { name: "Add expense" })
    .click();
  await expect(page.getByText("Balances are updated.")).toBeVisible();
  await page.getByRole("link", { name: "Back to group", exact: true }).click();
  await expect(balance).not.toHaveText(before!);

  // Undo it from the Expenses tab.
  await page.getByRole("tab", { name: "Expenses" }).click();
  const item = page.getByRole("listitem").filter({ hasText: "E2E typo" });
  await item.getByText("E2E typo").click();
  await item.getByRole("button", { name: "Undo expense" }).click();
  await page
    .getByRole("dialog", { name: "Undo this expense?" })
    .getByRole("button", { name: "Undo expense" })
    .click();
  await expect(item.getByText("Undone").first()).toBeVisible({
    timeout: 30_000,
  });
  // Balances are exactly as before the expense.
  await expect(balance).toHaveText(before!);

  // "Edit": add a corrected copy, prefilled from the undone one.
  await item.getByRole("link", { name: "Add corrected version" }).click();
  await expect(
    page.getByRole("heading", { name: "Add corrected expense" }),
  ).toBeVisible();
  await expect(page.getByLabel("Description")).toHaveValue("E2E typo");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("12");
  await page.getByLabel("Description").fill("E2E fixed");
  await page.getByLabel("Amount", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Review expense" }).click();
  await page
    .getByRole("dialog", { name: "Add this expense?" })
    .getByRole("button", { name: "Add expense" })
    .click();
  await expect(page.getByText("Balances are updated.")).toBeVisible();
});
