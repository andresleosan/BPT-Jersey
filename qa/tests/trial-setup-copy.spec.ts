import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * c886d32: the trial set-up on /admin/members/requests said "Adults book Introduction Classes
 * only.", which the booking rule contradicts (a declared belt may not book one). It now says an
 * adult beginner's first free class must be an Introduction Class. Same synthetic request as
 * enrolment-capacity-refusal.spec.ts; nothing is approved here.
 */
const requestId = "enrolment-trial-copy-1";
const applicant = "Test Applicant T";
const detail = {
  enrolmentRequestId: requestId,
  status: "submitted",
  applicantIsStudent: true,
  applicant: {
    fullName: applicant,
    dateOfBirth: "1991-03-04",
    email: "applicant-t@example.test",
    phoneNumber: "+441534000123",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
  },
  minors: [],
  planSelections: { applicant: "bpt-jersey-adult", minors: [] },
  submittedBy: "client-trial-1",
  submittedAt: "2026-10-18T10:00:00.000Z",
  applicantAccount: { email: "applicant-t@example.test", emailVerified: true, disabled: false },
};
const newCopy =
  "An adult beginner's first free class must be an Introduction Class; a declared belt books regular classes of their age.";

test.describe("Trial set-up copy on enrolment requests (c886d32)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("states the Introduction Class rule for beginners only", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    const callables = {
      listEnrolmentRequests: {
        requests: [
          {
            enrolmentRequestId: requestId,
            applicantName: applicant,
            applicantIsStudent: true,
            minorCount: 0,
            trainingCenter: "Town",
            status: "submitted",
            submittedAt: "2026-10-18T10:00:00.000Z",
          },
        ],
        truncated: false,
      },
      getEnrolmentRequestDetail: detail,
      // The page's intro-application panel asks on load.
      listIntroMembershipApplications: { applications: [] },
    };
    await installAdminFixture(page, { role: "owner", callables });
    const blocked = await blockExternalRequests(page, Object.keys(callables));
    await page.goto("/admin/members/requests?adminTestRole=owner", { timeout: 120_000 });
    await page.getByRole("button", { name: "Review and enrol" }).click({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Review and confirm enrolment" })).toBeVisible();

    const plan = page.getByRole("combobox", { name: "Subscription plan" });
    await plan.selectOption("trial:adults");
    const trial = page.locator(".enrolment-student-setup p").filter({ hasText: "Trial — no plan" });
    await expect(trial).toBeVisible();
    await expect(trial).toContainText(newCopy);
    await expect(trial).toHaveText(
      `Trial — no plan, dates or payment: 2 free classes for a beginner, 1 for a declared belt, within 30 days. ${newCopy} Confirm the initial level.`,
    );
    await expect(page.getByText(/Adults book Introduction Classes only/u)).toHaveCount(0);

    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll, "no horizontal page scroll").toBeLessThanOrEqual(width.client);
    await trial.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`trial-copy-${testInfo.project.name}.png`) });
    writeFileSync(testInfo.outputPath("blocked-requests.json"), JSON.stringify(blocked, null, 2));
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
  });
});
