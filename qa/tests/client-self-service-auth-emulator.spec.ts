import { expect, test, type Page } from "@playwright/test";

const guardianFamily = {
  family: { familyId: "family-t063", active: true, status: "active" },
  tutor: {
    userId: "guardian-t063",
    displayName: "Synthetic Guardian",
    email: "guardian@example.test",
    phoneNumber: "+441534555010",
  },
  students: [
    {
      studentId: "minor-t063",
      fullName: "Linked Synthetic Minor",
      dateOfBirth: "2015-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
      active: true,
      status: "active",
    },
  ],
} as const;

function trackBrowserHealth(page: Page): {
  errors: string[];
  authRequests: string[];
  directDataRequests: string[];
  callableRequests: string[];
} {
  const errors: string[] = [];
  const authRequests: string[] = [];
  const directDataRequests: string[] = [];
  const callableRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  page.on("pageerror", (error) => errors.push("page: " + error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes(":9099/")) authRequests.push(url);
    if (url.includes(":5001/")) callableRequests.push(url);
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|google\.firestore\.v1\.Firestore|:(?:8080|9000)\//iu.test(
        url,
      )
    ) {
      directDataRequests.push(url);
    }
  });
  return { errors, authRequests, directDataRequests, callableRequests };
}

async function installCallableHarness(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    if (request.url().includes("getFamily")) {
      await route.fulfill({
        body: JSON.stringify({ data: guardianFamily }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (request.url().includes("getHealthProfile")) {
      await route.fulfill({
        body: JSON.stringify({ data: null }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.continue();
  });
}

test.describe("T063 guardian self-service with Firebase Auth Emulator", () => {
  test("shows only the linked minor responsively and denies the admin workspace", async ({
    page,
  }) => {
    test.skip(
      process.env.AUTH_EMULATOR_E2E_ROLE !== "guardian" ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Synthetic guardian Auth Emulator credentials are required.",
    );
    expect(process.env.NEXT_PUBLIC_ADMIN_E2E).not.toBe("true");

    const health = trackBrowserHealth(page);
    await installCallableHarness(page);
    await page.goto("/login?role=client");

    await expect(page.getByRole("heading", { name: "Client account" })).toBeVisible();
    await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/account$/u);
    await page.goto("/account/family");
    await expect(page.getByRole("heading", { name: "Your family" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Linked Synthetic Minor", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No support profile has been recorded.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Unlinked Synthetic Minor");
    await expect(page.locator("body")).not.toContainText(
      /academyId|relationshipId|claims|token|minor-t063/iu,
    );

    const dimensions = await page.evaluate(() => ({
      bodyClientWidth: document.body.clientWidth,
      bodyWidth: document.body.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);

    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Administrative access not authorized" }),
    ).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);

    expect(health.authRequests.length).toBeGreaterThan(0);
    expect(health.callableRequests.some((url) => url.includes("getFamily"))).toBe(true);
    expect(health.callableRequests.some((url) => url.includes("getHealthProfile"))).toBe(true);
    expect(health.directDataRequests).toEqual([]);
    expect(health.errors).toEqual([]);
  });
});
