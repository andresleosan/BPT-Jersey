import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";

const references = {
  references: [
    { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" },
    { studentId: "student-2", displayName: "Ben Kid", staffReferenceLabel: "KNEE-BRACE" },
  ],
};

const profile = {
  healthProfileId: "student-1",
  academyId: "synthetic-academy",
  studentId: "student-1",
  minimumOperationalSupport: ["none"],
  conditionSummary: null,
  staffReferenceLabel: "ASTHMA-INHALER",
  reviewState: "current",
  expiresAt: null,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-08-24T12:00:00Z",
  createdBy: "u",
  updatedAt: "2026-08-24T12:00:00Z",
  updatedBy: "u",
  pendingChangeRequest: null,
};

test.describe("medical references", () => {
  test("lets a coach retype the label without ever reading the medical record", async ({
    page,
  }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      role: "coach",
      calls,
      callables: {
        listHealthReferences: references,
        // getHealthProfile is deliberately absent: a coach must never reach it.
        saveHealthReferenceLabel: (body: unknown) => ({
          studentId: "student-1",
          staffReferenceLabel: (body as { data: { staffReferenceLabel: string | null } }).data
            .staffReferenceLabel,
        }),
      },
    });
    await page.goto("/admin/members/medical?adminTestRole=coach");

    await page.getByRole("button", { name: "Show all references" }).click();
    const table = page.getByRole("table", { name: "Staff reference labels" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await page.getByRole("button", { name: "Use student-1" }).click();
    await expect(page.getByLabel("Student ID")).toHaveValue("student-1");

    const label = page.getByRole("textbox", { name: /Staff reference label/ });
    await expect(label).toHaveValue("ASTHMA-INHALER");
    await label.fill("INHALER-BAG");
    await page.getByRole("button", { name: "Save reference label" }).click();

    await expect(page.getByText("Reference label saved for student student-1.")).toBeVisible();
    expect(calls.some((call) => call.name === "getHealthProfile")).toBe(false);
    expect(calls.filter((call) => call.name === "saveHealthReferenceLabel")).toEqual([
      {
        name: "saveHealthReferenceLabel",
        body: { data: { studentId: "student-1", staffReferenceLabel: "INHALER-BAG" } },
      },
    ]);
    await page.screenshot({
      path: testInfo.outputPath(`medical-references-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test("keeps the office lookup on the full medical record", async ({ page }) => {
    await installAdminFixture(page, {
      role: "administrator",
      callables: { listHealthReferences: references, getHealthProfile: profile },
    });
    await page.goto("/admin/members/medical?adminTestRole=administrator");

    await page.getByRole("button", { name: "Show all references" }).click();
    const table = page.getByRole("table", { name: "Staff reference labels" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table).toContainText("ASTHMA-INHALER");
    await page.getByRole("button", { name: "Use student-1" }).click();
    await expect(page.getByLabel("Student ID")).toHaveValue("student-1");
    await expect(page.getByRole("textbox", { name: /Staff reference label/ })).toHaveValue(
      "ASTHMA-INHALER",
    );
    await expect(page.getByLabel(/Condition summary/)).toBeVisible();
  });
});
