import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "@bpt-jersey/domain/schedule";
import type { NoShowPenaltyRecord } from "@bpt-jersey/domain/penalties";

import type {
  CalendarMember,
  CalendarParticipant,
  CalendarRepository,
  CalendarRole,
  CalendarWeekData,
} from "./calendar-repository";

// ponytail: deterministic in-memory fixtures so /account renders and round-trips without Firebase.
// Sessions are generated around "today" so cut-offs, past days and the 14-day cap all exercise.
// Maya always carries a pending £15 penalty so the banner can be seen on the workbench.

const academyId = "bpt-jersey";
const dayMs = 86400000;
const audit = Object.freeze({
  schemaVersion: "1" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "fixture",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "fixture",
});

function program(
  programId: string,
  name: string,
  ageBand: ProgramRecord["ageBand"],
  discipline: ProgramRecord["discipline"],
): ProgramRecord {
  return { programId, academyId, name, ageBand, discipline, level: "all-levels", active: true, schemaVersion: "1" };
}

const programs: readonly ProgramRecord[] = Object.freeze([
  program("prog-kids", "Kids BJJ", "kids", "bjj"),
  program("prog-teens", "Teens BJJ", "teens", "bjj"),
  program("prog-adult", "Adults BJJ", "adult", "bjj"),
  program("prog-om", "Open Mat", "all", "open-mat"),
]);

const maya: CalendarParticipant = {
  studentId: "maya",
  firstName: "Maya",
  membershipId: "m-maya",
  planId: "town-teens",
  participantType: "teens",
  planClassSites: ["Town"],
  planOpenMatSites: ["Town"],
};
const leo: CalendarParticipant = {
  studentId: "leo",
  firstName: "Leo",
  membershipId: "m-leo",
  planId: "west-kids-2x",
  participantType: "kids",
  planClassSites: ["West"],
  planOpenMatSites: ["Town"],
};
const sam: CalendarParticipant = {
  studentId: "sam",
  firstName: "Sam",
  membershipId: "m-sam",
  planId: "town-teens",
  participantType: "teens",
  planClassSites: ["Town"],
  planOpenMatSites: ["Town"],
};
const alex: CalendarParticipant = {
  studentId: "alex",
  firstName: "Alex",
  membershipId: "m-alex",
  planId: "bpt-jersey-adult",
  participantType: "adult",
  planClassSites: ["Town", "West"],
  planOpenMatSites: ["Town", "West"],
};
const participants: readonly CalendarParticipant[] = Object.freeze([maya, leo, sam, alex]);

const members: Readonly<Record<CalendarRole, CalendarMember>> = Object.freeze({
  guardian: { role: "guardian", displayName: "Jordan Demo", participants: [maya, leo] },
  teenStudent: { role: "teenStudent", displayName: "Sam Demo", participants: [sam] },
  adultStudent: { role: "adultStudent", displayName: "Alex Demo", participants: [alex] },
});

type Slot = Readonly<{
  programId: string;
  locationId: SessionRecord["locationId"];
  hour: number;
  minute: number;
  durationMin: number;
  title: string;
}>;

function slot(
  locationId: SessionRecord["locationId"],
  programId: string,
  hour: number,
  minute: number,
  title: string,
  durationMin = 60,
): Slot {
  return { programId, locationId, hour, minute, durationMin, title };
}

const townEvening = [
  slot("town", "prog-kids", 17, 0, "Kids BJJ"),
  slot("town", "prog-teens", 18, 0, "Teens BJJ"),
  slot("town", "prog-adult", 19, 0, "Adults BJJ"),
];
const westEvening = [
  slot("west", "prog-kids", 17, 30, "Kids BJJ"),
  slot("west", "prog-teens", 18, 30, "Teens BJJ"),
  slot("west", "prog-adult", 19, 30, "Adults BJJ"),
];

const weekdaySlots: Readonly<Record<string, readonly Slot[]>> = Object.freeze({
  Mon: townEvening,
  Tue: westEvening,
  Wed: townEvening,
  Thu: westEvening,
  Fri: townEvening,
  Sat: [slot("town", "prog-om", 10, 0, "Open Mat", 90), slot("west", "prog-om", 11, 30, "Open Mat", 90)],
});

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  hour: "2-digit",
  hourCycle: "h23",
});
const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  weekday: "short",
});

/** UTC instant for `dateKey` at HH:mm Jersey. */
function jerseyInstant(dateKey: string, hour: number, minute: number): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour, minute));
  const localHour = Number(hourFormatter.formatToParts(guess).find((p) => p.type === "hour")?.value ?? hour);
  const offsetHours = (localHour - hour + 24) % 24; // 0 in winter, 1 in summer
  return new Date(guess.getTime() - offsetHours * 3600000);
}

function generateSessions(now: Date): SessionRecord[] {
  const sessions: SessionRecord[] = [];
  const start = new Date(now.getTime() - 7 * dayMs);
  for (let i = 0; i < 29; i += 1) {
    const key = dateKeyInJersey(new Date(start.getTime() + i * dayMs));
    const weekday = weekdayFormatter.format(jerseyInstant(key, 12, 0));
    for (const entry of weekdaySlots[weekday] ?? []) {
      const startAt = jerseyInstant(key, entry.hour, entry.minute);
      const endAt = new Date(startAt.getTime() + entry.durationMin * 60000);
      sessions.push({
        sessionId: `${key}_${entry.locationId}_${entry.programId}`,
        academyId,
        classId: null,
        programId: entry.programId,
        locationId: entry.locationId,
        instructorId: "coach-1",
        title: entry.title,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        capacity: 20,
        minParticipants: 4,
        status: endAt.getTime() < now.getTime() ? "completed" : "scheduled",
        isSeminar: false,
        cancellationReason: null,
        ...audit,
      });
    }
  }
  return sessions;
}

