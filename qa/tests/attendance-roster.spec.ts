import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";

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

const view = (pendingStatus: string) => ({
  session,
  attendees: [
    attendee("s-ready", "Ana Ready", "attended"),
    attendee("s-booked", "Ben Booked", pendingStatus),
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
  roster: [],
};

test.describe("attendance roster", () => {
  test("turns a booked member red at the start time and green after a clock-in", async ({
    page,
  }) => {
    let pendingStatus = "booked_not_arrived";
    const calls: CallableCall[] = [];
    await page.clock.install({ time: new Date("2026-09-12T17:58:00.000Z") });
    await installAdminFixture(page, {
      role: "coach",
      calls,
      callables: {
        listSessions: { sessions: [session] },
        getSessionOperationalView: { view: operational },
        getPreClassView: () => ({ view: view(pendingStatus) }),
        checkIn: () => {
          pendingStatus = "late";
          return {
            attendance: {
              attendanceId: "session-1__s-booked",
              academyId: "synthetic-academy",
              sessionId: "session-1",
              studentId: "s-booked",
              method: "manual",
              state: "late",
              occurredAt: "2026-09-12T18:01:00.000Z",
              notes: null,
              correctionOf: null,
              schemaVersion: "1",
              createdAt: "2026-09-12T18:01:00.000Z",
              createdBy: "u",
              updatedAt: "2026-09-12T18:01:00.000Z",
              updatedBy: "u",
            },
          };
        },
      },
    });
    await page.goto("/admin/attendance?adminTestRole=coach");

    await expect(page.getByRole("heading", { name: "Adults Gi · Coach coach-miro" })).toBeVisible();
    const row = page
      .getByRole("list", { name: "Adults Gi roster" })
      .getByRole("listitem")
      .filter({ hasText: "Ben Booked" });
    await expect(row.locator(".attendance-tag")).toHaveText("Booked");

    // The roster re-reads and re-reads the clock every thirty seconds; three minutes takes the
    // page past the 18:00 start.
    await page.clock.runFor(3 * 60_000);
    await expect(row.locator(".attendance-tag")).toHaveText("Late");

    await row.getByRole("button", { name: "Clock in Ben Booked" }).click();
    await expect(row.locator(".attendance-tag")).toHaveText("Ready");
    const checkIn = calls.find((call) => call.name === "checkIn");
    expect(checkIn?.body).toEqual({
      data: { sessionId: "session-1", studentId: "s-booked", method: "manual" },
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Clock-in recorded for Ben Booked." }),
    ).toBeVisible();
  });
});
