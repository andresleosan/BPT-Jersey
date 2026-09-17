import { expect, test } from "@playwright/test";

const projectId = "demo-bpt-jersey";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
// The browser has no App Check provider against emulators, and the schedule callables enforce it.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:cs-import-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

/**
 * T049V2 (Plan 4a): sessions written by the Regyfit import appear in the Classes & Services 2.0
 * calendar through real Auth, Functions and Firestore emulators. Data is the synthetic fixture in
 * qa/fixtures/regyfit-classes-services-synthetic; the runner imports it before this spec.
 */
test.describe("Classes & Services import on Firebase Emulators", () => {
  test("shows the imported week in the calendar", async ({ page }) => {
    test.skip(
      process.env.CS_IMPORT_UI_EMULATOR_E2E !== "true" ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "demo-bpt-jersey" ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Synthetic owner and imported emulator data are required.",
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://127.0.0.1:5001/**", (route) =>
      route.continue({
        headers: { ...route.request().headers(), "x-firebase-appcheck": syntheticAppCheckToken() },
      }),
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account/u);

    await page.goto("/admin/classes-services/classes");
    await page.getByLabel("Go to date").fill("2026-09-14");
    await expect(page.getByText("14 – 20 SEP 2026")).toBeVisible();
    // Each callable cold-starts its own emulator worker on first use, which can outlast 5 s.
    await expect(page.getByText("Loading the schedule…")).toHaveCount(0, { timeout: 30_000 });
    // Taken before the synthetic assertions so Task 4 gets it from the real week too.
    await page.screenshot({
      path: "test-results/classes-services-import-week.png",
      fullPage: true,
    });

    const classesCounter = page.locator(".cs-counters div", { hasText: "Classes" }).locator("dd");
    const status = page.getByLabel("Status");
    // Default filter is Active: only the two classes after the pinned import instant.
    await expect(classesCounter, JSON.stringify(errors)).toHaveText("2");
    await expect(
      page.locator(".cs-day", { hasText: "SAT 19/9" }).getByText("Synthetic Open Mat"),
    ).toBeVisible();
    await expect(
      page.locator(".cs-day", { hasText: "MON 14/9" }).getByText("Synthetic GI Mornings"),
    ).toHaveCount(0);
    // Past classes were imported as completed and are found through the Status filter.
    await status.selectOption("inactive");
    await expect(classesCounter).toHaveText("2");
    await status.selectOption("all");
    await expect(classesCounter).toHaveText("4");
    await page.screenshot({
      path: "test-results/classes-services-import-week-all.png",
      fullPage: true,
    });

    const monday = page.locator(".cs-day", { hasText: "MON 14/9" });
    await expect(monday.getByText("1 classes")).toBeVisible();
    // 06:00 in Jersey (BST) is stored as 05:00Z: the card must still read 06:00.
    await expect(
      monday.getByRole("button", { name: /Synthetic GI Mornings\s*06:00 - 07:00/u }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