function bookingFor(session: SessionRecord, p: CalendarParticipant): BookingRecord {
  return {
    bookingId: `bk_${session.sessionId}_${p.studentId}`,
    academyId,
    sessionId: session.sessionId,
    studentId: p.studentId,
    membershipId: p.membershipId,
    status: "confirmed",
    requestedAt: session.createdAt,
    cancelledAt: null,
    cancellationReason: null,
    ...audit,
  };
}

function attendanceFor(
  session: SessionRecord,
  p: CalendarParticipant,
  state: AttendanceRecord["state"],
): AttendanceRecord {
  return {
    attendanceId: `${session.sessionId}__${p.studentId}`,
    academyId,
    sessionId: session.sessionId,
    studentId: p.studentId,
    method: "manual",
    state,
    occurredAt: session.startAt,
    notes: null,
    correctionOf: null,
    ...audit,
  };
}

function failure(code: string, reason?: string): Error {
  return Object.assign(new Error(code), { code, details: reason ? { reason } : undefined });
}

export function createFixtureCalendarRepository(role: CalendarRole): CalendarRepository {
  const now = new Date();
  const sessions = generateSessions(now);
  const bookings: BookingRecord[] = [];
  const attendance: AttendanceRecord[] = [];
  const bookedCounts: Record<string, number> = {};
  const penalties: NoShowPenaltyRecord[] = [];

  const isPast = (s: SessionRecord) => Date.parse(s.endAt) < now.getTime();
  const isUpcoming = (s: SessionRecord) => Date.parse(s.startAt) > now.getTime() + 2 * 3600000;

  function seedFor(p: CalendarParticipant, programId: string, locationId: SessionRecord["locationId"]): void {
    const mine = sessions.filter((s) => s.programId === programId && s.locationId === locationId);
    const past = mine.filter(isPast);
    const upcoming = mine.filter(isUpcoming);
    const missed = past[past.length - 1];
    const attended = past[past.length - 2];
    if (missed) {
      bookings.push(bookingFor(missed, p));
      attendance.push(attendanceFor(missed, p, "no_show"));
    }
    if (attended) {
      bookings.push(bookingFor(attended, p));
      attendance.push(attendanceFor(attended, p, "attended"));
    }
    const [nextSession, afterNext] = upcoming;
    if (nextSession) bookings.push(bookingFor(nextSession, p));
    if (afterNext) bookedCounts[afterNext.sessionId] = afterNext.capacity;
  }

  seedFor(maya, "prog-teens", "town");
  seedFor(sam, "prog-teens", "town");
  seedFor(leo, "prog-kids", "west");
  seedFor(alex, "prog-adult", "town");

  const mayaMissed = attendance.find((a) => a.studentId === "maya" && a.state === "no_show");
  const penaltySession = sessions.find((s) => s.sessionId === mayaMissed?.sessionId) ?? sessions[0];
  if (penaltySession) {
    penalties.push({
      penaltyId: `pen_${penaltySession.sessionId}`,
      academyId,
      sessionId: penaltySession.sessionId,
      studentId: "maya",
      locationId: "town",
      amountMinor: 1500,
      currency: "GBP",
      status: "proposed",
      sessionStartAt: penaltySession.startAt,
      proposedAt: penaltySession.endAt,
      proposedBy: "system",
      resolution: null,
      ...audit,
    });
  }

  function replaceBooking(previous: BookingRecord | undefined, next: BookingRecord): void {
    if (previous) bookings.splice(bookings.indexOf(previous), 1, next);
    else bookings.push(next);
  }

  return {
    async loadMember() {
      return members[role];
    },
    async loadWeek(studentId, fromIso, toIso): Promise<CalendarWeekData> {
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      const inRange = sessions.filter((s) => {
        const t = Date.parse(s.startAt);
        return t >= from && t < to;
      });
      const ids = new Set(inRange.map((s) => s.sessionId));
      return {
        sessions: inRange,
        programs,
        bookings: bookings.filter((b) => b.studentId === studentId && ids.has(b.sessionId)),
        attendance: attendance.filter((a) => a.studentId === studentId && ids.has(a.sessionId)),
        bookedCounts: { ...bookedCounts },
      };
    },
    async book(input) {
      const session = sessions.find((s) => s.sessionId === input.sessionId);
      if (!session) throw failure("functions/not-found");
      if ((bookedCounts[session.sessionId] ?? 0) >= session.capacity) {
        throw failure("functions/failed-precondition", "capacity");
      }
      const participant = participants.find((p) => p.studentId === input.studentId) ?? sam;
      const existing = bookings.find(
        (b) => b.sessionId === input.sessionId && b.studentId === input.studentId,
      );
      const record: BookingRecord = {
        ...(existing ?? bookingFor(session, participant)),
        status: "confirmed",
        cancelledAt: null,
        cancellationReason: null,
        requestedAt: new Date().toISOString(),
      };
      replaceBooking(existing, record);
      return record;
    },
    async cancel(input) {
      const existing = bookings.find(
        (b) => b.sessionId === input.sessionId && b.studentId === input.studentId,
      );
      if (!existing) throw failure("functions/not-found");
      const record: BookingRecord = {
        ...existing,
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancellationReason: input.reason,
      };
      replaceBooking(existing, record);
      return record;
    },
    async loadPenalties(studentId) {
      return penalties.filter((p) => p.studentId === studentId);
    },
  };
}
