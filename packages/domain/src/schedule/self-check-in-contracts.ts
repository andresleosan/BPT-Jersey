/**
 * Ready for Jiu Jitsu — member self check-in (/account). Pure rules only; nothing here touches
 * Firebase. Spec: docs/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md
 */
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";

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
    input.bookings.filter((b) => b.status === "confirmed").map((b) => b.sessionId),
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
