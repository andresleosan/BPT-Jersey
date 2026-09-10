import { err, ok, type Result } from "../result";
import type {
  AttendanceRecord,
  BookingRecord,
  SessionOperationalStatus,
  SessionRecord,
} from "./schedule-contracts";

/**
 * T114: the pre-class view of the coach. Before a class starts, the panel shows who is booked and
 * who habitually trains this class and has not booked, so the coach can check people in quickly
 * instead of hunting for them.
 *
 * A suggestion is never a guess: every regular on the list is there because the canonical
 * attendance of comparable past sessions says so, and the view carries the count and the window it
 * was derived from. Nobody is checked in by any of this - the list only puts a name in front of the
 * coach, who still records the attendance.
 */

/** Eight weeks of history: long enough to see a habit, short enough to forget an old one. */
export const preClassWindowDays = 56;
/** Twice is a habit, once is a visit. */
export const preClassMinAttendances = 2;
/** A class that starts half an hour off the usual slot is still the same class. */
export const preClassStartToleranceMinutes = 30;
/** The panel is a list a coach reads before class, not a report. */
export const preClassMaxSuggestions = 25;

export const preClassAttendeeSources = Object.freeze(["booked", "regular"] as const);
export type PreClassAttendeeSource = (typeof preClassAttendeeSources)[number];

export type PreClassAttendee = Readonly<{
  studentId: string;
  displayName: string;
  source: PreClassAttendeeSource;
  /** The live status of a booked student; a regular has no booking, so it is null. */
  status: SessionOperationalStatus | null;
  /** Comparable sessions of the window this student attended, and out of how many. */
  attendedCount: number;
  comparableSessionCount: number;
  lastAttendedAt: string | null;
}>;

export type PreClassView = Readonly<{
  session: SessionRecord;
  attendees: readonly PreClassAttendee[];
  evidence: Readonly<{
    /** False once the class is cancelled or over: there is nothing left to prepare. */
    open: boolean;
    windowDays: number;
    minAttendances: number;
    comparableSessionCount: number;
    bookedCount: number;
    suggestedCount: number;
  }>;
  refreshedAt: string;
}>;

export type PreClassStudent = Readonly<{
  studentId: string;
  fullName: string;
  active: boolean;
  status: string;
}>;

/** One canonical attendance of a past session, reduced to what the habit needs. */
export type PreClassAttendanceEntry = Readonly<{
  sessionId: string;
  studentId: string;
  state: string;
  occurredAt: string;
  correctionOf: string | null;
}>;

const dayMs = 86_400_000;

function minutesOfDay(iso: string): number | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function weekday(iso: string): number | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).getUTCDay();
}

/**
 * Whether a past session is the same class as the target one. Same programme, same site, same day
 * of the week and the same slot give or take half an hour: that is what a member means when they
 * say "my Tuesday class". A cancelled session never counts, because nobody could attend it.
 */
export function isComparablePreClassSession(
  target: SessionRecord,
  candidate: SessionRecord,
  options: Readonly<{ now: string; windowDays?: number; toleranceMinutes?: number }>,
): boolean {
  if (candidate.sessionId === target.sessionId) return false;
  if (candidate.status === "cancelled") return false;
  if (candidate.programId !== target.programId) return false;
  if (candidate.locationId !== target.locationId) return false;

  const nowMs = Date.parse(options.now);
  const candidateMs = Date.parse(candidate.startAt);
  if (Number.isNaN(nowMs) || Number.isNaN(candidateMs)) return false;
  const windowMs = (options.windowDays ?? preClassWindowDays) * dayMs;
  if (candidateMs >= nowMs || candidateMs < nowMs - windowMs) return false;

  const targetDay = weekday(target.startAt);
  const candidateDay = weekday(candidate.startAt);
  if (targetDay === null || candidateDay === null || targetDay !== candidateDay) return false;

  const targetSlot = minutesOfDay(target.startAt);
  const candidateSlot = minutesOfDay(candidate.startAt);
  if (targetSlot === null || candidateSlot === null) return false;
  const tolerance = options.toleranceMinutes ?? preClassStartToleranceMinutes;
  return Math.abs(targetSlot - candidateSlot) <= tolerance;
}

/** A class is worth preparing while it is scheduled and has not finished yet. */
export function isPreClassSessionOpen(session: SessionRecord, now: string): boolean {
  if (session.status !== "scheduled") return false;
  const endMs = Date.parse(session.endAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(endMs) || Number.isNaN(nowMs)) return false;
  return nowMs < endMs;
}

function attendedState(state: string): boolean {
  return state === "attended" || state === "late";
}

function liveStatus(attendance: AttendanceRecord | undefined): SessionOperationalStatus {
  if (attendance === undefined) return "booked_not_arrived";
  switch (attendance.state) {
    case "attended":
      return "attended";
    case "late":
      return "late";
    case "no_show":
      return "no_show";
    default:
      return "absent";
  }
}

