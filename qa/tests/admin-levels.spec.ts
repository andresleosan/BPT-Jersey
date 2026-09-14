import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

test.describe("admin levels", () => {
  test("a coach can browse and filter belts", async ({ page }, testInfo) => {
    await installAdminFixture(page, { role: "coach" });
    await page.goto("/admin/levels?adminTestRole=coach");

    const belts = page.getByRole("region", { name: "Belts" });
    await expect(belts).toBeVisible();
    const articles = belts.getByRole("article");
    const totalCount = await articles.count();
    expect(totalCount).toBeGreaterThanOrEqual(20);

    await page.getByRole("radio", { name: "Kids" }).click();
    const kidsCount = await articles.count();
    expect(kidsCount).toBeLessThan(totalCount);

    await page
      .getByRole("button", { name: /^Filter by/u })
      .first()
      .click();
    const filteredCount = await articles.count();
    expect(filteredCount).toBeGreaterThanOrEqual(1);

    await page.screenshot({
      path: testInfo.outputPath(`levels-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});
