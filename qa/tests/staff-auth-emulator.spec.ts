import { expect, test, type Page } from "@playwright/test";

const safeProfile = {
  staffKey: "staff-auth-emulator-1",
  role: "coach",
  active: true,
  status: "active",
  schemaVersion: "1",
} as const;

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
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|google\.firestore\.v1\.Firestore|:(?:8080|9000)\//iu.test(
        url,
      )
    ) {
      directDataRequests.push(url);
    }
  });
  return { errors, authRequests, directDataRequests };
}

async function installCallableHarness(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.url().includes("listStaffProfiles")) {
      await route.continue();
      return;
    }

    await route.fulfill({
      body: JSON.stringify({ data: [safeProfile] }),
      contentType: "application/json",
      status: 200,
    });
  });
}

test.describe("staff management with Firebase Auth Emulator", () => {
  test("logs in through the real email form and reaches staff management", async ({ page }) => {
    test.skip(
      !process.env.AUTH_EMULATOR_E2E_EMAIL || !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Auth Emulator credentials are required for this suite.",
    );
    expect(process.env.NEXT_PUBLIC_ADMIN_E2E).not.toBe("true");

    const { errors, authRequests, directDataRequests } = trackBrowserHealth(page);
    await installCallableHarness(page);
    await page.goto("/login?role=administrator");

    await expect(page.getByRole("heading", { name: "Team access" })).toBeVisible();
    await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/admin$/u);
    await expect(page.getByRole("heading", { name: "Academy control room" })).toBeVisible();
    await page.goto("/admin/staff");
    await expect(page.getByRole("heading", { name: "Staff management" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Staff profiles" })).toBeVisible();
    await expect(page.getByText("staff-auth-emulator-1")).toBeVisible();

    expect(authRequests.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(directDataRequests).toEqual([]);
  });
});
