import { expect, test, type Page } from "@playwright/test";

const clauses = [
  {
    key: "photoVideo",
    heading: "Photo and video",
    body: "Reviewed media wording.",
    required: false,
  },
  {
    key: "medicalTreatment",
    heading: "Medical treatment",
    body: "Reviewed medical wording.",
    required: true,
  },
  { key: "hygiene", heading: "Hygiene", body: "Reviewed hygiene wording.", required: true },
  {
    key: "dataProtection",
    heading: "Data protection",
    body: "Reviewed data wording.",
    required: true,
  },
] as const;
const version = {
  waiverVersionId: "waiver-synthetic",
  versionLabel: "pilot-2026-08",
  title: "Reviewed synthetic waiver",
  introduction: "Reviewed synthetic introduction.",
  clauses,
  contentHash: "a".repeat(64),
  effectiveAt: "2026-08-25T12:00:00Z",
  schemaVersion: "1",
};

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

function browserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function mockAdminWaiverCallables(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    if (request.url().includes("getCurrentWaiverAdmin"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: null }),
        status: 200,
      });
    if (request.url().includes("publishWaiverVersion"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: version }),
        status: 200,
      });
    return route.continue();
  });
}

test.describe("versioned waiver registration", () => {
  test("@waiver admin publishes reviewed synthetic wording without horizontal overflow", async ({
    page,
  }) => {
    const errors = browserErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await installStaticRoute(page, "/admin/waivers");
    await mockAdminWaiverCallables(page);
    await page.goto("/admin/waivers?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Waiver versions" })).toBeVisible();
    await expect(page.getByText(/No legal wording is bundled/i)).toBeVisible();
    await page.getByLabel("Version label").fill("pilot-2026-08");
    await page.getByLabel("Waiver title").fill("Reviewed synthetic waiver");
    await page.getByLabel("Introduction").fill("Reviewed synthetic introduction.");
    await page.getByLabel("Effective date and time").fill("2026-08-25T12:00");
    for (const clause of clauses) {
      await page.getByLabel(`${clause.heading} wording`).fill(clause.body);
      if (clause.required) await page.getByLabel(`${clause.heading} is required`).check();
    }
    await page.getByLabel("I confirm this wording is approved for the synthetic pilot").check();
    await page.getByRole("button", { name: "Publish immutable version" }).click();
    await expect(page.getByRole("status")).toHaveText("Waiver version published.");
    await expect(page.getByText("pilot-2026-08")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  test("@waiver account waiver keeps the client authentication return path", async ({ page }) => {
    const errors = browserErrors(page);
    await installStaticRoute(page, "/account/waiver");
    await page.goto("/account/waiver");
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?role=client&returnTo=%2Faccount%2Fwaiver",
    );
    expect(errors).toEqual([]);
  });
});
