import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

test.describe("medical references", () => {
  test("shows every reference label on demand and fills the lookup", async ({ page }) => {
    await installAdminFixture(page, {
      role: "coach",
      callables: {
        listHealthReferences: {
          references: [
            {
              studentId: "student-1",
              displayName: "Ana Coelho",
              staffReferenceLabel: "ASTHMA-INHALER",
            },
            { studentId: "student-2", displayName: "Ben Kid", staffReferenceLabel: "KNEE-BRACE" },
          ],
        },
        getHealthProfile: {
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
        },
      },
    });
    await page.goto("/admin/members/medical?adminTestRole=coach");

    await page.getByRole("button", { name: "Show all references" }).click();
    const table = page.getByRole("table", { name: "Staff reference labels" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table).toContainText("ASTHMA-INHALER");
    await page.getByRole("button", { name: "Use student-1" }).click();
    await expect(page.getByLabel("Student ID")).toHaveValue("student-1");
    await expect(page.getByRole("textbox", { name: /Staff reference label/ })).toHaveValue(
      "ASTHMA-INHALER",
    );
  });
});
