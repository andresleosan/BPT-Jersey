import { expect, test, type Locator, type Page, type Route, type TestInfo } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";
import { blockExternalRequests } from "./network-guard";

/**
 * 2026-10-20 diagnosis, item 2. The Registrations panel read the academy-wide membership list
 * (cut at 100 of 122), matched ids exactly and always booked as "membership". It now asks the
 * server per student (getRegistrationChoice) and books with what it answers; the booking callable
 * (requestBookingEu) still decides. Real Classes page and panel, synthetic callables only: browser
 * UI coverage with a mocked backend, not backend integration.
 */
const session = {
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
  capacity: 20,
  minParticipants: 1,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "staff-synthetic-1",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "staff-synthetic-1",
  bookingRules: "defined",
  waitingList: "general",
};
const location = {
  locationId: "loc-town",
  academyId: "bpt-jersey",
  name: "BPT Town",
  address: "St Helier",
  timezone: "Europe/Jersey",
  active: true,
  abbreviation: "town",
  kind: "presential",
  schemaVersion: "1",
};
const program = {
  programId: "prog-gi",
  academyId: "bpt-jersey",
  name: "GI All Levels Evenings",
  ageBand: "adult",
  discipline: "bjj",
  level: "all-levels",
  active: true,
  schemaVersion: "1",
  abbreviation: "GI",
  colour: "#4C6FFF",
  kind: "class-frequency",
  dropInPolicy: "unlimited",
  notifyByEmail: false,
  showInList: true,
  message: "",
};

// Synthetic directory rows; studentId is what the panel books with.
const members = [
  { studentId: "st101", fullName: "Rowan Late", familyId: null },
  { studentId: "st-new", fullName: "Alias Member", familyId: null },
  { studentId: "st5", fullName: "Tia Trial", familyId: null },
  { studentId: "st6", fullName: "Exie Expired", familyId: null },
  { studentId: "st7", fullName: "Tom Trialover", familyId: null },
  { studentId: "st8", fullName: "Fay Full", familyId: null },
  { studentId: "st9", fullName: "Dee Double", familyId: null },
];
const book = (membershipId: string, studentId: string) => ({
  studentId,
  choice: { kind: "membership", membershipId },
  reason: null,
});
const refuse = (reason: string, studentId: string) => ({ studentId, choice: null, reason });
// What the server would answer per directory id (all synthetic).
const choices: Record<string, unknown> = {
  st101: book("m101", "st101"), // past the academy-wide list's first 100
  "st-new": book("m-old", "st-canonical"), // held under an earlier id of the same member
  st5: { studentId: "st5", choice: { kind: "intro" }, reason: null }, // Free Trial only
  st6: refuse("plan-dates", "st6"),
  st7: refuse("trial-unavailable", "st7"),
  st8: book("m8", "st8"), // the booking transaction refuses this one
  st9: book("m9", "st9"),
};

type Harness = Readonly<{
  calls: CallableCall[];
  blocked: string[];
  dialog: Locator;
}>;

const named = (calls: CallableCall[], name: string) =>
  calls.filter((call) => call.name === name).map((call) => (call.body as { data: unknown }).data);

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Opens Registrations on the real Classes page; `failChoiceOnce` makes the first check a 500. */
async function openRegistrations(
  page: Page,
  options: Readonly<{ failChoiceOnce?: boolean }> = {},
): Promise<Harness> {
  const calls: CallableCall[] = [];
  const bookings: Record<string, unknown>[] = [];
  let choiceFailures = options.failChoiceOnce ? 1 : 0;
  const callables = {
    listScheduleCatalog: { locations: [location], programs: [program] },
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
    listSessionBookings: () => ({ bookings: [...bookings] }),
    listMemberNames: { members },
    // The old academy-wide read: 100 other members. The panel must never ask for it again.
    listMemberships: Array.from({ length: 100 }, (_, index) => ({
      membershipId: `m${index}`,
      familyId: `f${index}`,
      studentId: `other-${index}`,
      planId: "bpt-jersey-adult",
      status: "active",
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: null,
      nextBillingAt: null,
    })),
    getRegistrationChoice: null,
    requestBookingEu: null,
  };
  await installAdminFixture(page, { calls, callables });
  await page.route("**/getRegistrationChoice", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { data: { studentId: string } };
    calls.push({ name: "getRegistrationChoice", body });
    if (choiceFailures > 0) {
      choiceFailures -= 1;
      return json(route, 500, { error: { status: "INTERNAL", message: "INTERNAL" } });
    }
    return json(route, 200, { data: choices[body.data.studentId] });
  });
  await page.route("**/requestBookingEu", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { data: { studentId: string; kind: string } };
    calls.push({ name: "requestBookingEu", body });
    if (body.data.studentId === "st8") {
      // The transaction has the last word: the panel shows its refusal and books nothing.
      return json(route, 400, {
        error: { status: "FAILED_PRECONDITION", message: "Booking is not available" },
      });
    }
    const member = members.find((row) => row.studentId === body.data.studentId);
    const booking = {
      bookingId: `b-${body.data.studentId}`,
      sessionId: "s1",
      studentId: body.data.studentId,
      status: "confirmed",
      displayName: member?.fullName ?? null,
      paymentLabel: body.data.kind === "intro" ? "Intro" : "Subscription",
    };
    bookings.push(booking);
    return json(route, 200, { data: { booking } });
  });
  const blocked = await blockExternalRequests(page, Object.keys(callables));

  await page.clock.setFixedTime(new Date("2026-09-16T10:00:00Z"));
  await page.goto("/admin/classes-services/classes?adminTestRole=owner", { timeout: 120_000 });
  await page
    .getByRole("button", { name: /GI All Levels Evenings/ })
    .first()
    .click({ timeout: 60_000 });
  const dialog = page.getByRole("dialog", { name: "Edit session" });
  await dialog.getByRole("button", { name: "Registrations" }).click();
  await expect(dialog.getByRole("heading", { name: "Registrations" })).toBeVisible();
  await expect(dialog.getByText("No one is registered yet.")).toBeVisible();
  return { calls, blocked, dialog };
}

