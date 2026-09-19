import { expect, test, type Page } from "@playwright/test";

const projectId = "demo-bpt-jersey";

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
// The browser has no App Check provider against emulators, and the class history callables
// enforce App Check.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:class-history-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signInAsOwner(page: Page): Promise<void> {
  await page.route("http://127.0.0.1:5001/**", (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-firebase-appcheck": syntheticAppCheckToken() },
    }),
  );
  await page.goto("/staff/login");
  await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
  await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
  await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

/**
 * T048V2-H: the class registrations log read in a real browser against the Auth, Functions and
 * Firestore emulators. The events are planted by `qa/scripts/seed-class-history-emulator.mjs`
 * (three of them, on 15 Sep 2026); every name and sentence on screen is composed by the real
 * `listClassHistory` callable, and the PDF by the real `exportClassHistoryPdf`.
 */
test.describe("@classes-services class registrations log on Firebase Emulators", () => {
  test.beforeEach(() => {
    test.skip(
      process.env.T048_CLASS_HISTORY_EMULATOR_E2E !== "true" ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "A synthetic owner and seeded emulator events are required.",
    );
  });

  test("lists the log, empties it on a later filter and exports it", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsOwner(page);

    await page.goto("/admin/classes-services/history");
    await expect(page.getByRole("button", { name: "LIST" })).toBeVisible();
    // Nothing is read until the operator asks: the log is a restricted read, audited every time.
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByText("Choose the filters and press LIST to read the log."),
    ).toBeVisible();

    await page.getByLabel("Since", { exact: true }).fill("2026-09-01");
    await page.getByRole("button", { name: "LIST" }).click();
    // Each callable cold-starts its own emulator worker on first use, which can outlast 5 s.
    await expect(page.getByText("RECORDS (3)")).toBeVisible({ timeout: 30_000 });

    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["Date/time", "User", "IP", "Task"]);

    // Newest first: the staff drop-in at 11:30Z, then the member cancellation, then the booking.
    const rows = table.getByRole("row");
    await expect(rows.nth(1).getByRole("cell")).toHaveText([
      "15 Sep 2026 at 12:30",
      "staff-office-1",
      "198.51.100.7",
      "Bruno Synthetic was given a drop-in by staff-office-1 into GI All Levels Evenings on 16 Sep 2026 at 18:30",
    ]);
    await expect(rows.nth(2).getByRole("cell")).toHaveText([
      "15 Sep 2026 at 11:15",
      "Ana Synthetic",
      "203.0.113.10",
      "Ana Synthetic cancelled the booking for the class of 16 Sep 2026 at 18:30",
    ]);
    await expect(rows.nth(3).getByRole("cell")).toHaveText([
      "15 Sep 2026 at 10:00",
      "Ana Synthetic",
      "203.0.113.10",
      "Ana Synthetic booked the class of 16 Sep 2026 at 18:30",
    ]);

    await page.screenshot({
      path: "screenshots/cs-history-desktop.png",
      fullPage: true,
      style: ".skip-link { display: none !important; }",
    });

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^class-history-\d{4}-\d{2}-\d{2}\.pdf$/u);
    const savedPath = await file.path();
    expect(savedPath).not.toBeNull();

    // The filter bites: every seeded event is from 15 Sep, so a later "Since" empties the log.
    await page.getByLabel("Since", { exact: true }).fill("2026-09-16");
    await page.getByRole("button", { name: "LIST" }).click();
    await expect(page.getByText("RECORDS (0)")).toBeVisible();
    await expect(page.getByText("No records for these filters.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "PDF" })).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test("stacks the rows on a phone without overflowing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAsOwner(page);

    await page.goto("/admin/classes-services/history");
    await page.getByLabel("Since", { exact: true }).fill("2026-09-01");
    await page.getByRole("button", { name: "LIST" }).click();
    await expect(page.getByText("RECORDS (3)")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Ana Synthetic booked the class of 16 Sep 2026 at 18:30"),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    await page.screenshot({
      path: "screenshots/cs-history-mobile.png",
      fullPage: true,
      style: ".skip-link { display: none !important; }",
    });
  });
});
