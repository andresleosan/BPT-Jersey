import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

/**
 * T051V2 visual evidence for the member record (E1) against the NEXT_PUBLIC_ADMIN_E2E static build.
 * Every callable is answered by the fixture with synthetic data.
 */
const fullProfile = {
  view: "full",
  header: {
    studentId: "student-visual-1",
    fullName: "Test Member A",
    age: 26,
    participantType: "adult",
    status: "active",
    maskedMemberReference: "****0000",
    birthdayBadge: { kind: "inDays", days: 3 },
  },
  cards: {
    memberSince: "2026-01-15",
    monthsAsMember: 8,
    profession: "Tester",
    accountManagers: [{ displayName: "Test Guardian", familyId: "family-visual-1" }],
    currentMembership: {
      membershipId: "membership-visual-1",
      planName: "Test Plan",
      status: "active",
      validUntil: "2026-12-31",
    },
  },
  details: {
    studentId: "student-visual-1",
    fullName: "Test Member A",
    dateOfBirth: "2000-09-20",
    phoneNumber: "+44 7700900000",
    email: "member-a@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    gender: "unknown",
    membershipNumber: "00000000",
    postalAddress: { line: "1 Test Street", postCode: "JE0 0AA" },
    details: { country: "JE", weightKg: 70, heightCm: 175, idCardExpiresOn: "2026-10-01" },
  },
};

// The coach view carries no member reference at all (not even an undefined key).
const coachProfile = {
  view: "coach",
  header: {
    studentId: fullProfile.header.studentId,
    fullName: fullProfile.header.fullName,
    age: fullProfile.header.age,
    participantType: fullProfile.header.participantType,
    status: fullProfile.header.status,
    birthdayBadge: fullProfile.header.birthdayBadge,
  },
};

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const phone = testInfo.project.name === "mobile-chromium";
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: `screenshots/member-record-${name}${phone ? "-phone" : ""}.png`,
    fullPage: true,
    style: ".skip-link { display: none !important; }",
  });
}

test.describe("member record visual (T051V2)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E static build");

  test("office search, profile, details and an empty tab", async ({ page }, testInfo) => {
    await installAdminFixture(page, {
      callables: {
        getMemberProfile: fullProfile,
        searchMemberNames: {
          members: [{ studentId: "student-visual-1", fullName: "Test Member A" }],
        },
        listRegyfitMemberRecords: { rows: [], total: 0, capturedAt: "2026-09-04T18:04:32.000Z" },
      },
    });

    await page.goto("/admin/members/search?adminTestRole=owner");
    await page.getByLabel("Member name").fill("test");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("link", { name: "Open record for Test Member A" })).toBeVisible();
    await capture(page, testInfo, "search");

    await page.getByRole("link", { name: "Open record for Test Member A" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Test Member A" })).toBeVisible();
    await capture(page, testInfo, "profile");

    await page.getByRole("tab", { name: "Details" }).click();
    await expect(page.getByRole("form", { name: "Member details" })).toBeVisible();
    await capture(page, testInfo, "details");

    await page.getByRole("tab", { name: "Payments" }).click();
    await expect(page.getByRole("link", { name: "Open Billing" })).toBeVisible();
    await capture(page, testInfo, "payments-empty");
  });

  test("coach record shows the header and Profile only", async ({ page }, testInfo) => {
    await installAdminFixture(page, {
      role: "coach",
      callables: { getMemberProfile: coachProfile },
    });
    await page.goto("/admin/members/profile?id=student-visual-1&tab=details&adminTestRole=coach");
    await expect(page.getByRole("heading", { level: 2, name: "Test Member A" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await capture(page, testInfo, "coach");
  });
});
