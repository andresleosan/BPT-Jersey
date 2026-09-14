import { describe, expect, it } from "vitest";

import {
  isSelfCheckInWindowOpen,
  nextSelfCheckInSession,
  selfCheckInWindow,
  selfCheckInWindowLabels,
} from "./self-check-in-contracts";
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";

const audit = {
  schemaVersion: "1" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "t",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "t",
};
// 18:00–19:00 Jersey (BST) on 2026-09-15 = 17:00Z–18:00Z
const startAt = "2026-09-15T17:00:00.000Z";
const endAt = "2026-09-15T18:00:00.000Z";
const minute = 60_000;

function session(
  id: string,
  programId = "prog-teens",
  start = startAt,
  end = endAt,
): SessionRecord {
  return {
    sessionId: id,
    academyId: "bpt",
    classId: null,
    programId,
    locationId: "town",
    instructorId: "coach-1",
    title: "Teens BJJ",
    startAt: start,
    endAt: end,
    capacity: 20,
    minParticipants: 4,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    ...audit,
  };
}
function booking(sessionId: string, status: BookingRecord["status"] = "confirmed"): BookingRecord {
  return {
    bookingId: `bk_${sessionId}`,
    academyId: "bpt",
    sessionId,
    studentId: "sam",
    membershipId: "m",
    status,
    requestedAt: audit.createdAt,
    cancelledAt: null,
    cancellationReason: null,
    ...audit,
  };
}
function attendance(
  sessionId: string,
  method: AttendanceRecord["method"] = "manual",
): AttendanceRecord {
  return {
    attendanceId: `${sessionId}__sam`,
    academyId: "bpt",
    sessionId,
    studentId: "sam",
    method,
    state: "attended",
    occurredAt: startAt,
    notes: null,
    correctionOf: null,
    ...audit,
  };
}
const programs: ProgramRecord[] = [
  {
    programId: "prog-teens",
    academyId: "bpt",
    name: "Teens BJJ",
    ageBand: "teens",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "prog-om",
    academyId: "bpt",
    name: "Open Mat",
    ageBand: "all",
    discipline: "open-mat",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
];
const s = session("s1");
const startMs = Date.parse(startAt);

describe("selfCheckInWindow", () => {
  it("opens 60 minutes before and closes 20 minutes after the start", () => {
    expect(selfCheckInWindow(s, false)).toEqual({
      opensAtMs: startMs - 60 * minute,
      closesAtMs: startMs + 20 * minute,
    });
  });
  it("closes at endAt for an open mat (decision 20)", () => {
    expect(selfCheckInWindow(s, true).closesAtMs).toBe(Date.parse(endAt));
  });
  it("is open exactly at the edges and closed one second outside them", () => {
    expect(isSelfCheckInWindowOpen(s, false, startMs - 60 * minute)).toBe(true);
    expect(isSelfCheckInWindowOpen(s, false, startMs - 60 * minute - 1000)).toBe(false);
    expect(isSelfCheckInWindowOpen(s, false, startMs + 20 * minute)).toBe(true);
    expect(isSelfCheckInWindowOpen(s, false, startMs + 20 * minute + 1000)).toBe(false);
  });
  it("is closed for an invalid date", () => {
    expect(isSelfCheckInWindowOpen({ startAt: "nope", endAt }, false, startMs)).toBe(false);
  });
  it("labels the window in Jersey time", () => {
    expect(selfCheckInWindowLabels(s, false)).toEqual({ opens: "17:00", closes: "18:20" });
    expect(selfCheckInWindowLabels(s, true)).toEqual({ opens: "17:00", closes: "19:00" });
  });
});

describe("nextSelfCheckInSession", () => {
  const now = startMs - 30 * minute;
  it("returns nothing without a confirmed booking", () => {
    expect(
      nextSelfCheckInSession({ sessions: [s], programs, bookings: [], attendance: [], nowMs: now }),
    ).toBeUndefined();
    expect(
      nextSelfCheckInSession({
        sessions: [s],
        programs,
        bookings: [booking("s1", "requested")],
        attendance: [],
        nowMs: now,
      }),
    ).toBeUndefined();
    expect(
      nextSelfCheckInSession({
        sessions: [s],
        programs,
        bookings: [booking("s1", "cancelled")],
        attendance: [],
        nowMs: now,
      }),
    ).toBeUndefined();
  });
  it("returns nothing for a cancelled session or a closed window", () => {
    expect(
      nextSelfCheckInSession({
        sessions: [{ ...s, status: "cancelled" }],
        programs,
        bookings: [booking("s1")],
        attendance: [],
        nowMs: now,
      }),
    ).toBeUndefined();
    expect(
      nextSelfCheckInSession({
        sessions: [s],
        programs,
        bookings: [booking("s1")],
        attendance: [],
        nowMs: startMs - 61 * minute,
      }),
    ).toBeUndefined();
  });
  it("is ready with a confirmed booking inside the window", () => {
    expect(
      nextSelfCheckInSession({
        sessions: [s],
        programs,
        bookings: [booking("s1")],
        attendance: [],
        nowMs: now,
      }),
    ).toEqual({ kind: "ready", session: s });
  });
  it("is checkedIn when any attendance exists, whatever the method (decisions 6, 16)", () => {
    const coach = attendance("s1", "manual");
    expect(
      nextSelfCheckInSession({
        sessions: [s],
        programs,
        bookings: [booking("s1")],
        attendance: [coach],
        nowMs: now,
      }),
    ).toEqual({ kind: "checkedIn", session: s, attendance: coach });
  });
  it("picks the earliest open session when two overlap", () => {
    const later = session(
      "s2",
      "prog-teens",
      "2026-09-15T17:30:00.000Z",
      "2026-09-15T18:30:00.000Z",
    );
    const result = nextSelfCheckInSession({
      sessions: [later, s],
      programs,
      bookings: [booking("s1"), booking("s2")],
      attendance: [],
      nowMs: now,
    });
    expect(result?.session.sessionId).toBe("s1");
  });
  it("keeps an open mat open until it ends", () => {
    const om = session("om", "prog-om");
    expect(
      nextSelfCheckInSession({
        sessions: [om],
        programs,
        bookings: [booking("om")],
        attendance: [],
        nowMs: startMs + 45 * minute,
      })?.kind,
    ).toBe("ready");
    expect(
      nextSelfCheckInSession({
        sessions: [s],
        programs,
        bookings: [booking("s1")],
        attendance: [],
        nowMs: startMs + 45 * minute,
      }),
    ).toBeUndefined();
  });
});
