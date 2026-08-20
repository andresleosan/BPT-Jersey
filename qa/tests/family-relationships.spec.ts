import { expect, test, type Page } from "@playwright/test";

const staffProjection = {
  family: {
    familyId: "family-synthetic",
    academyId: "academy-synthetic",
    primaryContactUserId: "user-synthetic",
    billingContactUserId: "user-synthetic",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00.000Z",
    createdBy: "admin-synthetic",
    updatedAt: "2026-08-19T10:00:00.000Z",
    updatedBy: "admin-synthetic",
  },
  students: [
    {
      studentId: "student-synthetic-1",
      academyId: "academy-synthetic",
      familyId: "family-synthetic",
      fullName: "Synthetic Minor One",
      dateOfBirth: "2015-08-19",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
      participantType: "minor",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "admin-synthetic",
      updatedAt: "2026-08-19T10:00:00.000Z",
      updatedBy: "admin-synthetic",
    },
    {
      studentId: "student-synthetic-2",
      academyId: "academy-synthetic",
      familyId: "family-synthetic",
      fullName: "Synthetic Minor Two",
      dateOfBirth: "2017-04-12",
      trainingCenter: "West",
      trainingTimePreferences: ["evening"],
      participantType: "minor",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: "2026-08-19T10:00:00.000Z",
      createdBy: "admin-synthetic",
      updatedAt: "2026-08-19T10:00:00.000Z",
      updatedBy: "admin-synthetic",
    },
  ],
  relationships: [],
};

function trackBrowserHealth(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
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

async function mockFamilyCallables(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.url().includes("createFamily")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: staffProjection }),
      status: 200,
    });
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

test.describe("family relationships", () => {
  test("@family staff creates a multi-child family without leaking internal fields", async ({
    page,
  }) => {
    const errors = trackBrowserHealth(page);
    await installStaticRoute(page, "/admin/families");
    await mockFamilyCallables(page);
    await page.goto("/admin/families?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Family management" })).toBeVisible();
    await page.getByLabel("Tutor user ID").fill("user-synthetic");
    await page.getByLabel("Minor full name").fill("Synthetic Minor One");
    await page.getByLabel("Date of birth").fill("2015-08-19");
    await page.getByRole("checkbox", { name: "Afternoon" }).check();
    await page.getByRole("button", { name: "Add another minor" }).click();
    await page.getByLabel("Minor full name").nth(1).fill("Synthetic Minor Two");
    await page.getByLabel("Date of birth").nth(1).fill("2017-04-12");
    await page.getByRole("checkbox", { name: "Evening" }).nth(1).check();
    await page.getByRole("combobox", { name: "Training center" }).nth(1).selectOption("West");
    await page.getByRole("button", { name: "Create family" }).click();

    await expect(page.getByRole("status")).toHaveText("Family created.");
    await expect(page.getByText("Synthetic Minor One")).toBeVisible();
    await expect(page.getByText("Synthetic Minor Two")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /academy-synthetic|family-synthetic|student-synthetic|createdBy/i,
    );
    await expectNoBrowserHealthProblems(page, errors);
  });
});
