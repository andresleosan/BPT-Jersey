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

test.describe("member and staff sign-in surfaces", () => {
  test("renders the member sign-in with no staff context", async ({ page }) => {
    const errors = trackBrowserHealth(page);
    await installStaticRoute(page, "/login");
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Client account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Administrator" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create client account" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/administrator|staff sign-in|coach/i);
    await expect(page.locator('a[href^="/staff"]')).toHaveCount(0);

    const loginForm = page.locator("#login-form");
    await page.getByRole("link", { name: "Skip to login form" }).focus();
    await page.keyboard.press("Enter");
    await expect(loginForm).toBeFocused();

    await page.getByRole("link", { name: "Skip to login form" }).focus();
    await expect(page.getByRole("link", { name: "Skip to login form" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Home" })).toBeFocused();
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

    // The retired role parameter no longer flips the member page into a staff context.
    await page.goto("/login?role=administrator");
    await expect(page.getByRole("heading", { name: "Client account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create client account" })).toBeVisible();
    await expectNoBrowserHealthProblems(page, errors);
  });

  test("renders the unlinked, unindexed staff sign-in", async ({ page }) => {
    const errors = trackBrowserHealth(page);
    await installStaticRoute(page, "/staff/login");
    await page.goto("/staff/login");

    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create client account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Administrator" })).toHaveCount(0);
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("link", { name: /member sign-in/i })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expectNoBrowserHealthProblems(page, errors);
  });

  test("exposes the staff entrance only in the footer of the public home", async ({ page }) => {
    const errors = trackBrowserHealth(page);
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
      "href",
      "/login",
    );
    // The staff entrance is reachable from the footer by operator decision, and from nowhere else.
    const staffLinks = page.locator('a[href^="/staff"]');
    await expect(staffLinks).toHaveCount(1);
    await expect(staffLinks).toHaveAttribute("href", "/staff/login");
    await expect(page.locator('nav a[href^="/staff"]')).toHaveCount(0);
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    await expect(page.locator('a[href^="/coach"]')).toHaveCount(0);
    await expect(page.locator('a[href*="role="]')).toHaveCount(0);
    await expectNoBrowserHealthProblems(page, errors);
  });

  for (const [pathname, returnPath] of [["/account", "/login?returnTo=%2Faccount"]] as const) {
    test(`keeps ${pathname} behind the member session gate`, async ({ page }) => {
      const errors = trackBrowserHealth(page);
      await installStaticRoute(page, pathname);
      await page.goto(pathname);

      await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", returnPath);
      await expect(page.locator("body")).not.toContainText(/uid|academyId|claim|token/i);
      await expectNoBrowserHealthProblems(page, errors);
    });
  }

  // T120: the club shop catalogue is public information. A visitor reads it without an account.
  test("opens the club shop to a visitor with no account", async ({ page }) => {
    const errors = trackBrowserHealth(page);
    await installStaticRoute(page, "/shop");
    await page.goto("/shop");

    await expect(page.getByRole("heading", { name: "Club shop", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toHaveCount(0);
    await expect(page.getByLabel("Name for the order")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Back to home/ })).toHaveAttribute("href", "/");
    await expectNoBrowserHealthProblems(page, errors);
  });

  test("sends signed-out administrator access to the staff sign-in", async ({ page }) => {
    const errors = trackBrowserHealth(page);
    await installStaticRoute(page, "/admin");
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/staff/login?returnTo=%2Fadmin",
    );
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expectNoBrowserHealthProblems(page, errors);
  });

  test("sends signed-out coach access to the staff sign-in", async ({ page }) => {
    const errors = trackBrowserHealth(page);
    await installStaticRoute(page, "/coach");
    await page.goto("/coach");

    await expect(page.getByRole("heading", { name: "Staff Access Required" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/staff/login?returnTo=%2Fcoach",
    );
    await expectNoBrowserHealthProblems(page, errors);
  });
});
