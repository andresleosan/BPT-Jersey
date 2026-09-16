import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";

const townLocation = {
  locationId: "loc-town",
  academyId: "bpt-jersey",
  name: "BPT Town",
  address: "St Helier",
  timezone: "Europe/Jersey",
  active: true,
  abbreviation: "town",
  kind: "presential" as const,
  schemaVersion: "1" as const,
};

const westLocation = {
  locationId: "loc-west",
  academyId: "bpt-jersey",
  name: "BPT West",
  address: "St Brelade",
  timezone: "Europe/Jersey",
  active: true,
  abbreviation: "west",
  kind: "presential" as const,
  schemaVersion: "1" as const,
};

const giProgram = {
  programId: "prog-gi",
  academyId: "bpt-jersey",
  name: "GI All Levels Evenings",
  ageBand: "adult" as const,
  discipline: "bjj" as const,
  level: "all-levels" as const,
  active: true,
  schemaVersion: "1" as const,
  abbreviation: "GI",
  colour: "#4C6FFF",
  kind: "class-frequency" as const,
  dropInPolicy: "unlimited" as const,
  notifyByEmail: false,
  showInList: true,
  message: "",
};

const noGiProgram = {
  programId: "prog-nogi",
  academyId: "bpt-jersey",
  name: "No-Gi Fundamentals",
  ageBand: "adult" as const,
  discipline: "bjj" as const,
  level: "fundamentals" as const,
  active: true,
  schemaVersion: "1" as const,
  abbreviation: "NOGI",
  colour: "#22A26B",
  kind: "class-frequency" as const,
  dropInPolicy: "no" as const,
  notifyByEmail: false,
  showInList: true,
  message: "",
};

const catalog = { locations: [townLocation, westLocation], programs: [giProgram, noGiProgram] };

const sessionOne = {
  sessionId: "s1",
  academyId: "bpt-jersey",
  classId: null,
  programId: "prog-gi",
  locationId: "loc-town",
  instructorId: "staff-synthetic-1",
  instructorIds: ["staff-synthetic-1"],
  title: "GI All Levels Evenings",
  startAt: "2026-09-16T18:00:00.000Z",
  endAt: "2026-09-16T19:00:00.000Z",
  capacity: 20 as number | null,
  minParticipants: 1,
  status: "scheduled" as const,
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "staff-synthetic-1",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "staff-synthetic-1",
  bookingRules: "defined" as const,
  waitingList: "general" as const,
};

const sessionTwo = {
  ...sessionOne,
  sessionId: "s2",
  programId: "prog-nogi",
  title: "No-Gi Fundamentals",
  startAt: "2026-09-17T18:00:00.000Z",
  endAt: "2026-09-17T19:00:00.000Z",
  capacity: null as number | null,
};

const sessions = [sessionOne, sessionTwo];

const staffProfiles = [
  {
    staffKey: "staff-synthetic-1",
    role: "coach" as const,
    active: true,
    status: "active" as const,
    schemaVersion: "1" as const,
  },
];

test.describe("@classes-services", () => {
  test("locations: create and toggle status", async ({ page }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      calls,
      callables: {
        listScheduleCatalog: catalog,
        listSessions: { sessions: [] },
        saveLocation: (body: unknown) => ({
          location: {
            ...westLocation,
            locationId: "loc-ouest",
            ...(body as { data: object }).data,
          },
        }),
        updateLocation: (body: unknown) => ({
          location: { ...westLocation, ...(body as { data: object }).data },
        }),
      },
    });
    await page.goto("/admin/classes-services/locations?adminTestRole=owner");

    await expect(page.getByRole("tab", { name: "Locations" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.getByLabel("Name").fill("Salle Ouest");
    await page.getByLabel("Abbreviation").fill("ouest");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Salle Ouest")).toBeVisible();

    await page.getByRole("combobox", { name: "Status of BPT West" }).selectOption("inactive");
    await expect.poll(() => calls.some((c) => c.name === "updateLocation")).toBe(true);

    const phone = testInfo.project.name === "mobile-chromium" ? "-phone" : "";
    await page.screenshot({ path: `screenshots/cs-locations${phone}.png`, fullPage: true });
  });

  test("types: inline colour and drop-in policy", async ({ page }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      calls,
      callables: {
        listScheduleCatalog: catalog,
        listSessions: { sessions: [] },
        saveProgram: (body: unknown) => ({
          program: { ...giProgram, programId: "prog-new", ...(body as { data: object }).data },
        }),
        updateProgram: (body: unknown) => ({
          program: { ...giProgram, ...(body as { data: object }).data },
        }),
      },
    });
    await page.goto("/admin/classes-services/types?adminTestRole=owner");

    await expect(page.getByRole("tab", { name: "Class / Service Types" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const colourInput = page.getByLabel(`Colour of ${giProgram.name}`);
    await colourInput.focus();
    await colourInput.evaluate((element: HTMLInputElement) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(element, "#ff0000");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await colourInput.blur();
    await expect.poll(() => calls.some((c) => c.name === "updateProgram")).toBe(true);

    await page.getByRole("combobox", { name: `Drop-ins of ${noGiProgram.name}` }).selectOption("2");
    await expect
      .poll(() => calls.filter((c) => c.name === "updateProgram").length)
      .toBeGreaterThanOrEqual(2);

    const phone = testInfo.project.name === "mobile-chromium" ? "-phone" : "";
    await page.screenshot({ path: `screenshots/cs-types${phone}.png`, fullPage: true });
  });

  test("classes: week calendar, session panel and copy week preview", async ({
    page,
  }, testInfo) => {
    await installAdminFixture(page, {
      callables: {
        listScheduleCatalog: catalog,
        listSessions: { sessions },
        listSessionBookedCounts: { counts: { s1: 2, s2: 3 } },
        listStaffProfiles: staffProfiles,
        previewWeek: { preview: { count: 2, sample: [] } },
        copyWeek: { sessions },
      },
    });
    await page.clock.setFixedTime(new Date("2026-09-16T10:00:00Z"));
    await page.goto("/admin/classes-services/classes?adminTestRole=owner");

    await expect(page.getByText("14 – 20 SEP 2026")).toBeVisible();

    await page.getByRole("button", { name: /GI All Levels Evenings/ }).click();
    await expect(page.getByRole("dialog", { name: /Create classes\/services/i })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Copy week" }).click();
    await expect(
      page.getByText("2 classes will be copied to the week of 21 Sep 2026."),
    ).toBeVisible();

    const phone = testInfo.project.name === "mobile-chromium" ? "-phone" : "";
    await page.screenshot({ path: `screenshots/cs-classes-week${phone}.png`, fullPage: true });

    await page.keyboard.press("Escape");
    await page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "List" }).click();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("coach sees three tabs and no mutations", async ({ page }) => {
    await installAdminFixture(page, {
      role: "coach",
      callables: {
        listScheduleCatalog: catalog,
        listSessions: { sessions },
        listSessionBookedCounts: { counts: {} },
        listStaffProfiles: staffProfiles,
      },
    });
    await page.clock.setFixedTime(new Date("2026-09-16T10:00:00Z"));
    await page.goto("/admin/classes-services/classes?adminTestRole=coach");

    await expect(
      page.getByRole("navigation", { name: "Classes / Services sections" }).getByRole("tab"),
    ).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Copy week" })).toHaveCount(0);
  });
});
