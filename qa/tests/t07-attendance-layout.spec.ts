import { expect, test, type Page } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

const session = {
  sessionId: "session-1",
  academyId: "synthetic-academy",
  classId: "class-1",
  programId: "program-1",
  locationId: "town",
  instructorId: "coach-miro",
  title: "Adults Gi",
  startAt: "2026-09-12T18:00:00.000Z",
  endAt: "2026-09-12T19:00:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-01T10:00:00.000Z",
  updatedBy: "admin-1",
};

const attendee = (studentId: string, displayName: string, status: string | null) => ({
  studentId,
  displayName,
  source: "booked",
  status,
  attendedCount: 0,
  comparableSessionCount: 0,
  lastAttendedAt: null,
});

const booking = (studentId: string) => ({
  bookingId: `booking-${studentId}`,
  academyId: "synthetic-academy",
  sessionId: "session-1",
  studentId,
  membershipId: `membership-${studentId}`,
  status: "confirmed",
  requestedAt: "2026-09-11T12:00:00.000Z",
  cancelledAt: null,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-11T12:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-11T12:00:00.000Z",
  updatedBy: "admin-1",
});

const operational = {
  session,
  summary: {
    capacity: 20,
    minParticipants: 4,
    quorumMet: false,
    totalBookings: 2,
    totalCheckedIn: 1,
    totalCheckedOut: 0,
    totalNoShows: 0,
    totalPendingArrival: 1,
  },
  roster: [
    {
      studentId: "student-with-a-rather-long-identifier-pending",
      booking: booking("student-with-a-rather-long-identifier-pending"),
      attendance: null,
      checkout: null,
      computedStatus: "booked_not_arrived",
    },
    {
      studentId: "student-attended",
      booking: booking("student-attended"),
      attendance: {
        attendanceId: "session-1__student-attended",
        academyId: "synthetic-academy",
        sessionId: "session-1",
        studentId: "student-attended",
        method: "manual",
        state: "attended",
        occurredAt: "2026-09-12T17:58:00.000Z",
        notes: null,
        correctionOf: null,
        schemaVersion: "1",
        createdAt: "2026-09-12T17:58:00.000Z",
        createdBy: "admin-1",
        updatedAt: "2026-09-12T17:58:00.000Z",
        updatedBy: "admin-1",
      },
      checkout: null,
      computedStatus: "attended",
    },
  ],
  unbookedCheckIns: [],
  refreshedAt: "2026-09-12T17:58:00.000Z",
};

const preClass = {
  session,
  attendees: [
    attendee("student-attended", "Ana Ready", "attended"),
    attendee("student-with-a-rather-long-identifier-pending", "Bartholomew Booked", null),
  ],
  evidence: {
    open: true,
    windowDays: 56,
    minAttendances: 2,
    bookedCount: 2,
    suggestedCount: 0,
    comparableSessionCount: 0,
  },
  refreshedAt: "2026-09-12T17:58:00.000Z",
};

async function expectFitsViewport(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // The admin shell (header, navigation) is outside this task; only the attendance surface is
  // held to the 44 px target here.
  for (const button of await page.locator(".attendance-page").getByRole("button").all()) {
    const box = await button.boundingBox();
    if (box) expect(box.height, await button.innerText()).toBeGreaterThanOrEqual(44);
  }
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`attendance has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-12T17:58:00.000Z") });
    await installAdminFixture(page, {
      role: "coach",
      callables: {
        listSessions: { sessions: [session] },
        getSessionOperationalView: { view: operational },
        getPreClassView: { view: preClass },
      },
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/attendance?adminTestRole=coach");
    await expect(page.getByRole("heading", { name: "Adults Gi · Coach coach-miro" })).toBeVisible();

    await expectFitsViewport(page);

    await page.getByText("Corrections and closeout").click();
    await expect(page.getByRole("table", { name: "Attendance roster" })).toBeVisible();
    await expectFitsViewport(page);
  });
}