async function search(dialog: Locator, text: string): Promise<void> {
  await dialog.getByRole("searchbox", { name: "Enrol a member of this gym" }).fill(text);
}

async function evidence(page: Page, testInfo: TestInfo, name: string, h: Harness) {
  await page.screenshot({
    path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await testInfo.attach(`${name}-blocked-requests`, {
    body: JSON.stringify(h.blocked, null, 2),
    contentType: "application/json",
  });
}

test.describe("Registrations: per-student registration choice (2026-10-20 item 2)", () => {
  test.skip(process.env.NEXT_PUBLIC_ADMIN_E2E !== "true", "needs the admin E2E build");
  test.setTimeout(180_000);

  test("books past the first hundred, an earlier-id membership and a Free Trial intro", async ({
    page,
  }, testInfo) => {
    const h = await openRegistrations(page);

    for (const name of ["Rowan Late", "Alias Member", "Tia Trial"]) {
      await search(h.dialog, name.slice(0, 3));
      await h.dialog.getByRole("button", { name, exact: true }).click();
      await expect(h.dialog.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
    }

    expect(named(h.calls, "getRegistrationChoice")).toEqual([
      { sessionId: "s1", studentId: "st101" },
      { sessionId: "s1", studentId: "st-new" },
      { sessionId: "s1", studentId: "st5" },
    ]);
    expect(named(h.calls, "requestBookingEu")).toEqual([
      { kind: "membership", sessionId: "s1", studentId: "st101", membershipId: "m101" },
      { kind: "membership", sessionId: "s1", studentId: "st-new", membershipId: "m-old" },
      { kind: "intro", sessionId: "s1", studentId: "st5" },
    ]);
    expect(named(h.calls, "listMemberships")).toEqual([]);
    await evidence(page, testInfo, "registrations-booked", h);
  });

  test("shows the server's refusals and books nothing the transaction turns down", async ({
    page,
  }, testInfo) => {
    const h = await openRegistrations(page);
    const refusal = (text: string) => h.dialog.getByRole("alert").filter({ hasText: text });

    await search(h.dialog, "Exi");
    await h.dialog.getByRole("button", { name: "Exie Expired", exact: true }).click();
    await expect(
      refusal("This class is outside the member's paid membership period"),
    ).toBeVisible();

    await search(h.dialog, "Tom");
    await h.dialog.getByRole("button", { name: "Tom Trialover", exact: true }).click();
    await expect(
      refusal("This member's Free Trial is used up, has ended or is for the other centre"),
    ).toBeVisible();

    await search(h.dialog, "Fay");
    await h.dialog.getByRole("button", { name: "Fay Full", exact: true }).click();
    await expect(refusal("Booking is not available")).toBeVisible();
    await expect(h.dialog.getByText("No one is registered yet.")).toBeVisible();

    // Only the member whose plan covers the class reached the booking transaction.
    expect(named(h.calls, "requestBookingEu")).toEqual([
      { kind: "membership", sessionId: "s1", studentId: "st8", membershipId: "m8" },
    ]);
    await evidence(page, testInfo, "registrations-refusals", h);
  });

  test("retries a failed check, ignores a cancelled search and never books twice", async ({
    page,
  }, testInfo) => {
    const h = await openRegistrations(page, { failChoiceOnce: true });

    // Cancel: searching and clearing asks the server nothing.
    await search(h.dialog, "Ro");
    await expect(h.dialog.getByRole("button", { name: "Rowan Late", exact: true })).toBeVisible();
    await search(h.dialog, "");
    expect(named(h.calls, "getRegistrationChoice")).toEqual([]);

    // Error then retry: the failed check names itself and blames nobody.
    await search(h.dialog, "Ro");
    await h.dialog.getByRole("button", { name: "Rowan Late", exact: true }).click();
    await expect(
      h.dialog
        .getByRole("alert")
        .filter({ hasText: "Unable to check this member's membership. Please try again." }),
    ).toBeVisible();
    await expect(h.dialog.getByText("No active membership")).toHaveCount(0);
    await evidence(page, testInfo, "registrations-check-failed", h);
    await h.dialog.getByRole("button", { name: "Rowan Late", exact: true }).click();
    await expect(h.dialog.getByRole("button", { name: "Remove Rowan Late" })).toBeVisible();

    // Repeated click: the controls lock while a booking is in flight, so one booking.
    await search(h.dialog, "Dee");
    await h.dialog.getByRole("button", { name: "Dee Double", exact: true }).dblclick();
    await expect(h.dialog.getByRole("button", { name: "Remove Dee Double" })).toBeVisible();
    const checksForDee = named(h.calls, "getRegistrationChoice").filter(
      (data) => (data as { studentId: string }).studentId === "st9",
    );
    expect(checksForDee).toHaveLength(1);
    expect(named(h.calls, "requestBookingEu")).toEqual([
      { kind: "membership", sessionId: "s1", studentId: "st101", membershipId: "m101" },
      { kind: "membership", sessionId: "s1", studentId: "st9", membershipId: "m9" },
    ]);
    await evidence(page, testInfo, "registrations-retry-and-double-click", h);
  });
});
