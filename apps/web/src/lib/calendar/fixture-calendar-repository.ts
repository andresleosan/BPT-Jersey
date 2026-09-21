import { determinePunctuality, type LocationGeofence } from "@bpt-jersey/domain/schedule";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { decideSelfCheckIn, isOpenMatProgram } from "@bpt-jersey/domain/schedule/self-check-in";
import type {
  AgeRange,
  AttendanceRecord,
  BookingRecord,
  LevelRange,
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

const sites: Readonly<Record<SessionRecord["locationId"], LocationGeofence>> = Object.freeze({
  town: { latitude: 49.183954, longitude: -2.107142 },
  west: { latitude: 49.205824, longitude: -2.185817 },
});

function program(
  programId: string,
  name: string,
  ageBand: ProgramRecord["ageBand"],
  discipline: ProgramRecord["discipline"],
): ProgramRecord {
  return {
    programId,
    academyId,
    name,
    ageBand,
    discipline,
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  };
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
  weeklyClassLimit: 2,
};
const leo: CalendarParticipant = {
  studentId: "leo",
  firstName: "Leo",
  membershipId: "m-leo",
  planId: "west-kids-2x",
  participantType: "kids",
  planClassSites: ["West"],
  planOpenMatSites: ["Town"],
  weeklyClassLimit: 2,
};
const sam: CalendarParticipant = {
  studentId: "sam",
  firstName: "Sam",
  membershipId: "m-sam",
  planId: "town-teens",
  participantType: "teens",
  planClassSites: ["Town"],
  planOpenMatSites: ["Town"],
  weeklyClassLimit: 2,
};
const alex: CalendarParticipant = {
  studentId: "alex",
  firstName: "Alex",
  membershipId: "m-alex",
  planId: "bpt-jersey-adult",
  participantType: "adult",
  planClassSites: ["Town", "West"],
  planOpenMatSites: ["Town", "West"],
  weeklyClassLimit: null,
};
const members: Readonly<Record<CalendarRole, CalendarMember>> = Object.freeze({
  guardian: { role: "guardian", displayName: "Jordan Demo", participants: [maya, leo] },
  teenStudent: { role: "teenStudent", displayName: "Sam Demo", participants: [sam] },
  adultStudent: { role: "adultStudent", displayName: "Alex Demo", participants: [alex] },
});

const usualSlots: Readonly<Record<string, readonly [string, SessionRecord["locationId"]]>> = {
  maya: ["prog-teens", "town"],
  sam: ["prog-teens", "town"],
  leo: ["prog-kids", "west"],
  alex: ["prog-adult", "town"],
};

type Slot = Readonly<{
  programId: string;
  locationId: SessionRecord["locationId"];
  hour: number;
  minute: number;
  durationMin: number;
  title: string;
  description?: string;
  ageRange?: AgeRange | null;
  levelRange?: LevelRange | null;
}>;

function slot(
  locationId: SessionRecord["locationId"],
  programId: string,
  hour: number,
  minute: number,
  title: string,
  durationMin = 60,
  details?: Pick<Slot, "description" | "ageRange" | "levelRange">,
): Slot {
  return { programId, locationId, hour, minute, durationMin, title, ...details };
}

const townEvening = [
  slot("town", "prog-kids", 17, 0, "Kids BJJ", 60, {
    description: "Fundamentals for young grapplers: takedowns, escapes and live rolling.",
    ageRange: { minAge: 4, maxAge: 11 },
    levelRange: { fromKey: "w", toKey: "gy", fromName: "White", toName: "Grey" },
  }),
  slot("town", "prog-teens", 18, 0, "Teens BJJ", 60, {
    description: "Gi fundamentals and competition drilling for teenage students.",
    ageRange: { minAge: 12, maxAge: 15 },
    levelRange: { fromKey: "w", toKey: "b", fromName: "White", toName: "Blue" },
  }),
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
  Sat: [
    slot("town", "prog-om", 10, 0, "Open Mat", 90),
    slot("west", "prog-om", 11, 30, "Open Mat", 90),
  ],
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
  const localHour = Number(
    hourFormatter.formatToParts(guess).find((p) => p.type === "hour")?.value ?? hour,
  );
  const offsetHours = (localHour - hour + 24) % 24; // 0 in winter, 1 in summer
  return new Date(guess.getTime() - offsetHours * 3600000);
}

type FixtureSelfCheckInStorage = Readonly<Pick<Storage, "getItem" | "setItem">> &
  Partial<Pick<Storage, "removeItem">>;

export type FixtureCalendarRepositoryOptions = Readonly<{
  /** Only the browser factory supplies storage; direct fixture repositories stay isolated. */
  selfCheckInStorage?: FixtureSelfCheckInStorage;
}>;

const fixtureStoragePrefix = "bpt-jersey.fixture-self-check-in.v1";

/**
 * Stored data is limited to a stable ready-session start or one self-attendance record. Keys are
 * scoped by role/date/student/session for both timing and attendance. The date key is
 * the TTL boundary: entries are never rehydrated for another Jersey date, even if storage retains
 * old keys. Position readings and refused attempts are never written.
 */
function fixtureStorageKey(
  role: CalendarRole,
  dateKey: string,
  scope: string,
  sessionId: string,
): string {
  return `${fixtureStoragePrefix}:${role}:${dateKey}:${scope}:${sessionId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStored(storage: FixtureSelfCheckInStorage | undefined, key: string): unknown {
  if (!storage) return undefined;
  try {
    const value = storage.getItem(key);
    return value === null ? undefined : JSON.parse(value);
  } catch {
    return undefined;
  }
}

function writeStored(
  storage: FixtureSelfCheckInStorage | undefined,
  key: string,
  value: unknown,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Fixture persistence is a browser convenience, never a reason to block check-in.
  }
}

function removeStored(storage: FixtureSelfCheckInStorage | undefined, key: string): void {
  if (!storage?.removeItem) return;
  try {
    storage.removeItem(key);
  } catch {
    // Fixture persistence is a browser convenience, never a reason to block check-in.
  }
}

function readyStartAt(
  storage: FixtureSelfCheckInStorage | undefined,
  role: CalendarRole,
  dateKey: string,
  studentId: string,
  sessionId: string,
  fallback: Date,
): Date {
  const key = fixtureStorageKey(role, dateKey, `${studentId}:timing`, sessionId);
  const stored = readStored(storage, key);
  if (
    isRecord(stored) &&
    stored.version === 1 &&
    typeof stored.startAt === "string" &&
    Number.isFinite(Date.parse(stored.startAt))
  ) {
    if (Date.now() <= Date.parse(stored.startAt) + 20 * 60000) {
      return new Date(stored.startAt);
    }
    removeStored(storage, fixtureStorageKey(role, dateKey, studentId, sessionId));
  }
  writeStored(storage, key, { version: 1, startAt: fallback.toISOString() });
  return fallback;
}

function storedSelfAttendance(
  storage: FixtureSelfCheckInStorage | undefined,
  role: CalendarRole,
  dateKey: string,
  session: SessionRecord,
  studentId: string,
): AttendanceRecord | undefined {
  const stored = readStored(
    storage,
    fixtureStorageKey(role, dateKey, studentId, session.sessionId),
  );
  if (!isRecord(stored) || stored.version !== 1 || !isRecord(stored.attendance)) return undefined;
  const attendance = stored.attendance;
  const proximity = attendance.proximity;
  const distanceMeters = isRecord(proximity) ? proximity.distanceMeters : undefined;
  const accuracyMeters = isRecord(proximity) ? proximity.accuracyMeters : undefined;
  if (
    attendance.attendanceId !== `${session.sessionId}__${studentId}` ||
    attendance.academyId !== academyId ||
    attendance.sessionId !== session.sessionId ||
    attendance.studentId !== studentId ||
    attendance.method !== "self" ||
    (attendance.state !== "attended" && attendance.state !== "late") ||
    typeof attendance.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(attendance.occurredAt)) ||
    attendance.notes !== null ||
    attendance.correctionOf !== null ||
    attendance.schemaVersion !== "1" ||
    typeof attendance.createdAt !== "string" ||
    typeof attendance.createdBy !== "string" ||
    typeof attendance.updatedAt !== "string" ||
    typeof attendance.updatedBy !== "string" ||
    !isRecord(proximity) ||
    proximity.signal !== "within" ||
    typeof distanceMeters !== "number" ||
    !Number.isSafeInteger(distanceMeters) ||
    typeof accuracyMeters !== "number" ||
    !Number.isSafeInteger(accuracyMeters) ||
    proximity.overrideReason !== null
  ) {
    return undefined;
  }
  return {
    attendanceId: attendance.attendanceId,
    academyId: attendance.academyId,
    sessionId: attendance.sessionId,
    studentId: attendance.studentId,
    method: "self",
    state: attendance.state,
    occurredAt: attendance.occurredAt,
    notes: null,
    correctionOf: null,
    proximity: {
      signal: "within",
      distanceMeters,
      accuracyMeters,
      overrideReason: null,
    },
    schemaVersion: "1",
    createdAt: attendance.createdAt,
    createdBy: attendance.createdBy,
    updatedAt: attendance.updatedAt,
    updatedBy: attendance.updatedBy,
  };
}

function saveSelfAttendance(
  storage: FixtureSelfCheckInStorage | undefined,
  role: CalendarRole,
  dateKey: string,
  record: AttendanceRecord,
): void {
  const proximity = record.proximity;
  if (!proximity) return;
  writeStored(storage, fixtureStorageKey(role, dateKey, record.studentId, record.sessionId), {
    version: 1,
    attendance: {
      attendanceId: record.attendanceId,
      academyId: record.academyId,
      sessionId: record.sessionId,
      studentId: record.studentId,
      method: record.method,
      state: record.state,
      occurredAt: record.occurredAt,
      notes: record.notes,
      correctionOf: record.correctionOf,
      proximity: {
        signal: proximity.signal,
        distanceMeters: proximity.distanceMeters,
        accuracyMeters: proximity.accuracyMeters,
        overrideReason: proximity.overrideReason,
      },
      schemaVersion: record.schemaVersion,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
    },
  });
}

function generateSessions(
  now: Date,
  resolveReadyStartAt?: (dateKey: string, sessionId: string, fallback: Date) => Date,
): SessionRecord[] {
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
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        ...(entry.ageRange !== undefined ? { ageRange: entry.ageRange } : {}),
        ...(entry.levelRange !== undefined ? { levelRange: entry.levelRange } : {}),
        ...audit,
      });
    }
  }
  const readyKey = dateKeyInJersey(now);
  const fallbackStartAt = new Date(now.getTime() + 30 * 60000);
  for (const [locationId, programId, title] of [
    ["town", "prog-teens", "Teens BJJ"],
    ["town", "prog-adult", "Adults BJJ"],
    ["west", "prog-kids", "Kids BJJ"],
  ] as const) {
    const sessionId = `${readyKey}_${locationId}_${programId}_ready`;
    const startAt = resolveReadyStartAt?.(readyKey, sessionId, fallbackStartAt) ?? fallbackStartAt;
    const endAt = new Date(startAt.getTime() + 60 * 60000);
    sessions.push({
      sessionId,
      academyId,
      classId: null,
      programId,
      locationId,
      instructorId: "coach-1",
      title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      capacity: 20,
      minParticipants: 4,
      status: "scheduled",
      isSeminar: false,
      cancellationReason: null,
      ...audit,
    });
  }
  return sessions;
}

function bookingFor(session: SessionRecord, p: CalendarParticipant): BookingRecord {
  if (!p.membershipId) throw new Error("An ordinary demo booking requires a membership.");
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

export function createFixtureCalendarRepository(
  role: CalendarRole,
  options: FixtureCalendarRepositoryOptions = {},
): CalendarRepository {
  const member = members[role];
  const now = new Date();
  const sessions = generateSessions(now, (dateKey, sessionId, fallback) => {
    const participant = member.participants.find((candidate) => {
      const usualSlot = usualSlots[candidate.studentId];
      return (
        usualSlot !== undefined && sessionId === `${dateKey}_${usualSlot[1]}_${usualSlot[0]}_ready`
      );
    });
    return participant
      ? readyStartAt(
          options.selfCheckInStorage,
          role,
          dateKey,
          participant.studentId,
          sessionId,
          fallback,
        )
      : fallback;
  });
  const bookings: BookingRecord[] = [];
  const attendance: AttendanceRecord[] = [];
  const bookedCounts: Record<string, number> = {};
  const penalties: NoShowPenaltyRecord[] = [];

  const isPast = (s: SessionRecord) => Date.parse(s.endAt) < now.getTime();
  const isUpcoming = (s: SessionRecord) => Date.parse(s.startAt) > now.getTime() + 2 * 3600000;

  function seedFor(
    p: CalendarParticipant,
    programId: string,
    locationId: SessionRecord["locationId"],
  ): void {
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
    const ready = mine.find((session) => session.sessionId.endsWith("_ready"));
    if (ready) bookings.push(bookingFor(ready, p));
    if (afterNext && afterNext.capacity !== null)
      bookedCounts[afterNext.sessionId] = afterNext.capacity;
  }

  for (const participant of member.participants) {
    const usualSlot = usualSlots[participant.studentId];
    if (usualSlot) seedFor(participant, usualSlot[0], usualSlot[1]);
  }

  for (const booking of bookings) {
    const session = sessions.find((candidate) => candidate.sessionId === booking.sessionId);
    if (!session || !session.sessionId.endsWith("_ready")) continue;
    const dateKey = session.sessionId.split("_")[0];
    if (!dateKey) continue;
    const persistenceKey = fixtureStorageKey(role, dateKey, booking.studentId, session.sessionId);
    const restored = storedSelfAttendance(
      options.selfCheckInStorage,
      role,
      dateKey,
      session,
      booking.studentId,
    );
    if (!restored) continue;
    if (Date.parse(restored.occurredAt) < Date.parse(session.startAt) - 60 * 60000) {
      removeStored(options.selfCheckInStorage, persistenceKey);
      continue;
    }
    attendance.push(restored);
  }

  const mayaMissed = attendance.find((a) => a.studentId === "maya" && a.state === "no_show");
  const penaltySession = sessions.find((s) => s.sessionId === mayaMissed?.sessionId);
  if (mayaMissed && penaltySession) {
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

  const participantFor = (studentId: string) =>
    member.participants.find((participant) => participant.studentId === studentId);

  return {
    async loadMember() {
      return member;
    },
    async loadWeek(studentId, fromIso, toIso): Promise<CalendarWeekData> {
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      const inRange = sessions.filter((s) => {
        const t = Date.parse(s.startAt);
        return t >= from && t < to;
      });
      const ids = new Set(inRange.map((s) => s.sessionId));
      const isMemberParticipant = participantFor(studentId) !== undefined;
      return {
        sessions: inRange,
        programs,
        bookings: isMemberParticipant
          ? bookings.filter((b) => b.studentId === studentId && ids.has(b.sessionId))
          : [],
        attendance: isMemberParticipant
          ? attendance.filter((a) => a.studentId === studentId && ids.has(a.sessionId))
          : [],
        bookedCounts: { ...bookedCounts },
      };
    },
    async book(input) {
      const session = sessions.find((s) => s.sessionId === input.sessionId);
      if (!session) throw failure("functions/not-found");
      if (session.capacity !== null && (bookedCounts[session.sessionId] ?? 0) >= session.capacity) {
        throw failure("functions/failed-precondition", "capacity");
      }
      const participant = participantFor(input.studentId);
      if (!participant) throw failure("functions/not-found");
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
    async bookEligible(input) {
      const participant = participantFor(input.studentId);
      if (!participant || participant.membershipId !== input.membershipId) {
        throw failure("functions/failed-precondition", "membership");
      }
      const from = Date.parse(input.from);
      const to = Date.parse(input.to);
      const eligible = sessions
        .filter((session) => {
          const start = Date.parse(session.startAt);
          const program = programs.find((candidate) => candidate.programId === session.programId);
          const site = session.locationId === "town" ? "Town" : "West";
          const coveredSites =
            program?.discipline === "open-mat"
              ? participant.planOpenMatSites
              : participant.planClassSites;
          return (
            start >= from &&
            start <= to &&
            session.status === "scheduled" &&
            !session.courseId &&
            coveredSites.includes(site)
          );
        })
        .sort((left, right) => left.startAt.localeCompare(right.startAt));
      const created: BookingRecord[] = [];
      let alreadyBookedCount = 0;
      let skippedCount = 0;
      for (const session of eligible) {
        const existing = bookings.find(
          (booking) =>
            booking.sessionId === session.sessionId && booking.studentId === input.studentId,
        );
        if (existing?.status === "confirmed") {
          alreadyBookedCount += 1;
          continue;
        }
        if (
          session.capacity !== null &&
          (bookedCounts[session.sessionId] ?? 0) >= session.capacity
        ) {
          skippedCount += 1;
          continue;
        }
        const record: BookingRecord = {
          ...(existing ?? bookingFor(session, participant)),
          status: "confirmed",
          cancelledAt: null,
          cancellationReason: null,
          requestedAt: new Date().toISOString(),
        };
        replaceBooking(existing, record);
        created.push(record);
      }
      return {
        booked: created,
        bookedCount: created.length,
        alreadyBookedCount,
        skippedCount,
        limited: false,
      };
    },
    async clockIn(input) {
      const session = sessions.find((candidate) => candidate.sessionId === input.sessionId);
      if (!session) throw failure("functions/not-found");
      const participant = participantFor(input.studentId);
      const booked = bookings.some(
        (booking) =>
          booking.sessionId === input.sessionId &&
          booking.studentId === input.studentId &&
          booking.status === "confirmed",
      );
      if (!participant || !booked) throw failure("functions/failed-precondition", "not_booked");
      const existing = attendance.find(
        (record) => record.sessionId === input.sessionId && record.studentId === input.studentId,
      );
      if (existing) {
        if (existing.method === "self") return existing;
        throw failure("functions/failed-precondition", "already_checked_in");
      }
      const nowIso = new Date().toISOString();
      const decision = decideSelfCheckIn({
        session,
        isOpenMat: isOpenMatProgram(
          programs.find((program) => program.programId === session.programId),
        ),
        site: sites[session.locationId],
        position: input.position,
        nowMs: Date.parse(nowIso),
      });
      if (!decision.ok) {
        throw Object.assign(new Error("functions/failed-precondition"), {
          code: "functions/failed-precondition",
          details: decision.error,
        });
      }
      const record: AttendanceRecord = {
        ...attendanceFor(session, participant, determinePunctuality(session.startAt, nowIso)),
        method: "self",
        occurredAt: nowIso,
        proximity: decision.value,
      };
      attendance.push(record);
      const dateKey = session.sessionId.split("_")[0];
      if (dateKey) saveSelfAttendance(options.selfCheckInStorage, role, dateKey, record);
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
      return participantFor(studentId) ? penalties.filter((p) => p.studentId === studentId) : [];
    },
  };
}
