import { expect, test } from "@playwright/test";
import { actAs } from "./helpers";

test("the invite card only shows a QR code for a real invite link", async ({
  page,
}) => {
  await page.goto("/");
  await actAs(page, 0); // Trip's admin
  await page.goto("/groups/1/members");
  // No invite known on this device: the admin is offered one, and nothing scannable
  // (a plain group link would mislead people into thinking they can join with it).
  await expect(
    page.getByRole("button", { name: /^(Create invite link|Reset link)$/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Group link")).toHaveCount(0);
  if (!(await page.getByLabel("Invite link").isVisible())) {
    await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  }
});

test("Tally is installable as an app (Chrome's own installability check)", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "uses Chrome DevTools");
  await page.goto("/");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as {
    display: string;
    icons: { src: string }[];
  };
  expect(body.display).toBe("standalone");
  for (const icon of body.icons) {
    expect((await page.request.get(icon.src)).ok(), icon.src).toBe(true);
  }
  const cdp = await page.context().newCDPSession(page);
  await expect
    .poll(async () => {
      const { installabilityErrors } = (await cdp.send(
        "Page.getInstallabilityErrors",
      )) as { installabilityErrors: { errorId: string }[] };
      return installabilityErrors.map((e) => e.errorId);
    })
    .toEqual([]);
});