export function buildPreClassView(input: {
  session: SessionRecord;
  bookings: readonly BookingRecord[];
  /** Canonical attendance already recorded for the target session. */
  attendance: readonly AttendanceRecord[];
  /** Sessions of the recent past, unfiltered; comparability is decided here. */
  recentSessions: readonly SessionRecord[];
  /** Canonical attendance of those sessions. */
  history: readonly PreClassAttendanceEntry[];
  students: readonly PreClassStudent[];
  now?: string;
  windowDays?: number;
  minAttendances?: number;
}): PreClassView {
  const now = input.now ?? new Date().toISOString();
  const windowDays = input.windowDays ?? preClassWindowDays;
  const minAttendances = input.minAttendances ?? preClassMinAttendances;
  const open = isPreClassSessionOpen(input.session, now);

  const comparableSessionIds = new Set(
    input.recentSessions
      .filter((candidate) =>
        isComparablePreClassSession(input.session, candidate, { now, windowDays }),
      )
      .map((candidate) => candidate.sessionId),
  );

  const namesById = new Map(
    input.students
      .filter((student) => student.active && student.status === "active")
      .map((student) => [student.studentId, student.fullName.trim()]),
  );

  const habit = new Map<string, { attendedCount: number; lastAttendedAt: string | null }>();
  for (const entry of input.history) {
    if (entry.correctionOf !== null) continue;
    if (!comparableSessionIds.has(entry.sessionId)) continue;
    if (!attendedState(entry.state)) continue;
    const current = habit.get(entry.studentId) ?? { attendedCount: 0, lastAttendedAt: null };
    current.attendedCount += 1;
    if (current.lastAttendedAt === null || entry.occurredAt > current.lastAttendedAt) {
      current.lastAttendedAt = entry.occurredAt;
    }
    habit.set(entry.studentId, current);
  }

  const canonicalAttendance = new Map(
    input.attendance
      .filter((record) => record.correctionOf === null)
      .map((record) => [record.studentId, record]),
  );
  const confirmed = input.bookings.filter((booking) => booking.status === "confirmed");
  const bookedIds = new Set(confirmed.map((booking) => booking.studentId));
  // Somebody who cancelled their booking for this very session said no; the panel does not nag.
  const declinedIds = new Set(
    input.bookings
      .filter((booking) => booking.status !== "confirmed")
      .map((booking) => booking.studentId),
  );

  const attendees: PreClassAttendee[] = [];
  for (const booking of confirmed) {
    const name = namesById.get(booking.studentId);
    if (name === undefined || name.length === 0) continue;
    const record = habit.get(booking.studentId);
    attendees.push(
      Object.freeze({
        studentId: booking.studentId,
        displayName: name,
        source: "booked" as const,
        status: liveStatus(canonicalAttendance.get(booking.studentId)),
        attendedCount: record?.attendedCount ?? 0,
        comparableSessionCount: comparableSessionIds.size,
        lastAttendedAt: record?.lastAttendedAt ?? null,
      }),
    );
  }
  attendees.sort((left, right) => left.displayName.localeCompare(right.displayName));

  const suggestions: PreClassAttendee[] = [];
  if (open) {
    for (const [studentId, record] of habit) {
      if (bookedIds.has(studentId) || declinedIds.has(studentId)) continue;
      // Already on the mat as a walk-in: there is nothing left to suggest.
      if (canonicalAttendance.has(studentId)) continue;
      if (record.attendedCount < minAttendances) continue;
      const name = namesById.get(studentId);
      if (name === undefined || name.length === 0) continue;
      suggestions.push(
        Object.freeze({
          studentId,
          displayName: name,
          source: "regular" as const,
          status: null,
          attendedCount: record.attendedCount,
          comparableSessionCount: comparableSessionIds.size,
          lastAttendedAt: record.lastAttendedAt,
        }),
      );
    }
    suggestions.sort(
      (left, right) =>
        right.attendedCount - left.attendedCount ||
        (right.lastAttendedAt ?? "").localeCompare(left.lastAttendedAt ?? "") ||
        left.displayName.localeCompare(right.displayName),
    );
  }
  const capped = suggestions.slice(0, preClassMaxSuggestions);

  return Object.freeze({
    session: input.session,
    attendees: Object.freeze([...attendees, ...capped]),
    evidence: Object.freeze({
      open,
      windowDays,
      minAttendances,
      comparableSessionCount: comparableSessionIds.size,
      bookedCount: attendees.length,
      suggestedCount: capped.length,
    }),
    refreshedAt: now,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export type PreClassViewQuery = Readonly<{ sessionId: string }>;

/** Closed payload: one session, nothing else. */
export function parsePreClassViewQuery(input: unknown): Result<PreClassViewQuery, string> {
  if (!isRecord(input)) return err("Pre-class query must be an object");
  if (Object.keys(input).length !== 1 || typeof input.sessionId !== "string") {
    return err("Pre-class query accepts only sessionId");
  }
  if (!identifierPattern.test(input.sessionId)) return err("sessionId is invalid");
  return ok(Object.freeze({ sessionId: input.sessionId }));
}
