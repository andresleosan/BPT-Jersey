import { expect, test, type Page } from "@playwright/test";

async function installStaticRoute(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === "/admin") {
      requestUrl.pathname = "/admin.html";
      await route.continue({ url: requestUrl.toString() });
      return;
    }
    await route.continue();
  });
}

test.describe("backup and restore safety boundary", () => {
  test("does not expose backup or restore controls in the normal admin surface", async ({
    page,
  }) => {
    await installStaticRoute(page);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();
    await expect(page.getByRole("button", { name: /backup|restore/i })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      /operationId|rollbackManifestPath|checksum/i,
    );
  });
});
