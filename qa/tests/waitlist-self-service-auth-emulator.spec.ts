import { expect, test, type Page } from "@playwright/test";

const sessionId = "session-waitlist-ui";
const authEmulatorPort = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT ?? "9099";
const functionsEmulatorPort = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT ?? "5001";
const firestoreEmulatorPort = process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT ?? "8080";

function trackBrowserHealth(page: Page) {
  const errors: string[] = [];
  const authRequests: string[] = [];
  const callableRequests: string[] = [];
  const directDataRequests: string[] = [];
  const localRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  page.on("pageerror", (error) => errors.push("page: " + error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("127.0.0.1")) {
      const diagnosticUrl = new URL(url);
      diagnosticUrl.search = "";
      localRequests.push(diagnosticUrl.toString());
    }
    if (url.includes(`:${authEmulatorPort}/`)) authRequests.push(url);
    if (url.includes(`:${functionsEmulatorPort}/`)) callableRequests.push(url);
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|google\.firestore\.v1\.Firestore/iu.test(
        url,
      ) ||
      url.includes(`:${firestoreEmulatorPort}/`)
    ) {
      directDataRequests.push(url);
    }
  });
  return { errors, authRequests, callableRequests, directDataRequests, localRequests };
}

function overflow(page: Page) {
  return page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
}

test.describe("T060 waitlist self-service with Firebase Emulators", () => {
  test("joins and cancels through real Auth, Functions and Firestore boundaries @critical", async ({
    page,
  }) => {
    test.skip(
      process.env.WAITLIST_UI_EMULATOR_E2E !== "true" ||
        process.env.AUTH_EMULATOR_E2E_ROLE !== "adultStudent" ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "demo-bpt-jersey" ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Synthetic adultStudent Auth/Firestore/Functions Emulator data is required.",
    );
    expect(process.env.NEXT_PUBLIC_ADMIN_E2E).not.toBe("true");

    const health = trackBrowserHealth(page);
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto("/login?role=client");
    await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/account$/u);
    await page.getByRole("link", { name: "Manage class waitlists" }).click();
    await expect(page).toHaveURL(/\/account\/waitlist$/u);
    await expect(page.getByRole("heading", { name: "Hold your place on the mat." })).toBeVisible();
    const participantOption = page.getByRole("option", { name: "Synthetic Adult Waitlist" });
    await expect(
      participantOption,
      JSON.stringify({ errors: health.errors, localRequests: health.localRequests }),
    ).toHaveCount(1);
    await expect(page.getByLabel("Participant")).toContainText("Synthetic Adult Waitlist");
    await page.getByLabel("Class", { exact: true }).selectOption(sessionId);
    await expect(page.getByText("No waitlist requests for this participant yet.")).toBeVisible();

    const desktop = await overflow(page);
    expect(desktop.documentWidth).toBeLessThanOrEqual(desktop.documentClientWidth);
    expect(desktop.bodyWidth).toBeLessThanOrEqual(desktop.bodyClientWidth);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Join waitlist" })).toBeVisible();
    const mobile = await overflow(page);
    expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.documentClientWidth);
    expect(mobile.bodyWidth).toBeLessThanOrEqual(mobile.bodyClientWidth);

    await page.getByRole("button", { name: "Join waitlist" }).click();
    await expect(page.getByRole("status")).toHaveText("Joined the waitlist at position 1.");
    await expect(page.getByLabel("Position 1")).toHaveText("01");
    await expect(page.getByText("Waiting", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Cancel place" }).click();
    await expect(page.getByText("Cancel this waitlist place?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(page.getByRole("status")).toHaveText("Waitlist place cancelled.");
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel place" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Request already recorded" })).toBeDisabled();

    await expect(page.locator("body")).not.toContainText(
      /academyId|membershipId|studentId|session-waitlist-ui|membership-waitlist-ui|synthetic-academy/iu,
    );
    for (const callable of [
      "listMemberships",
      "listSessions",
      "listStudentWaitlist",
      "joinWaitlist",
      "cancelWaitlistEntry",
    ]) {
      expect(
        health.callableRequests.some((url) => url.includes(callable)),
        `${callable}: ${JSON.stringify(health.callableRequests)}`,
      ).toBe(true);
    }
    expect(health.authRequests.length).toBeGreaterThan(0);
    expect(health.directDataRequests).toEqual([]);
    expect(health.errors).toEqual([]);
  });
});
