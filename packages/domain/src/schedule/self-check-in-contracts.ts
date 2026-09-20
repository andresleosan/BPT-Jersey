/**
 * Ready for Jiu Jitsu — member self check-in (/account). Pure rules only; nothing here touches
 * Firebase. Spec: docs/archive/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md
 */
import {
  checkInProximityRadiusMeters,
  distanceInMetres,
  maxCheckInProximityMeters,
  type AttendanceProximity,
  type AttendanceRecord,
  type BookingRecord,
  type LocationGeofence,
  type ProgramRecord,
  type SessionRecord,
} from "./schedule-contracts";
import { err, ok, type Result } from "../result";

export const selfCheckInOpensBeforeStartMs = 60 * 60 * 1000;
export const selfCheckInClosesAfterStartMs = 20 * 60 * 1000;

type WindowSession = Pick<SessionRecord, "startAt" | "endAt">;

export function isOpenMatProgram(program: Pick<ProgramRecord, "discipline"> | undefined): boolean {
  return program?.discipline === "open-mat";
}

/** Decision 3 and 20: −60 min → +20 min, or → endAt for an open mat (no 20-minute loss there). */
export function selfCheckInWindow(
  session: WindowSession,
  isOpenMat: boolean,
): Readonly<{ opensAtMs: number; closesAtMs: number }> {
  const startMs = Date.parse(session.startAt);
  const endMs = Date.parse(session.endAt);
  return Object.freeze({
    opensAtMs: startMs - selfCheckInOpensBeforeStartMs,
    closesAtMs: isOpenMat ? endMs : startMs + selfCheckInClosesAfterStartMs,
  });
}

export function isSelfCheckInWindowOpen(
  session: WindowSession,
  isOpenMat: boolean,
  nowMs: number,
): boolean {
  const { opensAtMs, closesAtMs } = selfCheckInWindow(session, isOpenMat);
  return (
    Number.isFinite(opensAtMs) &&
    Number.isFinite(closesAtMs) &&
    nowMs >= opensAtMs &&
    nowMs <= closesAtMs
  );
}

const jerseyClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function selfCheckInWindowLabels(
  session: WindowSession,
  isOpenMat: boolean,
): Readonly<{ opens: string; closes: string }> {
  const { opensAtMs, closesAtMs } = selfCheckInWindow(session, isOpenMat);
  return Object.freeze({
    opens: jerseyClock.format(new Date(opensAtMs)),
    closes: jerseyClock.format(new Date(closesAtMs)),
  });
}

export type SelfCheckInCandidate =
  | Readonly<{ kind: "ready"; session: SessionRecord }>
  | Readonly<{ kind: "checkedIn"; session: SessionRecord; attendance: AttendanceRecord }>;

/**
 * The earliest session whose window is open and that the student holds a confirmed booking for.
 * Attendance of any method turns it into `checkedIn` (decision 6: attendance is the seam with the
 * coach team; decision 16: the confirmation card survives reloads).
 */
export function nextSelfCheckInSession(input: {
  sessions: readonly SessionRecord[];
  programs: readonly ProgramRecord[];
  bookings: readonly BookingRecord[];
  attendance: readonly AttendanceRecord[];
  nowMs: number;
}): SelfCheckInCandidate | undefined {
  const programs = new Map(input.programs.map((p) => [p.programId, p]));
  const confirmed = new Set(
    input.bookings.filter((b) => b.status === "confirmed" && !(b.schemaVersion === "2" && b.absent)).map((b) => b.sessionId),
  );
  const attendance = new Map(input.attendance.map((a) => [a.sessionId, a]));
  const open = input.sessions
    .filter(
      (s) =>
        s.status !== "cancelled" &&
        confirmed.has(s.sessionId) &&
        isSelfCheckInWindowOpen(s, isOpenMatProgram(programs.get(s.programId)), input.nowMs),
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const session = open[0];
  if (!session) return undefined;
  const record = attendance.get(session.sessionId);
  return record ? { kind: "checkedIn", session, attendance: record } : { kind: "ready", session };
}

/** Decision 14: readings wider than this are refused; the distance itself must still be ≤ 50 m. */
export const selfCheckInMaxAccuracyMeters = 100;

export type SelfCheckInPosition = Readonly<{
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}>;

export type SelfCheckInInput = Readonly<{
  sessionId: string;
  studentId: string;
  position: SelfCheckInPosition;
}>;

export const selfCheckInRefusals = Object.freeze([
  "window_closed",
  "site_not_ready",
  "imprecise",
  "outside",
  "not_booked",
  "already_checked_in",
] as const);
export type SelfCheckInRefusal = (typeof selfCheckInRefusals)[number];

export type SelfCheckInDecisionError = Readonly<{
  reason: SelfCheckInRefusal;
  /** Only with outside, so the member can be told how far they are. Never a coordinate. */
  distanceMeters?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}

function finiteWithin(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Strict: exactly the three fields, exactly the three coordinates, finite and in range. */
export function parseSelfCheckInInput(input: unknown): Result<SelfCheckInInput, string> {
  if (!isRecord(input) || !exactKeys(input, ["sessionId", "studentId", "position"])) {
    return err("Self check-in accepts exactly sessionId, studentId and position");
  }
  const { sessionId, studentId, position } = input;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return err("sessionId is required");
  }
  if (typeof studentId !== "string" || studentId.trim().length === 0) {
    return err("studentId is required");
  }
  if (!isRecord(position) || !exactKeys(position, ["latitude", "longitude", "accuracyMeters"])) {
    return err("position accepts exactly latitude, longitude and accuracyMeters");
  }
  if (
    !finiteWithin(position.latitude, -90, 90) ||
    !finiteWithin(position.longitude, -180, 180) ||
    !finiteWithin(position.accuracyMeters, 0, maxCheckInProximityMeters)
  ) {
    return err("position is out of range");
  }
  return ok(
    Object.freeze({
      sessionId: sessionId.trim(),
      studentId: studentId.trim(),
      position: Object.freeze({
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMeters: position.accuracyMeters,
      }),
    }),
  );
}

/**
 * Decisions 1, 2, 14: the hard gate, judged on the server with server time. Order: window → site
 * coordinates → accuracy → distance. The returned proximity is what the attendance record stores;
 * the position itself is used here and nowhere else.
 */
export function decideSelfCheckIn(input: {
  session: WindowSession;
  isOpenMat: boolean;
  site: LocationGeofence | null | undefined;
  position: SelfCheckInPosition;
  nowMs: number;
}): Result<AttendanceProximity, SelfCheckInDecisionError> {
  if (!isSelfCheckInWindowOpen(input.session, input.isOpenMat, input.nowMs)) {
    return err({ reason: "window_closed" });
  }
  if (
    input.site === null ||
    input.site === undefined ||
    !finiteWithin(input.site.latitude, -90, 90) ||
    !finiteWithin(input.site.longitude, -180, 180)
  ) {
    return err({ reason: "site_not_ready" });
  }
  if (input.position.accuracyMeters > selfCheckInMaxAccuracyMeters) {
    return err({ reason: "imprecise" });
  }
  const accuracyMeters = Math.round(input.position.accuracyMeters);
  const distanceMeters = Math.round(
    distanceInMetres(
      { latitude: input.position.latitude, longitude: input.position.longitude },
      input.site,
    ),
  );
  if (distanceMeters > checkInProximityRadiusMeters) {
    return err({ reason: "outside", distanceMeters });
  }
  return ok(
    Object.freeze({
      signal: "within" as const,
      distanceMeters,
      accuracyMeters,
      overrideReason: null,
    }),
  );
}
