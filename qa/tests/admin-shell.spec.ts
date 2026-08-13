import { expect, test } from "@playwright/test";

test.describe("admin shell @smoke", () => {
  test("renders the data-free shell without overflow across viewports", async ({
    page,
  }, testInfo) => {
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
      if (requestUrl.pathname.startsWith("/admin")) {
        if (requestUrl.pathname === "/admin") {
          requestUrl.pathname = "/admin.html";
        }
        requestUrl.searchParams.set("adminTestRole", "owner");
        await route.continue({ url: requestUrl.toString() });
        return;
      }
      await route.continue();
    });

    const response = await page.goto("/admin?adminTestRole=owner");

    expect(response?.ok()).toBe(true);
    await expect(page).toHaveTitle(/BPT Jersey/);
    await expect(
      page.getByRole("heading", { name: "Academy control room", level: 1 }),
    ).toBeVisible();

    const desktopNavigation = page.locator(".admin-desktop-navigation");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await skipLink.press("Enter");
    await expect(page.locator("main#admin-main-content")).toBeFocused();

    if (testInfo.project.name === "mobile-chromium") {
      await expect(page.locator(".admin-sidebar")).toBeHidden();
      const menuButton = page.getByRole("button", { name: "Open admin navigation" });
      await expect(menuButton).toBeVisible();
      await menuButton.click();
      const drawer = page.getByRole("dialog", { name: "Admin navigation" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("img", { name: "BPT Jersey mobile logo" })).toBeVisible();
      await expect(page.locator(".admin-mobile-backdrop")).toBeVisible();
      await expect(drawer.getByRole("link", { name: "Members", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
    } else {
      await expect(page.locator(".admin-sidebar")).toBeVisible();
      await expect(
        desktopNavigation.getByRole("link", { name: "Members", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /admin navigation/i })).toBeHidden();
    }

    await expect(
      page.getByRole("heading", { name: "Today's academy view", level: 2 }),
    ).toBeVisible();
    await expect(page.getByRole("table", { name: "Today's classes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add new member" })).toHaveAttribute(
      "href",
      "/admin/members/add",
    );

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

  test("selects a route from the mobile drawer without horizontal overflow", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium");

    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname.startsWith("/admin")) {
        if (requestUrl.pathname === "/admin") {
          requestUrl.pathname = "/admin.html";
        }
        requestUrl.searchParams.set("adminTestRole", "owner");
        await route.continue({ url: requestUrl.toString() });
        return;
      }
      await route.continue();
    });

    await page.goto("/admin?adminTestRole=owner");
    await page.getByRole("button", { name: "Open admin navigation" }).click();
    await page
      .getByRole("dialog", { name: "Admin navigation" })
      .getByRole("link", {
        name: "Members",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/admin\/members/);
    await expect(page.getByRole("dialog", { name: "Admin navigation" })).not.toBeVisible();

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
  });
});
