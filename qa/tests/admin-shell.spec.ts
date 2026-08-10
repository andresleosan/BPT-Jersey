import { expect, test } from "@playwright/test";

test.describe("admin shell @smoke", () => {
  test("renders the data-free shell without overflow across viewports", async ({ page }) => {
    const browserErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    // The static export writes this route as admin.html; keep the test URL semantic as /admin.
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname === "/admin") {
        requestUrl.pathname = "/admin.html";
        await route.continue({ url: requestUrl.toString() });
        return;
      }
      await route.continue();
    });

    const response = await page.goto("/admin?adminTestRole=owner&adminTestMfa=verified");

    expect(response?.ok()).toBe(true);
    await expect(page).toHaveTitle(/BPT Jersey/);
    await expect(
      page.getByRole("heading", { name: "Academy control room", level: 1 }),
    ).toBeVisible();

    const navigation = page.getByRole("navigation", { name: "Admin navigation" });
    for (const label of [
      "Overview",
      "Members",
      "Attendance",
      "Reports",
      "CRM",
      "Finance",
      "Regyfit Access Records",
    ]) {
      await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    await expect(page.getByTestId("admin-empty-state")).toHaveCount(6);
    await expect(page.getByText("Not yet imported", { exact: true })).toHaveCount(6);

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await skipLink.press("Enter");
    await expect(page.locator("main#admin-main-content")).toBeFocused();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /203\.0\.113\.10|synthetic member|source-demo-\d|memberNumber|\bIP\b|\bpassword\b|\bsecret\b|api[_ -]?key|\bbearer\b/i,
    );

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
    expect(browserErrors).toEqual([]);
  });
});
