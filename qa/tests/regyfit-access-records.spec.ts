import { expect, test, type Page } from "@playwright/test";

import { injectSyntheticAdminRecords } from "../src/admin-test-bootstrap";

function trackBrowserHealth(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function expectNoBrowserHealthProblems(page: Page, errors: string[]): Promise<void> {
  expect(errors).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

async function installStaticAdminRoute(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === "/admin/regyfit-access-records") {
      requestUrl.pathname = "/admin/regyfit-access-records.html";
      await route.continue({ url: requestUrl.toString() });
      return;
    }

    await route.continue();
  });
}

test.describe("Regyfit access records authorization and projection", () => {
  test("owner sees the synthetic complete projection, searches, filters, and opens details", async ({
    page,
  }) => {
    const errors = trackBrowserHealth(page);
    await installStaticAdminRoute(page);
    await injectSyntheticAdminRecords(page, "owner");
    await page.goto("/admin/regyfit-access-records?adminTestRole=owner");

    await expect(page.getByTestId("regyfit-access-records-panel")).toBeVisible();
    await expect(page.getByRole("table", { name: "Regyfit access records" })).toBeVisible();
    await expect(page.getByTestId("regyfit-access-record-row")).toHaveCount(2);
    await expect(page.getByText("synthetic-regyfit-1", { exact: true })).toBeVisible();
    expect(await page.locator('[data-label="Source ID"]').allTextContents()).toEqual([
      "synthetic-regyfit-1",
      "synthetic-regyfit-2",
    ]);
    await expect(page.getByText("203.0.113.10", { exact: true })).toHaveCount(0);

    const search = page.getByRole("searchbox", { name: "Search access records" });
    await search.fill("Synthetic Member");
    await expect(page.getByTestId("regyfit-access-record-row")).toHaveCount(1);

    await search.fill("");
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await expect(page.getByTestId("regyfit-access-record-row")).toHaveCount(1);
    await expect(page.locator('[data-label="Observed login count"]')).toHaveText("42");

    await page
      .getByRole("button", { name: "View details for Synthetic Member", exact: true })
      .click();
    const details = page.getByRole("region", { name: "Record details" });
    await expect(details).toBeVisible();
    await expect(details).toContainText("203.0.113.10");
    await expect(details).toContainText("synthetic-import-run-1");
    await expect(details).toContainText("synthetic-academy");
    await expectNoBrowserHealthProblems(page, errors);
  });

  test("administrator receives the safe projection without IP in table or details", async ({
    page,
  }) => {
    const errors = trackBrowserHealth(page);
    await installStaticAdminRoute(page);
    await injectSyntheticAdminRecords(page, "administrator");
    await page.goto("/admin/regyfit-access-records?adminTestRole=administrator");

    await expect(page.getByTestId("regyfit-access-records-panel")).toBeVisible();
    await expect(page.getByTestId("regyfit-access-record-row")).toHaveCount(2);
    expect(await page.locator('[data-label="Source ID"]').allTextContents()).toEqual([
      "synthetic-regyfit-1",
      "synthetic-regyfit-2",
    ]);
    await expect(page.locator("body")).not.toContainText("203.0.113.10");

    await page
      .getByRole("button", { name: "View details for Synthetic Member", exact: true })
      .click();
    const details = page.getByRole("region", { name: "Record details" });
    await expect(details).toBeVisible();
    await expect(details).toContainText("synthetic-import-run-1");
    await expect(details).not.toContainText("203.0.113.10");
    await expect(details).not.toContainText("IP");
    await expectNoBrowserHealthProblems(page, errors);
  });

  for (const role of ["coach", "guardian", "adultStudent"] as const) {
    test(`does not expose records to ${role} on the direct route`, async ({ page }) => {
      const errors = trackBrowserHealth(page);
      await installStaticAdminRoute(page);
      await page.goto(`/admin/regyfit-access-records?adminTestRole=${role}`);

      await expect(
        page.getByRole("heading", { name: "Administrative access not authorized" }),
      ).toBeVisible();
      await expect(page.getByTestId("regyfit-access-records-panel")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("synthetic-");
      await expectNoBrowserHealthProblems(page, errors);
    });
  }
});
