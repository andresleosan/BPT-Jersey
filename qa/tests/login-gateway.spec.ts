import { expect, test, type Page } from "@playwright/test";

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

async function installStaticRoute(page: Page, pathname: string): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === pathname) {
      requestUrl.pathname = `${pathname}.html`;
      await route.continue({ url: requestUrl.toString() });
      return;
    }

    await route.continue();
  });
}

async function expectNoBrowserHealthProblems(page: Page, errors: string[]): Promise<void> {
  expect(errors).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

test.describe("unified login gateway", () => {
  test("renders the selector-first client login surface", async ({ page }) => {
    const errors = trackBrowserHealth(page);
    await installStaticRoute(page, "/login");
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Client account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Administrator" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByRole("button", { name: "Client", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Create client account" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();

    const loginForm = page.locator("#login-form");
    await page.getByRole("link", { name: "Skip to login form" }).focus();
    await page.keyboard.press("Enter");
    await expect(loginForm).toBeFocused();

    await page.getByRole("link", { name: "Skip to login form" }).focus();
    await expect(page.getByRole("link", { name: "Skip to login form" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Home" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Administrator" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Client", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email address")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Forgot password?" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Create client account" })).toBeFocused();

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("p[role='alert']")).toContainText(/valid email address/i);
    await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");

    await page.getByRole("button", { name: "Administrator" }).click();
    await expect(page.getByRole("heading", { name: "Team access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create client account" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to client access" })).toBeVisible();

    await page.getByRole("button", { name: "Client", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Client", exact: true })).toBeFocused();

    await page.goto("/login?role=administrator");
    await expect(page.getByRole("heading", { name: "Team access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create client account" })).toHaveCount(0);
    await expectNoBrowserHealthProblems(page, errors);
  });

  for (const [pathname, returnPath] of [
    ["/account", "/login?role=client&returnTo=%2Faccount"],
    ["/shop", "/login?role=client&returnTo=%2Fshop"],
  ] as const) {
    test(`keeps ${pathname} behind the client session gate`, async ({ page }) => {
      const errors = trackBrowserHealth(page);
      await installStaticRoute(page, pathname);
      await page.goto(pathname);

      await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", returnPath);
      await expect(page.locator("body")).not.toContainText(/uid|academyId|claim|token/i);
      await expectNoBrowserHealthProblems(page, errors);
    });
  }

  test("keeps signed-out administrator access out of the admin shell", async ({ page }) => {
    const errors = trackBrowserHealth(page);
    await installStaticRoute(page, "/admin");
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?role=administrator",
    );
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expectNoBrowserHealthProblems(page, errors);
  });
});
