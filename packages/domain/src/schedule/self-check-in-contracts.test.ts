import { describe, expect, it } from "vitest";

import {
  decideSelfCheckIn,
  isSelfCheckInWindowOpen,
  nextSelfCheckInSession,
  parseSelfCheckInInput,
  selfCheckInMaxAccuracyMeters,
  selfCheckInWindow,
  selfCheckInWindowLabels,
} from "./self-check-in-contracts";
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";
import { checkInMethods } from "./schedule-contracts";

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

const town = { latitude: 49.183954, longitude: -2.107142 };
// 1e-5° of latitude ≈ 1.11 m
const at = (metresNorth: number, accuracyMeters = 12) => ({
  latitude: Number((town.latitude + metresNorth / 111_000).toFixed(6)),
  longitude: town.longitude,
  accuracyMeters,
});

describe("parseSelfCheckInInput", () => {
  const valid = { sessionId: "s1", studentId: "sam", position: at(0) };
  it("accepts exactly sessionId, studentId and position", () => {
    expect(parseSelfCheckInInput(valid)).toEqual({
      ok: true,
      value: { ...valid, position: at(0) },
    });
  });
  it("rejects extra keys, missing keys and non-objects", () => {
    expect(parseSelfCheckInInput({ ...valid, extra: 1 }).ok).toBe(false);
    expect(parseSelfCheckInInput({ sessionId: "s1", studentId: "sam" }).ok).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), speed: 1 } }).ok).toBe(false);
    expect(parseSelfCheckInInput("nope").ok).toBe(false);
    expect(parseSelfCheckInInput(null).ok).toBe(false);
  });
  it("rejects strings, NaN and out-of-range coordinates", () => {
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), latitude: "49" } }).ok).toBe(
      false,
    );
    expect(
      parseSelfCheckInInput({ ...valid, position: { ...at(0), latitude: Number.NaN } }).ok,
    ).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), latitude: 91 } }).ok).toBe(
      false,
    );
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), longitude: -181 } }).ok).toBe(
      false,
    );
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), accuracyMeters: -1 } }).ok).toBe(
      false,
    );
    expect(
      parseSelfCheckInInput({ ...valid, position: { ...at(0), accuracyMeters: 100_001 } }).ok,
    ).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, sessionId: "  " }).ok).toBe(false);
  });
  it("never echoes the submitted values in its error", () => {
    const result = parseSelfCheckInInput({
      ...valid,
      position: { ...at(0), latitude: 91.123456 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("91.123456");
  });
});

describe("decideSelfCheckIn", () => {
  const base = { session: s, isOpenMat: false, site: town, nowMs: startMs - 30 * minute };
  it("refuses in order: window, site, accuracy, distance", () => {
    expect(
      decideSelfCheckIn({
        ...base,
        nowMs: startMs - 61 * minute,
        site: null,
        position: at(500, 900),
      }),
    ).toEqual({ ok: false, error: { reason: "window_closed" } });
    expect(decideSelfCheckIn({ ...base, site: null, position: at(500, 900) })).toEqual({
      ok: false,
      error: { reason: "site_not_ready" },
    });
    expect(decideSelfCheckIn({ ...base, site: undefined, position: at(0) })).toEqual({
      ok: false,
      error: { reason: "site_not_ready" },
    });
    expect(
      decideSelfCheckIn({
        ...base,
        position: at(500, selfCheckInMaxAccuracyMeters + 1),
      }),
    ).toEqual({ ok: false, error: { reason: "imprecise" } });
    expect(decideSelfCheckIn({ ...base, position: at(120) })).toEqual({
      ok: false,
      error: { reason: "outside", distanceMeters: 120 },
    });
  });
  it("passes at exactly 50 m and exactly 100 m accuracy, fails at 51 m and 101 m", () => {
    expect(decideSelfCheckIn({ ...base, position: at(50, 100) })).toEqual({
      ok: true,
      value: { signal: "within", distanceMeters: 50, accuracyMeters: 100, overrideReason: null },
    });
    expect(decideSelfCheckIn({ ...base, position: at(51) }).ok).toBe(false);
    expect(decideSelfCheckIn({ ...base, position: at(0, 101) }).ok).toBe(false);
  });
  it("rejects fractional accuracy above 100 before rounding", () => {
    expect(
      decideSelfCheckIn({ ...base, position: at(0, selfCheckInMaxAccuracyMeters + 0.4) }),
    ).toEqual({ ok: false, error: { reason: "imprecise" } });
  });
  it("fails closed for an invalid site coordinate range", () => {
    expect(
      decideSelfCheckIn({
        ...base,
        site: { latitude: 91, longitude: town.longitude },
        position: at(0),
      }),
    ).toEqual({ ok: false, error: { reason: "site_not_ready" } });
  });
  it("uses the open-mat window when told so", () => {
    expect(
      decideSelfCheckIn({
        ...base,
        isOpenMat: true,
        nowMs: startMs + 45 * minute,
        position: at(0),
      }).ok,
    ).toBe(true);
  });
});

describe("check-in methods", () => {
  it("include self", () => {
    expect(checkInMethods).toContain("self");
  });
});
