import { describe, expect, it } from "vitest";
import type { TrialAccessRecord } from "@bpt-jersey/domain";
import type { BookingRecord } from "@bpt-jersey/domain/schedule";
import { futureIntroBookingCount, readTrialAccess, trialView, type TrialReader } from "./trial-access-service.js";

const academyId = "academy-1";
const studentId = "student-1";
const now = "2026-09-21T12:00:00.000Z";

function trial(overrides: Partial<TrialAccessRecord> = {}): TrialAccessRecord {
  return {
    trialId: "trial-1",
    academyId,
    studentId,
    site: "Town",
    experience: "beginner",
    allowance: 2,
    countedAttendanceIds: [],
    status: "active",
    startsAt: now,
    expiresAt: "2026-10-21T12:00:00.000Z",
    enrolmentRequestId: "req-1",
    createdAt: now,
    updatedAt: now,
    schemaVersion: "1",
    ...overrides,
  };
}

function fakeReader(docs: Record<string, unknown>): TrialReader {
  return {
    async get(path: string) {
      const value = docs[path];
      return { exists: value !== undefined, data: () => value };
    },
  };
}

function booking(overrides: Partial<BookingRecord> = {}): BookingRecord {
  return {
    bookingId: "booking-1",
    academyId,
    sessionId: "session-1",
    studentId,
    membershipId: null,
    source: { kind: "intro" },
    status: "confirmed",
    requestedAt: now,
    cancelledAt: null,
    cancellationReason: null,
    schemaVersion: "3",
    createdAt: now,
    createdBy: "seed",
    updatedAt: now,
    updatedBy: "seed",
    ...overrides,
  } as BookingRecord;
}

describe("readTrialAccess", () => {
  it("returns undefined when the doc is missing", async () => {
    const reader = fakeReader({});
    await expect(readTrialAccess(reader, academyId, studentId)).resolves.toBeUndefined();
  });

  it("returns undefined when the doc belongs to another academy", async () => {
    const reader = fakeReader({
      [`academies/${academyId}/trialAccess/${studentId}`]: trial({ academyId: "other-academy" }),
    });
    await expect(readTrialAccess(reader, academyId, studentId)).resolves.toBeUndefined();
  });

  it("returns undefined when the doc belongs to another student", async () => {
    const reader = fakeReader({
      [`academies/${academyId}/trialAccess/${studentId}`]: trial({ studentId: "other-student" }),
    });
    await expect(readTrialAccess(reader, academyId, studentId)).resolves.toBeUndefined();
  });

  it("returns undefined when the doc fails schema validation", async () => {
    const reader = fakeReader({
      [`academies/${academyId}/trialAccess/${studentId}`]: { junk: true },
    });
    await expect(readTrialAccess(reader, academyId, studentId)).resolves.toBeUndefined();
  });

  it("returns the record when valid and scoped correctly", async () => {
    const record = trial();
    const reader = fakeReader({
      [`academies/${academyId}/trialAccess/${studentId}`]: record,
    });
    await expect(readTrialAccess(reader, academyId, studentId)).resolves.toEqual(record);
  });
});

describe("trialView", () => {
  it("projects a trial into its view at a point in time", () => {
    const record = trial({ countedAttendanceIds: ["a1"] });
    expect(trialView(record, 3, now)).toEqual({
      site: "Town",
      allowance: 2,
      attendedCount: 1,
      futureBookings: 3,
      expiresAt: record.expiresAt,
      status: "active",
    });
  });
});

describe("futureIntroBookingCount", () => {
  const sessions = new Map([["session-1", { startAt: "2026-10-01T12:00:00.000Z" }]]);

  it("counts a confirmed future intro booking", () => {
    expect(futureIntroBookingCount([booking()], sessions, new Set(), now)).toBe(1);
  });

  it("ignores cancelled bookings", () => {
    expect(
      futureIntroBookingCount([booking({ status: "cancelled" })], sessions, new Set(), now),
    ).toBe(0);
  });

  it("ignores attended sessions", () => {
    expect(
      futureIntroBookingCount([booking()], sessions, new Set(["session-1"]), now),
    ).toBe(0);
  });

  it("ignores past sessions", () => {
    const pastSessions = new Map([["session-1", { startAt: "2026-01-01T12:00:00.000Z" }]]);
    expect(futureIntroBookingCount([booking()], pastSessions, new Set(), now)).toBe(0);
  });

  it("ignores non-intro bookings", () => {
    const courseBooking = booking({
      schemaVersion: "2",
      source: { kind: "course", courseId: "course-1", enrolmentId: "enrol-1" },
      absent: false,
    } as Partial<BookingRecord>);
    expect(futureIntroBookingCount([courseBooking], sessions, new Set(), now)).toBe(0);
  });

  it("ignores bookings whose session is missing from the map", () => {
    expect(futureIntroBookingCount([booking({ sessionId: "unknown" })], sessions, new Set(), now)).toBe(0);
  });
});
