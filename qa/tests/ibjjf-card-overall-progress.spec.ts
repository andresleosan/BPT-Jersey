import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 2026-10-20 diagnosis, item 4. The IBJJF card on the member record read "Next graduation 66%" next
 * to classes 4/4 (3 imported + 1 at BPT) and days 42/30, both "Met"; skills nobody had rated held
 * the average down, and graduation review needs a later class anyway. This drives the real record
 * and card (admin E2E build) with synthetic callables only: it proves the UI, not the backend.
 */
const studentId = "student-visual-1";

// The office profile from member-record-visual.spec.ts: synthetic, no real member.
const profile = {
  view: "full",
  header: {
    studentId,
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
    studentId,
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
    membershipNumber: "33",
    details: { weightKg: 70, heightCm: 175, idCardExpiresOn: "2026-10-01" },
  },
};

// Shaped like the server's getStudentProgressSummary answer; the card's parser drops what it skips.
const progress = {
  state: "initialized",
  studentId,
  currentDefinition: { definitionKey: "white-belt" },
  targetDefinition: { definitionKey: "white-1st-stripe" },
  skillChecklist: [],
  currentLevelStartedAt: "2026-09-08T00:00:00.000Z",
  progressPercent: 66,
  criteria: {
    classes: { required: 4, completed: 4, imported: 3, met: true },
    time: { requiredDays: 30, elapsedDays: 42, met: true },
    skills: { total: 11, completed: 0, met: false, percentage: 0 },
    age: { requiredMinAge: null, requiredMaxAge: null, ageYears: 26, met: true },
    overallEligible: false,
  },
  totalAttendedClasses: 1,
  totalHours: 1,
  calculatedAt: "2026-10-20T12:00:00.000Z",
};

const callables = { getMemberProfile: profile, getStudentProgressSummary: { progress } };
const recordUrl = `/admin/members/profile?id=${studentId}&adminTestRole=owner`;

async function evidence(page: Page, testInfo: TestInfo, name: string, blocked: string[]) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page
    .getByRole("region", { name: "JIU-JITSU IBJJF" })
    .screenshot({ path: testInfo.outputPath(`${name}-card-${testInfo.project.name}.png`) });
  await page.screenshot({
    path: testInfo.outputPath(`${name}-page-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await testInfo.attach(`${name}-blocked-requests`, {
    body: JSON.stringify(blocked, null, 2),
    contentType: "application/json",
  });
}

test.describe("IBJJF card: overall progress is not graduation review (2026-10-20 item 4)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  // A dev server compiles each route on its first request.
  test.setTimeout(180_000);

  test("explains 66% beside two met criteria and names the unmet skills", async ({
    page,
  }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, { calls, callables });
    const blocked = await blockExternalRequests(page, Object.keys(callables));

    await page.goto(recordUrl, { timeout: 120_000 });
    const card = page.getByRole("region", { name: "JIU-JITSU IBJJF" });
    const bar = card.getByRole("progressbar", { name: "Overall progress" });
    await expect(bar).toHaveAttribute("value", "66", { timeout: 60_000 });
    await expect(bar).toHaveAccessibleDescription(
      "Average of classes, days and skills. It is not the graduation review.",
    );
    await expect(card.getByText("Next graduation")).toHaveCount(0);

    const criterion = (label: string) =>
      card.locator(".ibjjf-criteria > div").filter({ hasText: label });
    const classes = criterion("Classes since last promotion");
    await expect(classes).toHaveClass("ibjjf-met");
    await expect(classes).toContainText("4/4");
    await expect(classes).toContainText("3 imported + 1 in BPT");
    await expect(criterion("Days at this level")).toContainText("42/30");
    const skills = criterion("Skills at minimum rating");
    await expect(skills).toHaveClass("ibjjf-unmet");
    await expect(skills).toContainText("0/11");
    await expect(skills).toContainText("Not met");
    await expect(card).toContainText("Graduation review counts classes and days only.");
    await expect(card).toContainText(
      "Imported and office-added classes count towards the minimum but cannot open it.",
    );

    // Only this member's summary was asked for (React may ask twice in a dev build).
    const asked = calls.filter((call) => call.name === "getStudentProgressSummary");
    expect(asked.length).toBeGreaterThan(0);
    for (const call of asked) expect(call.body).toEqual({ data: { studentId } });
    await evidence(page, testInfo, "ibjjf-66", blocked);
  });

  test("offers a safe retry when the read fails, then shows the explained card", async ({
    page,
  }, testInfo) => {
    let failing = true;
    await installAdminFixture(page, { callables });
    await page.route("**/getStudentProgressSummary", async (route) => {
      if (!failing || route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { status: "INTERNAL", message: "INTERNAL" } }),
      });
    });
    const blocked = await blockExternalRequests(page, Object.keys(callables));

    await page.goto(recordUrl, { timeout: 120_000 });
    const card = page.getByRole("region", { name: "JIU-JITSU IBJJF" });
    await expect(card.getByRole("heading", { name: "Levels unavailable" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(card.getByRole("alert")).toHaveText(
      "Levels are unavailable right now. Please try again later.",
    );
    await evidence(page, testInfo, "ibjjf-error", blocked);

    failing = false;
    await card.getByRole("button", { name: "Try again" }).click();
    await expect(card.getByRole("progressbar", { name: "Overall progress" })).toHaveAttribute(
      "value",
      "66",
    );
    await expect(card.getByText("Skills at minimum rating")).toBeVisible();
    await evidence(page, testInfo, "ibjjf-retry", blocked);
  });
});
