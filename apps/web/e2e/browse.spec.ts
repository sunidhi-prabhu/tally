import { expect, test } from "@playwright/test";
import { actAs, expectNoHorizontalScroll } from "./helpers";

// Read-only checks against the LocalDemo history. Runs at all three viewports.
test.describe("browsing indexed data", () => {
  test("dashboard shows totals, groups and activity for the chosen account", async ({
    page,
  }, info) => {
    await page.goto("/");
    await expect(page.getByText("Local demo", { exact: false })).toBeVisible();
    await actAs(page, 1);
    const totals = page.getByRole("region", { name: "Your balances" });
    await expect(
      totals.getByRole("term").filter({ hasText: "You owe" }),
    ).toBeVisible();
    await expect(
      totals.getByRole("term").filter({ hasText: "You're owed" }),
    ).toBeVisible();
    const groups = page.getByRole("region", { name: "Groups" });
    await expect(groups.getByRole("link", { name: /^Trip/ })).toBeVisible();
    await expect(groups.getByRole("link", { name: /^Flat/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recent activity" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /^Live$/ }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: `test-results/screens/${info.project.name}-dashboard.png`,
      fullPage: true,
    });
  });

  test("group detail separates token payments from acknowledgements", async ({
    page,
  }, info) => {
    await page.goto("/");
    await actAs(page, 0);
    await page
      .getByRole("region", { name: "Groups" })
      .getByRole("link", { name: /^Trip/ })
      .click();
    await expect(page.getByRole("heading", { name: "Trip" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Who owes whom" }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: `test-results/screens/${info.project.name}-group.png`,
      fullPage: true,
    });

    await page.getByRole("tab", { name: "Settlements" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("Paid in AUSD").first()).toBeVisible();
    await expect(panel.getByText("Marked as received").first()).toBeVisible();
    await expect(panel.getByText(/No tokens moved/).first()).toBeVisible();

    await page.getByRole("tab", { name: "Expenses" }).click();
    await expect(page.getByRole("tabpanel").getByText("Snacks")).toBeVisible();
    await page.getByRole("tabpanel").getByText("Snacks").click();
    await expect(page.getByRole("list", { name: "Shares" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("invalid and unknown groups are handled", async ({ page }) => {
    await page.goto("/groups/abc");
    const main = page.getByRole("main");
    await expect(main.getByText("That isn't a valid group link")).toBeVisible();
    await page.goto("/groups/999");
    await expect(
      page.getByRole("main").getByText("Group not found"),
    ).toBeVisible();
  });

  test("forms and member management render without overflow", async ({
    page,
  }, info) => {
    await page.goto("/");
    await actAs(page, 0);
    for (const [path, name] of [
      ["/groups/1/expenses/new", "expense"],
      ["/groups/1/members", "members"],
      ["/groups/new", "new-group"],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole("main").getByRole("heading", { level: 1 }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({
        path: `test-results/screens/${info.project.name}-${name}.png`,
        fullPage: true,
      });
    }
  });
});
