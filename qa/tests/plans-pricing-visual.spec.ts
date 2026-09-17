import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

/**
 * T050V2 visual evidence: public prices from the catalogue, the required session capacity and the
 * plan drift notice, captured at 1440 px (desktop project) and 390 px (`-phone`, mobile project).
 *
 * The admin and home captures run against the `NEXT_PUBLIC_ADMIN_E2E` static build. `/enrol` needs
 * a signed-in client, so it only runs against an emulator build with `AUTH_EMULATOR_E2E=true` and
 * the Auth Emulator on `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT`.
 */
const authEmulator = process.env.AUTH_EMULATOR_E2E === "true";

async function sizeFor(page: Page, testInfo: TestInfo): Promise<string> {
  const phone = testInfo.project.name === "mobile-chromium";
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  return phone ? "-phone" : "";
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fullPage = true,
): Promise<void> {
  const suffix = await sizeFor(page, testInfo);
  await page.screenshot({
    path: `screenshots/${name}${suffix}.png`,
    fullPage,
    style: ".skip-link { display: none !important; }",
  });
}

const session = {
  sessionId: "s1",
  academyId: "bpt-jersey",
  classId: null,
  programId: "prog-open-mat",
  locationId: "loc-town",
  instructorId: "staff-synthetic-1",
  instructorIds: ["staff-synthetic-1"],
  title: "Open Mat",
  startAt: "2026-09-16T18:00:00.000Z",
  endAt: "2026-09-16T19:00:00.000Z",
  capacity: null,
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

const catalog = {
  locations: [
    {
      locationId: "loc-town",
      academyId: "bpt-jersey",
      name: "BPT Town",
      address: "St Helier",
      timezone: "Europe/Jersey",
      active: true,
      abbreviation: "town",
      kind: "presential" as const,
      schemaVersion: "1" as const,
    },
  ],
  programs: [
    {
      programId: "prog-open-mat",
      academyId: "bpt-jersey",
      name: "Open Mat",
      ageBand: "adult" as const,
      discipline: "bjj" as const,
      level: "all-levels" as const,
      active: true,
      schemaVersion: "1" as const,
      abbreviation: "OM",
      colour: "#4C6FFF",
      kind: "class-unlimited" as const,
      dropInPolicy: "unlimited" as const,
      notifyByEmail: false,
      showInList: true,
      message: "",
    },
  ],
};

const townAdult = {
  planId: "town-adult",
  displayName: "Town Adult",
  priceMinor: 8_500,
  currency: "GBP",
  billingPeriod: "monthly",
  eligibleParticipantTypes: ["adult"],
  classSites: ["Town"],
  weeklyClassLimit: null,
  openMatSites: ["Town"],
  openMatFeeMinor: null,
  active: true,
};

// Stored before T050V2: no weekly limit, so it differs from the catalogue's 2 classes a week.
const staleWestAdult = {
  ...townAdult,
  planId: "west-adult",
  displayName: "West Adult",
  priceMinor: 6_500,
  classSites: ["West"],
};

test.describe("@t050-visual", () => {
  test("home fees read the catalogue", async ({ page }, testInfo) => {
    test.skip(authEmulator, "Runs against the admin E2E build.");
    await page.goto("/");
    const fees = page.locator("#fees");
    await expect(fees.getByText("£135 per term", { exact: true })).toBeVisible();
    await expect(fees.getByText("Town Teens", { exact: true })).toHaveCount(0);
    const suffix = await sizeFor(page, testInfo);
    await fees.screenshot({
      path: `screenshots/t050-home-fees${suffix}.png`,
      style: ".skip-link { display: none !important; }",
    });
  });

  test("session panel asks for a capacity", async ({ page }, testInfo) => {
    test.skip(authEmulator, "Runs against the admin E2E build.");
    await installAdminFixture(page, {
      callables: {
        listScheduleCatalog: catalog,
        listSessions: { sessions: [session] },
        listSessionBookedCounts: { counts: { s1: 0 } },
        listStaffProfiles: [
          {
            staffKey: "staff-synthetic-1",
            role: "coach",
            active: true,
            status: "active",
            self: false,
            schemaVersion: "1",
          },
        ],
        listSessionBookings: { bookings: [] },
        listMemberNames: { members: [] },
        listMemberships: [],
      },
    });
    await page.clock.setFixedTime(new Date("2026-09-16T10:00:00Z"));
    await page.goto("/admin/classes-services/classes?adminTestRole=owner");

    await page.getByRole("button", { name: /Open Mat/ }).click();
    const dialog = page.getByRole("dialog", { name: /Create classes\/services/i });
    await expect(dialog.getByText("Enter a capacity between 1 and 300")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Edit" })).toBeDisabled();

    // The panel is a fixed modal: `fullPage` stitching clips it on a phone, so capture the viewport
    // with the error scrolled into view.
    await sizeFor(page, testInfo);
    await dialog.getByText("Enter a capacity between 1 and 300").scrollIntoViewIfNeeded();
    await capture(page, testInfo, "t050-admin-session-capacity", false);
  });

  test("plan editor flags a plan that differs from the catalogue", async ({ page }, testInfo) => {
    test.skip(authEmulator, "Runs against the admin E2E build.");
    await installAdminFixture(page, {
      callables: {
        listManagedPlans: [townAdult, staleWestAdult],
        listMemberships: [],
        listMembers: { rows: [] },
      },
    });
    await page.goto("/admin/memberships?adminTestRole=owner");

    await page.getByLabel("Plan to edit").selectOption("west-adult");
    await expect(page.getByText("Differs from catalogue")).toBeVisible();

    await capture(page, testInfo, "t050-admin-plan-drift");
  });

  test("enrol shows the plans for the chosen site", async ({ page, request }, testInfo) => {
    test.skip(!authEmulator, "Needs a signed-in client from the Auth Emulator build.");
    const authPort = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT ?? "9099";
    const auth = `http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1`;
    const email = `t050-${testInfo.project.name}-${Date.now()}@example.test`;
    const password = "Synthetic-t050-Pass!";
    const signUp = await request.post(`${auth}/accounts:signUp?key=fake-key`, {
      data: { email, password, returnSecureToken: true },
    });
    expect(signUp.ok()).toBe(true);
    const { localId } = (await signUp.json()) as { localId: string };
    const claims = await request.post(`${auth}/projects/demo-bpt-jersey/accounts:update`, {
      headers: { Authorization: "Bearer owner" },
      data: { localId, customAttributes: JSON.stringify({ role: "shopper" }) },
    });
    expect(claims.ok()).toBe(true);

    await page.goto("/login?returnTo=%2Fenrol");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/enrol/u);
    await expect(page.getByRole("heading", { name: /Plans at/ })).toBeVisible();
    await expect(page.getByText("Town Teens", { exact: true })).toHaveCount(0);

    await capture(page, testInfo, "t050-enrol-plans");
  });
});
