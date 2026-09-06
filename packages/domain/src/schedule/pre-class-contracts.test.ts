import { describe, expect, it } from "vitest";

import {
  buildPreClassView,
  isComparablePreClassSession,
  isPreClassSessionOpen,
  parsePreClassViewQuery,
  preClassMaxSuggestions,
  type PreClassAttendanceEntry,
  type PreClassStudent,
} from "./pre-class-contracts";
import type { AttendanceRecord, BookingRecord, SessionRecord } from "./schedule-contracts";

const academyId = "academy-1";
// A Tuesday, 18:00 UTC.
const now = "2026-09-08T17:00:00.000Z";

function session(overrides: Partial<SessionRecord> & { sessionId: string }): SessionRecord {
  return Object.freeze({
    academyId,
    classId: null,
    programId: "adults-bjj",
    locationId: "town",
    instructorId: "coach-1",
    title: "Adults Gi",
    startAt: "2026-09-08T18:00:00.000Z",
    endAt: "2026-09-08T19:00:00.000Z",
    capacity: 20,
    minParticipants: 4,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  }) as SessionRecord;
}

function booking(
  studentId: string,
  status: BookingRecord["status"] = "confirmed",
  sessionId = "target",
): BookingRecord {
  return Object.freeze({
    bookingId: `${sessionId}__${studentId}`,
    academyId,
    sessionId,
    studentId,
    membershipId: `membership-${studentId}`,
    status,
    requestedAt: "2026-09-07T10:00:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-09-07T10:00:00.000Z",
    createdBy: studentId,
    updatedAt: "2026-09-07T10:00:00.000Z",
    updatedBy: studentId,
  }) as unknown as BookingRecord;
}

function attendance(
  studentId: string,
  state: string,
  sessionId = "target",
  occurredAt = "2026-09-08T18:05:00.000Z",
): AttendanceRecord {
  return Object.freeze({
    attendanceId: `${sessionId}__${studentId}`,
    academyId,
    sessionId,
    studentId,
    method: "manual",
    state,
    occurredAt,
    notes: null,
    correctionOf: null,
    schemaVersion: "1",
    createdAt: occurredAt,
    createdBy: "coach-1",
    updatedAt: occurredAt,
    updatedBy: "coach-1",
  }) as unknown as AttendanceRecord;
}

function historyEntry(
  studentId: string,
  sessionId: string,
  occurredAt: string,
  state = "attended",
): PreClassAttendanceEntry {
  return Object.freeze({ sessionId, studentId, state, occurredAt, correctionOf: null });
}

function student(studentId: string, fullName: string): PreClassStudent {
  return Object.freeze({ studentId, fullName, active: true, status: "active" });
}

const target = session({ sessionId: "target" });
// Three Tuesdays before the target, same programme, same site, same slot.
const pastSessions = [
  session({
    sessionId: "past-1",
    startAt: "2026-09-01T18:00:00.000Z",
    endAt: "2026-09-01T19:00:00.000Z",
  }),
  session({
    sessionId: "past-2",
    startAt: "2026-08-25T18:00:00.000Z",
    endAt: "2026-08-25T19:00:00.000Z",
  }),
  session({
    sessionId: "past-3",
    startAt: "2026-08-18T18:15:00.000Z",
    endAt: "2026-08-18T19:15:00.000Z",
  }),
];

describe("isComparablePreClassSession (T114)", () => {
  it("accepts the same class on an earlier week, give or take half an hour", () => {
    for (const candidate of pastSessions) {
      expect(isComparablePreClassSession(target, candidate, { now }), candidate.sessionId).toBe(
        true,
      );
    }
  });

  it("rejects another programme, another site and another weekday", () => {
    expect(
      isComparablePreClassSession(
        target,
        session({ sessionId: "p", programId: "kids-bjj", startAt: "2026-09-01T18:00:00.000Z" }),
        { now },
      ),
    ).toBe(false);
    expect(
      isComparablePreClassSession(
        target,
        session({ sessionId: "p", locationId: "west", startAt: "2026-09-01T18:00:00.000Z" }),
        { now },
      ),
    ).toBe(false);
    // A Wednesday is a different class even at the same hour.
    expect(
      isComparablePreClassSession(
        target,
        session({ sessionId: "p", startAt: "2026-09-02T18:00:00.000Z" }),
        { now },
      ),
    ).toBe(false);
  });

  it("rejects a slot outside the tolerance, a cancelled session and the session itself", () => {
    expect(
      isComparablePreClassSession(
        target,
        session({ sessionId: "p", startAt: "2026-09-01T19:00:00.000Z" }),
        { now },
      ),
    ).toBe(false);
    expect(
      isComparablePreClassSession(
        target,
        session({ sessionId: "p", startAt: "2026-09-01T18:00:00.000Z", status: "cancelled" }),
        { now },
      ),
    ).toBe(false);
    expect(isComparablePreClassSession(target, target, { now })).toBe(false);
  });

  it("rejects anything outside the window, including the future", () => {
    expect(
      isComparablePreClassSession(
        target,
        session({ sessionId: "p", startAt: "2026-01-06T18:00:00.000Z" }),
        { now },
      ),
    ).toBe(false);
    expect(
      isComparablePreClassSession(
        target,
        session({ sessionId: "p", startAt: "2026-09-15T18:00:00.000Z" }),
        { now },
      ),
    ).toBe(false);
  });
});

