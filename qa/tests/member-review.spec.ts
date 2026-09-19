import { expect, test } from "@playwright/test";
import {
  assignMemberGuardianInputSchema,
  setMemberDateOfBirthInputSchema,
} from "@bpt-jersey/domain/members/migration";
import type { MemberProfile } from "@bpt-jersey/domain/members/profile";
import { installAdminFixture } from "./admin-fixture";

test.use({ serviceWorkers: "block" });

test("office resolves missing age and assigns a guardian with keyboard, retry and responsive layout", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.setViewportSize({ width: isMobile ? 375 : 1440, height: 900 });
  let review: "date" | "guardian" | "assigned" = "date";
  let assignmentAttempts = 0;
  const requests: unknown[] = [];
  const flags = () =>
    review === "date"
      ? { reviewReason: "date-of-birth-missing" as const }
      : { guardianStatus: review === "guardian" ? ("pending" as const) : ("assigned" as const) };
  const row = () => ({
    studentId: "review-1",
    fullName: "Synthetic Review Member",
    trainingCenter: "Town" as const,
    participantType: "minor" as const,
    status: "active" as const,
    active: true,
    ...flags(),
  });
  const profile = (): MemberProfile => ({
    view: "full",
    header: {
      studentId: "review-1",
      fullName: "Synthetic Review Member",
      participantType: "minor",
      status: "active",
      age: review === "date" ? null : 12,
      birthdayBadge: null,
      ...flags(),
    },
    details: {
      ...row(),
      ...(review === "date" ? {} : { dateOfBirth: "2014-01-01" }),
      trainingTimePreferences: ["evening"],
      gender: "unknown",
    },
    cards: {
      memberSince: "2026-09-19",
      monthsAsMember: 0,
      accountManagers: [],
      currentMembership: null,
    },
  });
  await installAdminFixture(page, {
    callables: {
      listMembers: () => ({ rows: [row()] }),
      getMemberProfile: () => profile(),
      setMemberDateOfBirth: (body: unknown) => {
        const input = setMemberDateOfBirthInputSchema.parse((body as { data: unknown }).data);
        expect(input.dateOfBirth).toBe("2014-01-01");
        review = "guardian";
        return { studentId: input.studentId };
      },
    },
  });
  await page.route("**/assignMemberGuardian", async (route) => {
    const input = assignMemberGuardianInputSchema.parse(
      (route.request().postDataJSON() as { data: unknown }).data,
    );
    requests.push(input);
    assignmentAttempts += 1;
    if (assignmentAttempts === 1) {
      await route.fulfill({
        status: 500,
        json: { error: { status: "INTERNAL", message: "Synthetic private backend detail" } },
      });
    } else {
      review = "assigned";
      await route.fulfill({ json: { result: { studentId: input.studentId } } });
    }
  });
  const capture = async (name: string) => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  };
  await page.goto("/admin/members?adminTestRole=owner");
  await expect(page.getByText("Check age", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending reviews on this page: 1")).toBeVisible();
  await capture("directory-check-age");
  await page.goto("/admin/members/profile?id=review-1&tab=notes&adminTestRole=owner");
  const dateButton = page.getByRole("button", { name: "Set date of birth", exact: true });
  await dateButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(page.getByLabel("Date of birth", { exact: true })).toBeFocused();
  await capture("set-date");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(dateButton).toBeFocused();
  await dateButton.click();
  await page.getByLabel("Date of birth", { exact: true }).fill("2014-01-01");
  await dialog.getByRole("button", { name: "Set date of birth", exact: true }).click();
  await expect(page.getByText("Guardian required", { exact: true })).toBeVisible();
  const assign = page.getByRole("button", { name: "Assign guardian", exact: true });
  await assign.click();
  await expect(page.getByLabel("Full name", { exact: true })).toBeFocused();
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.getByLabel("Full name", { exact: true }).fill("Synthetic Guardian");
  await page.getByLabel("Email", { exact: true }).fill("guardian@example.test");
  await capture("assign-guardian");
  await dialog.getByRole("button", { name: "Assign guardian", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Could not save this review. Please try again.",
  );
  await capture("review-error");
  await dialog.getByRole("button", { name: "Assign guardian", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Guardian required", { exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  await capture("review-complete");
});
