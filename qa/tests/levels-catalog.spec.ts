import { expect, test, type Page } from "@playwright/test";

function trackBrowserHealth(page: Page, directDataRequests: string[]): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("request", (request) => {
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|cloudfunctions\.net|google\.firestore\.v1\.Firestore|:(?:5001|8080|9000)\//iu.test(
        request.url(),
      )
    ) {
      directDataRequests.push(request.url());
    }
  });
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

async function expectNoBrowserHealthProblems(
  page: Page,
  errors: string[],
  directDataRequests: string[],
): Promise<void> {
  expect(errors).toEqual([]);
  expect(directDataRequests).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

test.describe("Levels and Belts IBJJF E2E (T083)", () => {
  test("admin browser renders all 171 definitions and filters by belt kind and search keyword", async ({
    page,
  }) => {
    const directDataRequests: string[] = [];
    const errors = trackBrowserHealth(page, directDataRequests);

    await installStaticRoute(page, "/admin/levels");

    await page.goto("/admin/levels?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "IBJJF Levels & Belts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "JIU-JITSU - IBJJF" })).toBeVisible();

    // Verify badges
    await expect(page.getByText("171 Total Levels")).toBeVisible();
    await expect(page.getByText("27 Belts")).toBeVisible();
    await expect(page.getByText("144 Stripes")).toBeVisible();
    await expect(page.getByText("11 Evaluated Skills")).toBeVisible();

    // Filter by belts
    await page.getByRole("button", { name: /Belts \(27\)/i }).click();
    await expect(page.getByRole("article")).toHaveCount(27);

    // Filter by stripes
    await page.getByRole("button", { name: /Stripes \(144\)/i }).click();
    await expect(page.getByRole("article")).toHaveCount(144);

    // Filter by belts and search for Black Belt
    await page.getByRole("button", { name: /Belts \(27\)/i }).click();
    const searchInput = page.getByPlaceholder("Search levels (e.g. White Belt, 1st Stripe)...");
    await searchInput.fill("Black");
    const blackCards = page.getByRole("article");
    await expect(blackCards.first()).toBeVisible();
    const count = await blackCards.count();
    expect(count).toBeGreaterThan(0);

    await expectNoBrowserHealthProblems(page, errors, directDataRequests);
  });

  test("client progress page is protected by ClientAuthGate with return path", async ({ page }) => {
    const directDataRequests: string[] = [];
    const errors = trackBrowserHealth(page, directDataRequests);

    await installStaticRoute(page, "/account/progress");
    await page.goto("/account/progress");

    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?role=client&returnTo=%2Faccount%2Fprogress",
    );

    await expectNoBrowserHealthProblems(page, errors, directDataRequests);
  });

  test("coach levels portal is protected by StaffAuthGate", async ({ page }) => {
    const directDataRequests: string[] = [];
    const errors = trackBrowserHealth(page, directDataRequests);

    await installStaticRoute(page, "/coach/levels");
    await page.goto("/coach/levels");

    await expect(page.getByRole("heading", { name: "Staff Access Required" })).toBeVisible();

    await expectNoBrowserHealthProblems(page, errors, directDataRequests);
  });
});