describe("isPreClassSessionOpen (T114)", () => {
  it("is open while the class is scheduled and has not finished", () => {
    expect(isPreClassSessionOpen(target, now)).toBe(true);
    expect(isPreClassSessionOpen(target, "2026-09-08T19:30:00.000Z")).toBe(false);
    expect(isPreClassSessionOpen(session({ sessionId: "t", status: "cancelled" }), now)).toBe(
      false,
    );
  });
});

describe("buildPreClassView (T114)", () => {
  const students = [
    student("s-booked", "Ana Coelho"),
    student("s-regular", "Bruno Le Sueur"),
    student("s-visitor", "Chris Pallot"),
    student("s-declined", "Dara Mourant"),
    student("s-walkin", "Elena Renouf"),
  ];
  const history: PreClassAttendanceEntry[] = [
    // A regular: three of the three comparable classes.
    historyEntry("s-regular", "past-1", "2026-09-01T18:05:00.000Z"),
    historyEntry("s-regular", "past-2", "2026-08-25T18:05:00.000Z"),
    historyEntry("s-regular", "past-3", "2026-08-18T18:20:00.000Z", "late"),
    // A visitor: once only, which is not a habit.
    historyEntry("s-visitor", "past-2", "2026-08-25T18:05:00.000Z"),
    // Somebody who cancelled this week but trains here habitually.
    historyEntry("s-declined", "past-1", "2026-09-01T18:05:00.000Z"),
    historyEntry("s-declined", "past-2", "2026-08-25T18:05:00.000Z"),
    // A walk-in already on the mat today.
    historyEntry("s-walkin", "past-1", "2026-09-01T18:05:00.000Z"),
    historyEntry("s-walkin", "past-2", "2026-08-25T18:05:00.000Z"),
    // Attendance of a session that is not comparable never counts.
    historyEntry("s-visitor", "other-programme", "2026-09-03T18:05:00.000Z"),
  ];

  function view(overrides: Parameters<typeof buildPreClassView>[0] | undefined = undefined) {
    return buildPreClassView({
      session: target,
      bookings: [booking("s-booked"), booking("s-declined", "cancelled")],
      attendance: [attendance("s-walkin", "attended")],
      recentSessions: pastSessions,
      history,
      students,
      now,
      ...overrides,
    });
  }

  it("lists the booked students first and the regulars behind them", () => {
    const result = view();
    expect(result.attendees.map((entry) => [entry.displayName, entry.source])).toEqual([
      ["Ana Coelho", "booked"],
      ["Bruno Le Sueur", "regular"],
    ]);
    expect(result.evidence).toEqual({
      open: true,
      windowDays: 56,
      minAttendances: 2,
      comparableSessionCount: 3,
      bookedCount: 1,
      suggestedCount: 1,
    });
  });

  it("carries the evidence behind each regular instead of a bare guess", () => {
    const regular = view().attendees.find((entry) => entry.source === "regular");
    expect(regular).toMatchObject({
      studentId: "s-regular",
      attendedCount: 3,
      comparableSessionCount: 3,
      lastAttendedAt: "2026-09-01T18:05:00.000Z",
      status: null,
    });
  });

  it("never suggests a visitor, somebody who cancelled, or somebody already on the mat", () => {
    const suggested = view()
      .attendees.filter((entry) => entry.source === "regular")
      .map((entry) => entry.studentId);
    expect(suggested).not.toContain("s-visitor");
    expect(suggested).not.toContain("s-declined");
    expect(suggested).not.toContain("s-walkin");
  });

  it("shows the live status of a booked student and their own habit", () => {
    const result = buildPreClassView({
      session: target,
      bookings: [booking("s-regular")],
      attendance: [attendance("s-regular", "late")],
      recentSessions: pastSessions,
      history,
      students,
      now,
    });
    expect(result.attendees[0]).toMatchObject({
      studentId: "s-regular",
      source: "booked",
      status: "late",
      attendedCount: 3,
    });
    // Booked once, listed once: their own habit does not put them in the list twice.
    expect(result.attendees.filter((entry) => entry.studentId === "s-regular")).toHaveLength(1);
  });

  it("stops suggesting once the class is cancelled or over, but still shows who was booked", () => {
    for (const closed of [
      { session: session({ sessionId: "target", status: "cancelled" }) },
      { now: "2026-09-08T20:00:00.000Z" },
    ]) {
      const result = view(closed as never);
      expect(result.evidence.open).toBe(false);
      expect(result.evidence.suggestedCount).toBe(0);
      expect(result.attendees.every((entry) => entry.source === "booked")).toBe(true);
    }
  });

  it("returns an honest empty list for a class nobody has booked or trained", () => {
    const result = buildPreClassView({
      session: target,
      bookings: [],
      attendance: [],
      recentSessions: [],
      history: [],
      students,
      now,
    });
    expect(result.attendees).toEqual([]);
    expect(result.evidence).toMatchObject({
      open: true,
      comparableSessionCount: 0,
      bookedCount: 0,
      suggestedCount: 0,
    });
  });

  it("leaves out students who are no longer active and corrections of attendance", () => {
    const result = buildPreClassView({
      session: target,
      bookings: [],
      attendance: [],
      recentSessions: pastSessions,
      history: [
        ...history,
        Object.freeze({
          sessionId: "past-1",
          studentId: "s-corrected",
          state: "attended",
          occurredAt: "2026-09-01T18:05:00.000Z",
          correctionOf: "past-1__s-corrected",
        }),
        historyEntry("s-corrected", "past-2", "2026-08-25T18:05:00.000Z"),
        historyEntry("s-gone", "past-1", "2026-09-01T18:05:00.000Z"),
        historyEntry("s-gone", "past-2", "2026-08-25T18:05:00.000Z"),
      ],
      students: [
        ...students,
        student("s-corrected", "Corrected Member"),
        Object.freeze({
          studentId: "s-gone",
          fullName: "Left The Academy",
          active: false,
          status: "inactive",
        }),
      ],
      now,
    });
    const ids = result.attendees.map((entry) => entry.studentId);
    expect(ids).not.toContain("s-gone");
    // The correction does not count, so the corrected student is one attendance short of a habit.
    expect(ids).not.toContain("s-corrected");
  });

  it("caps the list a coach has to read before class", () => {
    const many = Array.from({ length: preClassMaxSuggestions + 5 }, (_, index) => `s-${index}`);
    const result = buildPreClassView({
      session: target,
      bookings: [],
      attendance: [],
      recentSessions: pastSessions,
      history: many.flatMap((studentId) => [
        historyEntry(studentId, "past-1", "2026-09-01T18:05:00.000Z"),
        historyEntry(studentId, "past-2", "2026-08-25T18:05:00.000Z"),
      ]),
      students: many.map((studentId) => student(studentId, `Member ${studentId}`)),
      now,
    });
    expect(result.attendees).toHaveLength(preClassMaxSuggestions);
    expect(result.evidence.suggestedCount).toBe(preClassMaxSuggestions);
  });

  it("ranks the most regular first", () => {
    const result = buildPreClassView({
      session: target,
      bookings: [],
      attendance: [],
      recentSessions: pastSessions,
      history: [
        historyEntry("s-two", "past-1", "2026-09-01T18:05:00.000Z"),
        historyEntry("s-two", "past-2", "2026-08-25T18:05:00.000Z"),
        historyEntry("s-three", "past-1", "2026-09-01T18:05:00.000Z"),
        historyEntry("s-three", "past-2", "2026-08-25T18:05:00.000Z"),
        historyEntry("s-three", "past-3", "2026-08-18T18:20:00.000Z"),
      ],
      students: [student("s-two", "Zoe Twice"), student("s-three", "Alan Thrice")],
      now,
    });
    expect(result.attendees.map((entry) => entry.studentId)).toEqual(["s-three", "s-two"]);
  });
});

describe("parsePreClassViewQuery (T114)", () => {
  it("accepts exactly one session", () => {
    const parsed = parsePreClassViewQuery({ sessionId: "session-1" });
    expect(parsed.ok && parsed.value).toEqual({ sessionId: "session-1" });
  });

  it("refuses anything else", () => {
    for (const payload of [
      null,
      undefined,
      "session-1",
      [],
      {},
      { sessionId: "" },
      { sessionId: "../escape" },
      { sessionId: "session-1", windowDays: 7 },
    ]) {
      expect(parsePreClassViewQuery(payload).ok, JSON.stringify(payload)).toBe(false);
    }
  });
});
