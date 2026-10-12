import { expect, test } from "@playwright/test";
import { actAs, addVirtualPasskeyAuthenticator } from "./helpers";

// Invite links on the LOCAL anvil chain: the admin creates a link; a friend in a fresh browser
// creates a passkey wallet, joins with no MON (gasless) and lands in the group. Runs once, on
// the mobile viewport (other projects ignore *flows.spec).
test("a friend joins through an invite link, and a reset link stops working", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  // Admin (Demo 0 is Trip's admin) creates the link.
  await page.goto("/");
  await actAs(page, 0);
  await page.goto("/groups/1/members");
  await page
    .getByRole("button", { name: /^(Create invite link|Reset link)$/ })
    .click();
  await page
    .getByRole("dialog", { name: /invite link\?$/ })
    .getByRole("button", { name: /^(Create|Reset)$/ })
    .click();
  const linkField = page.getByLabel("Invite link");
  await expect(linkField).toHaveValue(/\/join\/1#k=[0-9a-f]{64}$/);
  const link = await linkField.inputValue();
  await expect(
    page.getByRole("img", { name: /QR code for the Trip invite link/ }),
  ).toBeVisible();

  // A friend, in a separate browser with no wallet, opens it.
  const friendContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const friend = await friendContext.newPage();
  await addVirtualPasskeyAuthenticator(friend);
  await friend.goto(link);
  await expect(friend.getByRole("heading", { name: "Trip" })).toBeVisible();
  await friend.getByRole("button", { name: "Create passkey wallet" }).click();
  await friend.getByRole("button", { name: "Join Trip" }).click();
  // Joined, indexed, and taken to the group as a member.
  await expect(friend).toHaveURL(/\/groups\/1$/, { timeout: 60_000 });
  await expect(
    friend.getByRole("region", { name: "Your balance in this group" }),
  ).toBeVisible();

  // The admin resets the link: the old one no longer works.
  await page.getByRole("button", { name: "Reset link" }).click();
  await page
    .getByRole("dialog", { name: "Reset the invite link?" })
    .getByRole("button", { name: "Reset" })
    .click();
  await expect(linkField).not.toHaveValue(link);
  const stranger = await friendContext.newPage();
  await stranger.goto(link);
  await expect(
    stranger.getByText("This invite link is no longer valid"),
  ).toBeVisible();
  await friendContext.close();
});
