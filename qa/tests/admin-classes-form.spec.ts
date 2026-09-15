import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";

const audit = {
  schemaVersion: "1",
  createdAt: "2026-09-01T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-01T10:00:00.000Z",
  updatedBy: "admin-1",
};
const catalog = {
  locations: [
    {
      locationId: "town",
      academyId: "synthetic-academy",
      name: "BPT Town",
      address: "St Helier",
      timezone: "Europe/Jersey",
      active: true,
      schemaVersion: "1",
    },
    {
      locationId: "west",
      academyId: "synthetic-academy",
      name: "BPT West",
      address: "St Peter",
      timezone: "Europe/Jersey",
      active: true,
      schemaVersion: "1",
    },
  ],
  programs: [
    {
      programId: "program-kids",
      academyId: "synthetic-academy",
      name: "Kids BJJ",
      ageBand: "kids",
      discipline: "bjj",
      level: "all-levels",
      active: true,
      schemaVersion: "1",
    },
  ],
};
const existingClass = {
  classId: "class-1",
  academyId: "synthetic-academy",
  programId: "program-kids",
  locationId: "town",
  name: "Kids BJJ",
  recurrenceRules: [
    { dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 },
    { dayOfWeek: 3, startTime: "17:00", durationMinutes: 60 },
  ],
  description: "Bring a gi.",
  ageRange: { minAge: 8, maxAge: 11 },
  levelRange: { fromKey: "k-white", toKey: "k-grey", fromName: "White", toName: "Grey" },
  instructorIds: ["coach-miro"],
  capacity: 20,
  minParticipants: 4,
  active: true,
  ...audit,
  schemaVersion: "2",
};

test.describe("admin classes", () => {
  test("creates a two-day class and shows it with its ranges", async ({ page }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      calls,
      callables: {
        listScheduleCatalog: catalog,
        listClasses: { classes: [existingClass] },
        listSessions: { sessions: [] },
        listStaffProfiles: [
          {
            staffKey: "coach-miro",
            role: "headCoach",
            active: true,
            status: "active",
            schemaVersion: "1",
          },
        ],
        listMemberships: [],
        listMembers: { rows: [] },
        saveClass: (body: unknown) => ({
          class: {
            ...(body as { data: object }).data,
            classId: "class-2",
            academyId: "synthetic-academy",
            active: true,
            ...audit,
            schemaVersion: "2",
          },
        }),
      },
    });
    await page.goto("/admin/classes?adminTestRole=owner");
    await expect(page.getByText("Mon 17:00 · Wed 17:00")).toBeVisible();
    await expect(page.getByText("Ages 8–11 · White → Grey")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`classes-list-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await page.getByRole("button", { name: "New class" }).click();
    await page.getByLabel("Class name").fill("Teens BJJ");
    await page.getByLabel("Program").selectOption("program-kids");
    await page.getByRole("radio", { name: "BPT West" }).click();
    await page.getByRole("button", { name: "Tuesday" }).click();
    await page.getByRole("button", { name: "Thursday" }).click();
    await page.getByLabel("Tuesday start time").fill("18:30");
    await page.getByRole("radio", { name: "12–15" }).click();
    await page.getByLabel("coach-miro").check();
    await page.screenshot({
      path: testInfo.outputPath(`classes-form-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Create class" }).click();
    await expect(page.getByRole("status")).toContainText("Class created.");
    const saved = calls.find((call) => call.name === "saveClass");
    expect(saved?.body).toMatchObject({
      data: {
        locationId: "west",
        recurrenceRules: [
          { dayOfWeek: 2, startTime: "18:30", durationMinutes: 60 },
          { dayOfWeek: 4, startTime: "18:00", durationMinutes: 60 },
        ],
        ageRange: { minAge: 12, maxAge: 15 },
      },
    });
  });

  test("a coach sees classes without any action", async ({ page }) => {
    await installAdminFixture(page, {
      role: "coach",
      callables: {
        listScheduleCatalog: catalog,
        listClasses: { classes: [existingClass] },
        listSessions: { sessions: [] },
      },
    });
    await page.goto("/admin/classes?adminTestRole=coach");
    await expect(page.getByText("Kids BJJ", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New class" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Remove|Edit|Generate/u })).toHaveCount(0);
  });
});
