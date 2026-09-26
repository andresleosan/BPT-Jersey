import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

// The admin week on a desktop screen: seven days share the width (no sideways scroll) and a
// one-hour card shows its title, time and occupancy inside its own box, also when two share an hour.
const location = {
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

const names = [
  "NoGI All Levels Morning",
  "GI All Levels Morning",
  "GI Beginners Morning",
  "Open Mat",
];
const programs = names.map((name, index) => ({
  programId: `p${index}`,
  academyId: "bpt-jersey",
  name,
  ageBand: "adult" as const,
  discipline: "bjj" as const,
  level: "all-levels" as const,
  active: true,
  schemaVersion: "1" as const,
  abbreviation: `P${index}`,
  colour: ["#FDEBC8", "#D6F5F5", "#E6DDFB", "#FBD5E0"][index]!,
  kind: "class-frequency" as const,
  dropInPolicy: "unlimited" as const,
  notifyByEmail: false,
  showInList: true,
  message: "",
}));

// [day of the week from Monday 21 September 2026, local start hour, class name]
const rows: [number, number, string][] = [
  [0, 6, "NoGI All Levels Morning"],
  [0, 7, "GI All Levels Morning"],
  [0, 7, "GI Beginners Morning"],
  [2, 7, "GI All Levels Morning"],
  [2, 7, "GI Beginners Morning"],
  [5, 12, "Open Mat"],
  [6, 10, "Open Mat"],
];

const sessions = rows.map(([day, hour, name], index) => ({
  sessionId: `s${index}`,
  academyId: "bpt-jersey",
  classId: null,
  programId: programs.find((program) => program.name === name)!.programId,
  locationId: "loc-town",
  instructorId: "staff-1",
  instructorIds: ["staff-1"],
  title: name,
  // Jersey is on UTC+1 in September.
  startAt: new Date(Date.UTC(2026, 8, 21 + day, hour - 1)).toISOString(),
  endAt: new Date(Date.UTC(2026, 8, 21 + day, hour)).toISOString(),
  capacity: 20,
  minParticipants: 1,
  status: "scheduled" as const,
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "staff-1",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "staff-1",
  bookingRules: "defined" as const,
  waitingList: "general" as const,
}));

for (const width of [1280, 1440]) {
  test(`admin week fits seven days at ${width}px without clipping cards`, async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "Desktop layout only.");
    await page.setViewportSize({ width, height: 900 });
    await installAdminFixture(page, {
      callables: {
        listScheduleCatalog: { locations: [location], programs },
        listSessions: { sessions },
        listSessionBookedCounts: { counts: {} },
        listStaffProfiles: [],
      },
    });
    await page.clock.setFixedTime(new Date("2026-09-23T09:00:00Z"));
    await page.goto("/admin/classes-services/classes?adminTestRole=owner");
    await expect(page.getByText("21 – 27 SEP 2026")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Open Mat/ })).toHaveCount(2);

    const week = page.locator(".cs-week");
    const { scrollWidth, clientWidth } = await week.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await expect(page.getByText("SUN 27/9")).toBeInViewport();

    // Every card's title, time and chip sit inside the card box (no top or bottom clipping).
    const overflows = await page.locator(".cs-day-grid .cs-event").evaluateAll((cards) =>
      cards.flatMap((card) => {
        const box = card.getBoundingClientRect();
        return [...card.children]
          .filter((part) => {
            const inner = part.getBoundingClientRect();
            return inner.top < box.top || inner.bottom > box.bottom + 0.5 || inner.width < 20;
          })
          .map((part) => `${card.getAttribute("title")}: ${part.className}`);
      }),
    );
    expect(overflows).toEqual([]);
    expect(await page.locator(".cs-day-grid .cs-event").count()).toBe(rows.length);
  });
}
