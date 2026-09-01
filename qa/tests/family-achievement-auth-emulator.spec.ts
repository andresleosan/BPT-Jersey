import { expect, test, type Page } from "@playwright/test";

function trackBrowserHealth(page: Page): {
  errors: string[];
  authRequests: string[];
  directDataRequests: string[];
} {
  const errors: string[] = [];
  const authRequests: string[] = [];
  const directDataRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes(":9099/")) authRequests.push(url);
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|:(?:8080|9000)\//iu.test(
        url,
      )
    ) {
      directDataRequests.push(url);
    }
  });
  return { errors, authRequests, directDataRequests };
}

test.describe("T067 family achievements with Firebase Emulators", () => {
  test("authenticates staff and reviews a persisted family snapshot @critical", async ({
    page,
  }) => {
    test.skip(
      process.env.T067_FAMILY_ACHIEVEMENT_UI_EMULATOR_E2E !== "true" ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Synthetic T067 Emulator credentials and seed are required.",
    );
    expect(process.env.NEXT_PUBLIC_ADMIN_E2E).not.toBe("true");
    const { errors, authRequests, directDataRequests } = trackBrowserHealth(page);

    await page.goto("/login?role=administrator");
    await expect(page.getByRole("heading", { name: "Team access" })).toBeVisible();
    await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/admin$/u);
    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Family management" })).toBeVisible();
    await page.getByLabel("Family reference").fill("t067-family-review");
    await page.getByRole("button", { name: "Load achievement summary" }).click();
    await page.getByRole("button", { name: "Open achievement summary" }).click();
    await expect(page.getByText("Synthetic Family Member")).toBeVisible();
    await expect(page.getByText("4 / 4 classes attended")).toBeVisible();
    await expect(page.getByText("Consistency milestone")).toBeVisible();

    expect(authRequests.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(directDataRequests).toEqual([]);
  });
});
