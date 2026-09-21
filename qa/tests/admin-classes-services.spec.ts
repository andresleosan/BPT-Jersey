import { expect, test, type Page, type TestInfo } from "@playwright/test";

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

const programsById = { [giProgram.programId]: giProgram, [noGiProgram.programId]: noGiProgram };

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
  capacity: 16 as number | null,
};

const sessions = [sessionOne, sessionTwo];

const staffProfiles = [
  {
    staffKey: "staff-synthetic-1",
    role: "coach" as const,
    active: true,
    status: "active" as const,
    self: false,
    schemaVersion: "1" as const,
  },
];

/**
 * Screenshots go to `qa/screenshots/`; the `-phone` suffix marks the mobile project. `fullPage`
 * stitches a page taller than the viewport, which repaints the `position: fixed` skip link
 * (`globals.css:80-97`) at the wrong offset regardless of focus; hide it for the capture only.
 */
async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const suffix = testInfo.project.name === "mobile-chromium" ? "-phone" : "";
  await page.screenshot({
    path: `screenshots/${name}${suffix}.png`,
    fullPage: true,
    style: ".skip-link { display: none !important; }",
  });
}

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
        updateLocation: (body: unknown) => {
          const data = (body as { data: { locationId: string } }).data;
          const base = data.locationId === townLocation.locationId ? townLocation : westLocation;
          return { location: { ...base, ...data } };
        },
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
    await expect
      .poll(() => calls.find((c) => c.name === "saveLocation")?.body)
      .toMatchObject({ data: { name: "Salle Ouest", abbreviation: "ouest" } });

    await page.getByRole("combobox", { name: "Status of BPT West" }).selectOption("inactive");
    await expect
      .poll(() => calls.find((c) => c.name === "updateLocation")?.body)
      .toMatchObject({ data: { locationId: "loc-west", active: false } });

    await capture(page, testInfo, "cs-locations");
  });

  test("types: inline colour and drop-in policy", async ({ page }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      calls,
      callables: {
        listScheduleCatalog: catalog,
        listSessions: { sessions: [] },
        updateProgram: (body: unknown) => {
          const data = (body as { data: { programId: string } }).data;
          const base = programsById[data.programId as keyof typeof programsById] ?? giProgram;
          return { program: { ...base, ...data } };
        },
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
    // Moves focus off the colour input so its `onBlur` save fires (the skip-link overlay seen in
    // earlier captures was a `fullPage` stitching artefact, unrelated to focus — see `capture()`).
    await page.getByRole("tab", { name: "Class / Service Types" }).focus();
    await expect
      .poll(() => calls.find((c) => c.name === "updateProgram")?.body)
      // The picker hands back lowercase; the page normalises to the domain's case before saving.
      .toMatchObject({ data: { programId: giProgram.programId, colour: "#FF0000" } });

    await page.getByRole("combobox", { name: `Drop-ins of ${noGiProgram.name}` }).selectOption("2");
    await expect
      .poll(
        () =>
          calls
            .filter((c) => c.name === "updateProgram")
            .map((c) => c.body as { data: { programId: string; dropInPolicy?: string } })
            .find((body) => body.data.programId === noGiProgram.programId)?.data.dropInPolicy,
      )
      .toBe("2");
    // Confirms B-1 stays fixed: the No-Gi row keeps its own name, not the GI row's.
    await expect(page.getByRole("row", { name: new RegExp(noGiProgram.name) })).toBeVisible();

    await capture(page, testInfo, "cs-types");
  });

  test("classes: week calendar, session panel and copy week preview", async ({
    page,
  }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      calls,
      callables: {
        listScheduleCatalog: catalog,
        listSessions: { sessions },
        listSessionBookedCounts: { counts: { s1: 2, s2: 3 } },
        listStaffProfiles: staffProfiles,
        listSessionBookings: { bookings: [] },
        listMemberNames: { members: [] },
        listMemberships: [],
        previewWeek: { preview: { count: 2, sample: [] } },
        copyWeek: { sessions },
      },
    });
    await page.clock.setFixedTime(new Date("2026-09-16T10:00:00Z"));
    await page.goto("/admin/classes-services/classes?adminTestRole=owner");

    await expect(page.getByText("14 – 20 SEP 2026")).toBeVisible();

    await page.getByRole("button", { name: /GI All Levels Evenings/ }).click();
    const sessionDialog = page.getByRole("dialog", { name: "Edit session" });
    await expect(sessionDialog).toBeVisible();
    // Registrations load on demand since the editor became responsive; every read they fire is
    // stubbed above, so this proves the panel rendered instead of a degraded fallback.
    await sessionDialog.getByRole("button", { name: "Registrations" }).click();
    await expect(sessionDialog.getByRole("heading", { name: "Registrations" })).toBeVisible();
    await expect(sessionDialog.getByText("Membership list unavailable")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(sessionDialog).toBeHidden();

    const listSessionsCallsBeforeCopy = calls.filter((c) => c.name === "listSessions").length;

    await page.getByRole("button", { name: "Copy week" }).click();
    const copyDialog = page.getByRole("dialog", { name: "Copy week" });
    await expect(
      copyDialog.getByText("2 classes will be copied to the week of 21 Sep 2026."),
    ).toBeVisible();

    await copyDialog.getByRole("button", { name: "Copy" }).click();
    await expect
      .poll(() => calls.find((c) => c.name === "copyWeek")?.body)
      .toMatchObject({
        data: { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false },
      });
    await expect(copyDialog).toBeHidden();
    // A successful copy reloads the week: the calendar re-asks listSessions rather than trusting
    // stale state.
    await expect
      .poll(() => calls.filter((c) => c.name === "listSessions").length)
      .toBeGreaterThan(listSessionsCallsBeforeCopy);

    await capture(page, testInfo, "cs-classes-week");

    await page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "List" }).click();
    // Header row plus the two seeded sessions, not just "a table exists".
    await expect(page.getByRole("row")).toHaveCount(3);
    await expect(page.getByRole("row", { name: /GI All Levels Evenings/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /No-Gi Fundamentals/ })).toBeVisible();
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
    // Read-only content, not an empty calendar: both seeded sessions still render for a coach.
    await expect(page.getByRole("button", { name: /GI All Levels Evenings/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /No-Gi Fundamentals/ })).toBeVisible();
  });
});
