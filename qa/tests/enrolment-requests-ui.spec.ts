import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";

const waiting = {
  enrolmentRequestId: "enrolment-1",
  applicantName: "Alex Adult",
  applicantIsStudent: true,
  minorCount: 0,
  trainingCenter: "Town",
  status: "submitted",
  submittedAt: "2026-09-06T10:00:00.000Z",
};

const detail = {
  enrolmentRequestId: "enrolment-1",
  status: "submitted",
  applicantIsStudent: true,
  applicant: {
    fullName: "Alex Adult",
    dateOfBirth: "1991-03-04",
    phoneNumber: "+441534000122",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    postalAddress: { line: "2 Synthetic Lane", postCode: "JE2 4XY" },
  },
  minors: [],
  submittedBy: "client-1",
  submittedAt: "2026-09-06T10:00:00.000Z",
};

test.describe("enrolment requests", () => {
  test("office reads and sends back through the buttons", async ({ page }) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      calls,
      callables: {
        listEnrolmentRequests: { requests: [waiting], truncated: false },
        getEnrolmentRequestDetail: detail,
        returnEnrolmentRequest: { ...waiting, status: "returned" },
        approveEnrolmentRequest: {
          enrolmentRequestId: "enrolment-1",
          alreadyApproved: false,
          role: "adultStudent",
          studentIds: ["student-1"],
        },
      },
    });
    await page.goto("/admin/members/requests?adminTestRole=owner");

    await expect(page.getByRole("region", { name: "What the buttons do" })).toContainText(
      "Approve and enrol",
    );
    const approve = page.getByRole("button", { name: "Approve and enrol" });
    await expect(approve).toBeDisabled();
    await page.getByRole("button", { name: "Read the full request" }).click();
    await expect(page.getByText("1991-03-04")).toBeVisible();
    await expect(approve).toBeEnabled();

    await page.getByLabel("What needs to change").fill("Add the emergency contact.");
    await page.getByRole("button", { name: "Send back to applicant" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Sent back to Alex Adult." }),
    ).toBeVisible();
    expect(calls.find((call) => call.name === "returnEnrolmentRequest")?.body).toEqual({
      data: { enrolmentRequestId: "enrolment-1", note: "Add the emergency contact." },
    });
  });

  test("a coach sees the queue without the office buttons", async ({ page }) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      calls,
      role: "coach",
      callables: { listEnrolmentRequests: { requests: [waiting], truncated: false } },
    });
    await page.goto("/admin/members/requests?adminTestRole=coach");

    await expect(page.getByText("Alex Adult")).toBeVisible();
    await expect(page.getByRole("button", { name: "Read the full request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve and enrol" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send back to applicant" })).toBeVisible();
    // The two confidential callables are office-only and are never reached from the mat.
    expect(
      calls.filter(
        (call) =>
          call.name === "getEnrolmentRequestDetail" || call.name === "approveEnrolmentRequest",
      ),
    ).toEqual([]);
  });
});
