import { expect, test, type Page } from "@playwright/test";

function trackBrowserHealth(page: Page) {
  const errors: string[] = [];
  const authRequests: string[] = [];
  const callableRequests: string[] = [];
  const directDataRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  page.on("pageerror", (error) => errors.push("page: " + error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes(":9099/")) authRequests.push(url);
    if (url.includes(":5001/") && url.includes("listRetentionAlerts")) {
      callableRequests.push(url);
    }
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|google\.firestore\.v1\.Firestore|:(?:8080|9000)\//iu.test(
        url,
      )
    ) {
      directDataRequests.push(url);
    }
  });
  return { errors, authRequests, callableRequests, directDataRequests };
}

test.describe("T062 retention inbox with Firebase Emulators", () => {
  test("uses real Auth, Functions, and Firestore boundaries responsively", async ({ page }) => {
    test.skip(
      process.env.RETENTION_EMULATOR_E2E !== "true" ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Synthetic T062 Emulator credentials and seed are required.",
    );
    expect(process.env.NEXT_PUBLIC_ADMIN_E2E).not.toBe("true");

    const health = trackBrowserHealth(page);
    await page.goto("/login?role=administrator");
    await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/admin$/u);
    await page.goto("/admin/retention");

    await expect(page.getByRole("heading", { name: "Retention inbox", level: 2 })).toBeVisible();
    await expect(page.getByText("student-retention-real")).toBeVisible();
    await expect(
      page.getByRole("article", {
        name: "Membership expiring for student-retention-real",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /assign|close signal|snooze|contact|send email|send sms/iu,
      }),
    ).toHaveCount(0);

    const dimensions = await page.evaluate(() => ({
      bodyClientWidth: document.body.clientWidth,
      bodyWidth: document.body.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
    expect(health.authRequests.length).toBeGreaterThan(0);
    expect(health.callableRequests).toHaveLength(1);
    expect(health.directDataRequests).toEqual([]);
    expect(health.errors).toEqual([]);
  });
});
