import { expect, test } from "@playwright/test";
import { actAs } from "./helpers";

test("the invite card shows a scannable QR code for the group link", async ({
  page,
}) => {
  await page.goto("/");
  await actAs(page, 0);
  await page.goto("/groups/1/members");
  const qr = page.getByRole("img", { name: /QR code for the .* group link/ });
  await expect(qr).toBeVisible();
  const src = await qr.getAttribute("src");
  expect(src).toMatch(/^data:image\/png;base64,/);
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
