import { expect, test, type Page } from "@playwright/test";

const alerts = [
  {
    studentReference: "student-retention-a",
    kind: "attendance_gap",
    severity: "warning",
    status: "open",
    evidence: {
      lastAttendedAt: "2026-08-01T10:00:00Z",
      noShowCount: 0,
      membershipEndsAt: null,
    },
    createdAt: "2026-08-28T12:00:00Z",
  },
  {
    studentReference: "student-retention-b",
    kind: "repeated_no_show",
    severity: "warning",
    status: "open",
    evidence: {
      lastAttendedAt: "2026-08-24T10:00:00Z",
      noShowCount: 3,
      membershipEndsAt: null,
    },
    createdAt: "2026-08-28T12:00:00Z",
  },
  {
    studentReference: "student-retention-c",
    kind: "membership_expiring",
    severity: "warning",
    status: "open",
    evidence: {
      lastAttendedAt: "2026-08-25T10:00:00Z",
      noShowCount: 0,
      membershipEndsAt: "2026-09-02T00:00:00Z",
    },
    createdAt: "2026-08-28T12:00:00Z",
  },
] as const;

async function installRetentionFixture(
  page: Page,
  requests: unknown[],
  directDataRequests: string[],
): Promise<void> {
  page.on("request", (request) => {
    const url = request.url();
    if (
      /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app|google\.firestore\.v1\.Firestore|:(?:8080|9000)\//iu.test(
        url,
      )
    ) {
      directDataRequests.push(url);
    }
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.url().includes("listRetentionAlerts")) {
      requests.push(request.postDataJSON());
      await route.fulfill({
        body: JSON.stringify({ data: { alerts } }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.continue();
  });
}

test.describe("T062 retention inbox", () => {
  test("shows a minimized read-only signal queue without horizontal overflow", async ({ page }) => {
    const browserErrors: string[] = [];
    const requests: unknown[] = [];
    const directDataRequests: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await installRetentionFixture(page, requests, directDataRequests);

    await page.goto("/admin/retention?adminTestRole=owner");

    await expect(page.getByRole("heading", { name: "Retention inbox", level: 2 })).toBeVisible();
    await expect(page.getByText("Owner and administrator access only.")).toBeVisible();
    await expect(page.getByLabel("Open retention signals")).toBeVisible();
    await expect(page.getByText("student-retention-a")).toBeVisible();
    await expect(page.getByText("student-retention-b")).toBeVisible();
    await expect(page.getByText("student-retention-c")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /assign|close signal|snooze|contact|send email|send sms/iu,
      }),
    ).toHaveCount(0);

    await page.getByLabel("Retention signal", { exact: true }).selectOption("repeated_no_show");
    await expect(page.getByText("student-retention-b")).toBeVisible();
    await expect(page.getByText("student-retention-a")).not.toBeVisible();
    await expect(page.getByText("student-retention-c")).not.toBeVisible();

    expect(requests).toEqual([{ data: null }]);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /academyId|alertId|deduplicationKey|emailAddress|phoneNumber|invoiceId|membershipId/iu,
    );
    const dimensions = await page.evaluate(() => ({
      bodyClientWidth: document.body.clientWidth,
      bodyWidth: document.body.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth);
    expect(directDataRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });
});
