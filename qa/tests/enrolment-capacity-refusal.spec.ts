import { expect, test } from "@playwright/test";

import {
  directoryCapacityExhaustedFailureCode,
  directoryCapacityExhaustedOfficeMessage,
} from "@bpt-jersey/domain/members/enrolment-requests";

import { installAdminFixture, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 2026-10-20 diagnosis, item 1. With the member directory at its rollback bound, approving an
 * enrolment used to stop as "member_write_failed". The real requests page is driven here with
 * synthetic callables; approveEnrolmentRequest answers exactly what mapOfficeError sends for the
 * service's new refusal (unit-tested in apps/functions). Browser UI coverage with a mocked backend:
 * no Functions, Firestore or directory state is involved.
 */
const requestId = "enrolment-diag-1";
const applicant = "Test Applicant A";

const row = (status: string) => ({
  enrolmentRequestId: requestId,
  applicantName: applicant,
  applicantIsStudent: true,
  minorCount: 0,
  trainingCenter: "Town",
  status,
  submittedAt: "2026-10-18T10:00:00.000Z",
});

const detail = {
  enrolmentRequestId: requestId,
  status: "submitted",
  applicantIsStudent: true,
  applicant: {
    fullName: applicant,
    dateOfBirth: "1991-03-04",
    email: "applicant-a@example.test",
    phoneNumber: "+441534000122",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
  },
  minors: [],
  planSelections: { applicant: "bpt-jersey-adult", minors: [] },
  submittedBy: "client-diag-1",
  submittedAt: "2026-10-18T10:00:00.000Z",
  applicantAccount: { email: "applicant-a@example.test", emailVerified: true, disabled: false },
};

test.describe("enrolment approval at the member directory bound (2026-10-20 item 1)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("names the capacity refusal, parks the request and enrols on a later approval", async ({
    page,
  }, testInfo) => {
    const calls: CallableCall[] = [];
    let approvals = 0;
    const statusAfter = ["submitted", "approval-failed", "approved"];
    const callables = {
      listEnrolmentRequests: () => ({ requests: [row(statusAfter[approvals]!)], truncated: false }),
      getEnrolmentRequestDetail: detail,
      approveEnrolmentRequest: null,
    };
    await installAdminFixture(page, { calls, callables });
    await page.route("**/approveEnrolmentRequest", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      approvals += 1;
      calls.push({ name: "approveEnrolmentRequest", body: route.request().postDataJSON() });
      if (approvals === 1) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              status: "FAILED_PRECONDITION",
              message: `${directoryCapacityExhaustedFailureCode}: ${directoryCapacityExhaustedOfficeMessage}`,
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            enrolmentRequestId: requestId,
            role: "adultStudent",
            studentIds: ["student-diag-1"],
            alreadyApproved: false,
          },
        }),
      });
    });
    const blocked = await blockExternalRequests(page, Object.keys(callables));

    await page.goto("/admin/members/requests?adminTestRole=owner", { timeout: 120_000 });
    const review = page.getByRole("button", { name: "Review and enrol" });
    await expect(review).toBeVisible({ timeout: 60_000 });

    // Cancel: opening and closing the review approves nothing.
    await review.click();
    await expect(page.getByRole("heading", { name: "Review and confirm enrolment" })).toBeVisible();
    await page.getByRole("button", { name: "Close review" }).click();
    await expect(page.getByRole("heading", { name: "Review and confirm enrolment" })).toHaveCount(
      0,
    );
    expect(approvals).toBe(0);

    // Error: the office reads the refusal, its slug and what to do, and the request parks.
    await page.getByRole("button", { name: "Review and enrol" }).click();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const refusal = page
      .getByRole("alert")
      .filter({ hasText: directoryCapacityExhaustedFailureCode });
    await expect(refusal).toHaveText(
      `${directoryCapacityExhaustedFailureCode}: ${directoryCapacityExhaustedOfficeMessage}`,
    );
    await expect(
      page.getByRole("list", { name: "Enrolment requests" }).getByText("Approval stopped"),
    ).toBeVisible();
    await expect(page.getByText(/member_write_failed|family_write_failed/u)).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`enrolment-capacity-refusal-${testInfo.project.name}.png`),
      fullPage: true,
    });

    // Repeat: once the directory has room, approving the same parked request enrols. Two clicks on
    // the button at once still send one approval: the two calls counted below are the refusal and
    // this one. (Clicked in the page, as the first click clears the notice and moves the button.)
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await approve.evaluate((button: HTMLElement) => {
      button.click();
      button.click();
    });
    await expect(
      page.getByRole("status").filter({ hasText: `${applicant} is enrolled and can now sign in.` }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`enrolment-capacity-retry-${testInfo.project.name}.png`),
      fullPage: true,
    });

    const approvalBodies = calls
      .filter((call) => call.name === "approveEnrolmentRequest")
      .map((call) => (call.body as { data: { enrolmentRequestId: string; setup: unknown } }).data);
    expect(approvalBodies).toHaveLength(2);
    expect(approvalBodies.map((body) => body.enrolmentRequestId)).toEqual([requestId, requestId]);
    expect(approvalBodies[1]?.setup).toEqual(approvalBodies[0]?.setup);
    await testInfo.attach("blocked-requests", {
      body: JSON.stringify(blocked, null, 2),
      contentType: "application/json",
    });
  });
});
