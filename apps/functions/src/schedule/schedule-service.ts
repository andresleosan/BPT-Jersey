import { readCanonicalMemberHistoryDocuments } from "../members/member-identity-firestore.js";
import { ensureCourseBooking } from "../courses/course-access.js";
import { filterPublishedCourseSessions } from "../courses/course-publication.js";
import type { Firestore } from "firebase-admin/firestore";
import {
  createWeeklySessionStore,
  newWeeklySeries,
  weeklyOccurrence,
  weeklyOccurrences,
  reviseWeeklySeries,
  reviseWeeklySession,
  type WeeklySeries,
} from "./weekly-session-service.js";
import {
  buildDailyOperationsDashboard,
  buildAttendanceId,
  buildBookingId,
  buildBookingIdCandidates,
  buildCheckoutId,
  buildCorrectionAttendanceId,
  buildSessionOperationalView,
  determinePunctuality,
  generateSessionsFromClass,
  decideQuorumSweep,
  isWithinBookingCutoff,
  quorumCancellationReason,
  resolveCheckInProximity,
  type AttendanceRecord,
  type DailyOperationsDashboard,
  type BookingRecord,
  type CancelBookingInput,
  type CheckInInput,
  type CheckoutRecord,
  type ClassRecord,
  type CorrectAttendanceInput,
  type CreateClassInput,
  type CreateProgramInput,
  type CreateSessionInput,
  type ListSessionsQuery,
  type LocationRecord,
  type SaveLocationGeofenceInput,
  type ProgramRecord,
  type RecordCheckoutInput,
  type RequestBookingInput,
  type SessionOperationalView,
  type SessionRecord,
  type UpdateClassInput,
  type UpdateSessionInput,
  normalizeClassRecord,
  legacySessionId,
} from "@bpt-jersey/domain/schedule";
import {
  decideSelfCheckIn,
  isOpenMatProgram,
  type SelfCheckInInput,
} from "@bpt-jersey/domain/schedule/self-check-in";
import {
  programDefaultsV2,
  shiftIsoInZone,
  slugifyLocationId,
  weekRangeFor,
  type CopyWeekInput,
  type CreateLocationInput,
  type CreateProgramInputV2,
  type DeleteWeekInput,
  type UpdateLocationInput,
  type UpdateProgramInput,
  type WeekPreview,
} from "@bpt-jersey/domain/schedule/classes-services";

import {
  BookingTransactionError,
  createBookingTransactionService,
  type BookingAuditActor,
  type BookingFirestore,
} from "./booking-transaction-service.js";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import {
  createQuorumSweepService,
  SessionQuorumSweepError,
  type SessionQuorumSweepResult,
} from "./quorum-sweep-service.js";
import {
  createTransactionalAttendanceService,
  ScheduleAttendanceError,
  SelfCheckInRefusedError,
  type AttendanceFirestore,
  type ScheduleMutationActorRole,
} from "./attendance-transaction-service.js";

export const defaultLocations: readonly LocationRecord[] = Object.freeze([
  {
    locationId: "town",
    academyId: "default",
    name: "BPT Town",
    address: "St Helier, Jersey",
    timezone: "Europe/Jersey",
    active: true,
    schemaVersion: "1",
  },
  {
    locationId: "west",
    academyId: "default",
    name: "BPT West",
    address: "St Peter, Jersey",
    timezone: "Europe/Jersey",
    active: true,
    schemaVersion: "1",
  },
]);

export const defaultPrograms: readonly ProgramRecord[] = Object.freeze([
  {
    programId: "kids-bjj-4-7",
    academyId: "default",
    name: "Kids BJJ (4-7 yrs)",
    ageBand: "kids",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "kids-bjj-8-11",
    academyId: "default",
    name: "Kids BJJ (8-11 yrs)",
    ageBand: "kids",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "teens-bjj",
    academyId: "default",
    name: "Teens BJJ (12-15 yrs)",
    ageBand: "teens",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "adult-fundamentals",
    academyId: "default",
    name: "Adult BJJ Fundamentals",
    ageBand: "adult",
    discipline: "bjj",
    level: "fundamentals",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "adult-advanced",
    academyId: "default",
    name: "Adult BJJ Advanced",
    ageBand: "adult",
    discipline: "bjj",
    level: "advanced",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "open-mat",
    academyId: "default",
    name: "Open Mat",
    ageBand: "all",
    discipline: "open-mat",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
  {
    programId: "seminar",
    academyId: "default",
    name: "Special Seminar / Workshop",
    ageBand: "all",
    discipline: "bjj",
    level: "all-levels",
    active: true,
    schemaVersion: "1",
  },
]);

export type ScheduleStore = Readonly<{
  listLocations: (academyId: string) => Promise<readonly LocationRecord[]>;
  saveLocationGeofence: (
    academyId: string,
    input: SaveLocationGeofenceInput,
    actorId: string,
  ) => Promise<LocationRecord>;
  reconcileSessionQuorum: (
    academyId: string,
    sessionId: string,
    actorId: string,
    now?: string,
  ) => Promise<SessionQuorumSweepResult>;
  listCancelledSessionsForStudent: (
    academyId: string,
    studentId: string,
    now?: string,
  ) => Promise<readonly Readonly<{ title: string; startAt: string; reason: string }>[]>;
  createLocation: (
    academyId: string,
    input: CreateLocationInput,
    actorId: string,
  ) => Promise<LocationRecord>;
  updateLocation: (
    academyId: string,
    input: UpdateLocationInput,
    actorId: string,
  ) => Promise<LocationRecord>;
  listPrograms: (academyId: string) => Promise<readonly ProgramRecord[]>;
  createProgram: (academyId: string, input: CreateProgramInput) => Promise<ProgramRecord>;
  updateProgram: (
    academyId: string,
    programId: string,
    input: Partial<CreateProgramInput & { active: boolean }>,
  ) => Promise<ProgramRecord>;
  createProgramV2: (academyId: string, input: CreateProgramInputV2) => Promise<ProgramRecord>;
  updateProgramV2: (academyId: string, input: UpdateProgramInput) => Promise<ProgramRecord>;
  listClasses: (academyId: string) => Promise<readonly ClassRecord[]>;
  getClass: (academyId: string, classId: string) => Promise<ClassRecord | null>;
  createClass: (
    academyId: string,
    input: CreateClassInput,
    actorId: string,
  ) => Promise<ClassRecord>;
  updateClass: (
    academyId: string,
    input: UpdateClassInput,
    actorId: string,
  ) => Promise<ClassRecord>;
  updateSession: (
    academyId: string,
    input: UpdateSessionInput,
    actorId: string,
    allowHistorical?: boolean,
  ) => Promise<SessionRecord>;
  removeClass: (
    academyId: string,
    classId: string,
    reason: string,
    actorId: string,
    nowIso: string,
  ) => Promise<Readonly<{ class: ClassRecord; cancelledSessions: readonly SessionRecord[] }>>;
  countConfirmedBookings: (
    academyId: string,
    sessionIds: readonly string[],
  ) => Promise<Readonly<Record<string, number>>>;
  generateSessions: (
    academyId: string,
    classId: string,
    fromDate: string,
    toDate: string,
    timezone: string,
    actorId: string,
  ) => Promise<readonly SessionRecord[]>;
  listSessions: (academyId: string, query: ListSessionsQuery) => Promise<readonly SessionRecord[]>;
  previewWeek: (academyId: string, weekStart: string, timezone: string) => Promise<WeekPreview>;
  copyWeek: (
    academyId: string,
    input: CopyWeekInput,
    timezone: string,
    actorId: string,
  ) => Promise<readonly SessionRecord[]>;
  deleteWeek: (
    academyId: string,
    input: DeleteWeekInput,
    timezone: string,
    actorId: string,
  ) => Promise<readonly SessionRecord[]>;
  getSession: (academyId: string, sessionId: string) => Promise<SessionRecord | null>;
  createSession: (
    academyId: string,
    input: CreateSessionInput,
    actorId: string,
  ) => Promise<SessionRecord>;
  cancelSession: (
    academyId: string,
    sessionId: string,
    reason: string,
    actorId: string,
  ) => Promise<SessionRecord>;
  requestBooking: (
    academyId: string,
    input: RequestBookingInput,
    actorId: string,
    auditActor?: BookingAuditActor,
  ) => Promise<BookingRecord>;
  cancelBooking: (
    academyId: string,
    input: CancelBookingInput,
    actorId: string,
    isStaffOverride?: boolean,
    auditActor?: BookingAuditActor,
  ) => Promise<BookingRecord>;
  listSessionBookings: (academyId: string, sessionId: string) => Promise<readonly BookingRecord[]>;
  listStudentBookings: (academyId: string, studentId: string) => Promise<readonly BookingRecord[]>;
  evaluateSessionMinimum: (
    academyId: string,
    sessionId: string,
  ) => Promise<{ confirmedCount: number; minParticipants: number; quorumMet: boolean }>;
  recordCheckIn: (
    academyId: string,
    input: CheckInInput,
    actorId: string,
    occurredAt?: string,
    actorRole?: ScheduleMutationActorRole,
    actorIp?: string | null,
  ) => Promise<AttendanceRecord>;
  recordSelfCheckIn: (
    academyId: string,
    input: SelfCheckInInput,
    actorId: string,
    occurredAt?: string,
    actorRole?: ScheduleMutationActorRole,
    actorIp?: string | null,
  ) => Promise<AttendanceRecord>;
  listSessionAttendance: (
    academyId: string,
    sessionId: string,
  ) => Promise<readonly AttendanceRecord[]>;
  listStudentAttendance: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly AttendanceRecord[]>;
  correctAttendance: (
    academyId: string,
    input: CorrectAttendanceInput,
    actorId: string,
    occurredAt?: string,
    actorRole?: ScheduleMutationActorRole,
    actorIp?: string | null,
  ) => Promise<{ correction: AttendanceRecord; canonical: AttendanceRecord }>;
  reconcileSessionNoShows: (
    academyId: string,
    sessionId: string,
    actorId: string,
    occurredAt?: string,
  ) => Promise<{ noShowsMarked: number; records: readonly AttendanceRecord[] }>;
  listAttendanceHistory: (
    academyId: string,
    sessionId: string,
    studentId: string,
  ) => Promise<readonly AttendanceRecord[]>;
  recordCheckout: (
    academyId: string,
    input: RecordCheckoutInput,
    actorId: string,
    occurredAt?: string,
    actorRole?: ScheduleMutationActorRole,
    actorIp?: string | null,
  ) => Promise<CheckoutRecord>;
  listSessionCheckouts: (
    academyId: string,
    sessionId: string,
  ) => Promise<readonly CheckoutRecord[]>;
  getStudentCheckout: (
    academyId: string,
    sessionId: string,
    studentId: string,
  ) => Promise<CheckoutRecord | null>;
  getSessionOperationalView: (
    academyId: string,
    sessionId: string,
  ) => Promise<SessionOperationalView>;
  getDailyOperationsDashboard: (
    academyId: string,
    query: ListSessionsQuery,
  ) => Promise<DailyOperationsDashboard>;
}>;

type GenericQuery = {
  get: () => Promise<{
    docs: Array<{
      id: string;
      data: () => Record<string, unknown>;
      ref: { set: (data: unknown) => Promise<unknown> };
    }>;
  }>;
  where: (field: string, op: string, val: unknown) => GenericQuery;
};

type GenericFirestore = {
  collection: (path: string) => {
    doc: (id?: string) => {
      id: string;
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      set: (data: unknown) => Promise<unknown>;
      update: (data: unknown) => Promise<unknown>;
    };
    get: () => Promise<{
      docs: Array<{
        id: string;
        data: () => Record<string, unknown>;
      }>;
    }>;
    where: (field: string, op: string, val: unknown) => GenericQuery;
  };
};

/**
 * How far back and forward a member is told about a cancelled class of theirs. A class that was off
 * last week is no longer news; one that has not happened yet is (T110).
 */
const cancelledSessionNoticeWindowMs = Object.freeze({
  past: 2 * 86_400_000,
  ahead: 30 * 86_400_000,
});

/**
 * A member is told about a class of theirs that the academy called off: their booking is still
 * confirmed, or it was released by the same cancellation. A member who cancelled their own booking
 * for their own reasons is not told, because for them nothing changed.
 */
function cancelledSessionNotices(
  sessions: readonly SessionRecord[],
  bookings: readonly Readonly<{
    sessionId: string;
    status: string;
    cancellationReason: string | null;
  }>[],
  nowMs: number,
): readonly Readonly<{ title: string; startAt: string; reason: string }>[] {
  const bookingsBySession = new Map<string, (typeof bookings)[number]>();
  for (const booking of bookings) {
    const current = bookingsBySession.get(booking.sessionId);
    // A confirmed booking outranks a cancelled one for the same class.
    if (
      current === undefined ||
      (current.status !== "confirmed" && booking.status === "confirmed")
    ) {
      bookingsBySession.set(booking.sessionId, booking);
    }
  }

  return Object.freeze(
    sessions
      .filter((session) => {
        if (session.status !== "cancelled") return false;
        const booking = bookingsBySession.get(session.sessionId);
        if (booking === undefined) return false;
        if (
          booking.status !== "confirmed" &&
          booking.cancellationReason !== session.cancellationReason
        ) {
          return false;
        }
        const startMs = Date.parse(session.startAt);
        if (Number.isNaN(startMs)) return false;
        return (
          startMs >= nowMs - cancelledSessionNoticeWindowMs.past &&
          startMs <= nowMs + cancelledSessionNoticeWindowMs.ahead
        );
      })
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))
      .map((session) =>
        Object.freeze({
          title: session.title,
          startAt: session.startAt,
          reason: session.cancellationReason ?? "The class was cancelled by the academy.",
        }),
      ),
  );
}

function mergeSessionUpdate(
  current: SessionRecord,
  input: UpdateSessionInput,
  actorId: string,
  now: string,
): SessionRecord {
  const startAt = input.startAt ?? current.startAt;
  const endAt = input.endAt ?? current.endAt;
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("Session must end after it starts");
  const capacity = input.capacity === undefined ? current.capacity : input.capacity;
  const minParticipants = input.minParticipants ?? current.minParticipants;
  if (capacity !== null && minParticipants > capacity)
    throw new Error("Session minimum participants cannot exceed capacity");
  return Object.freeze({
    ...current,
    title: input.title ?? current.title,
    locationId: input.locationId ?? current.locationId,
    programId: input.programId ?? current.programId,
    instructorId: input.instructorId ?? input.instructorIds?.[0] ?? current.instructorId,
    startAt,
    endAt,
    capacity,
    minParticipants,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.instructorIds !== undefined ? { instructorIds: input.instructorIds } : {}),
    ...(input.bookingRules !== undefined ? { bookingRules: input.bookingRules } : {}),
    ...(input.waitingList !== undefined ? { waitingList: input.waitingList } : {}),
    updatedAt: now,
    updatedBy: actorId,
  });
}

/** A new site keeps the academy timezone; only Jersey sites exist today (ADR-009 scope). */
const createdLocationTimezone = "Europe/Jersey";

/** How many sessions the copy/delete confirmation shows before it just gives the count. */
const weekPreviewSampleSize = 10;

/**
 * The catalogue order both stores answer with: the canonical sites first, in their canonical
 * order, then everything the academy created, by id. Firestore hands documents back in id order
 * and the in-memory store in creation order, and a screen must not depend on which store it hit.
 */
function orderLocations(locations: readonly LocationRecord[]): readonly LocationRecord[] {
  const canonical = new Map(defaultLocations.map((site, index) => [site.locationId, index]));
  const rank = (site: LocationRecord) => canonical.get(site.locationId) ?? defaultLocations.length;
  return [...locations].sort(
    (left, right) => rank(left) - rank(right) || left.locationId.localeCompare(right.locationId),
  );
}

/** `name` slugified, with `-2`, `-3`… appended until it no longer collides with an existing site. */
function nextLocationId(name: string, taken: ReadonlySet<string>): string {
  const base = slugifyLocationId(name);
  let locationId = base;
  for (let suffix = 2; taken.has(locationId); suffix += 1) locationId = `${base}-${suffix}`;
  return locationId;
}

function buildLocationRecord(
  academyId: string,
  locationId: string,
  input: CreateLocationInput,
): LocationRecord {
  return Object.freeze({
    locationId,
    academyId,
    name: input.name,
    address: "",
    timezone: createdLocationTimezone,
    active: true,
    abbreviation: input.abbreviation,
    kind: input.kind,
    schemaVersion: "1",
  });
}

function mergeLocationUpdate(current: LocationRecord, input: UpdateLocationInput): LocationRecord {
  return Object.freeze({
    ...current,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.abbreviation !== undefined ? { abbreviation: input.abbreviation } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  });
}

/**
 * A type created in the Classes / Services screen carries no age band, discipline or level: the
 * screen edits the v2 fields only, so the v1 taxonomy takes its widest value.
 */
function buildProgramV2(
  programId: string,
  academyId: string,
  input: CreateProgramInputV2,
): ProgramRecord {
  return Object.freeze({
    programId,
    academyId,
    name: input.name,
    ageBand: "all",
    discipline: "bjj",
    level: "all-levels",
    ...programDefaultsV2,
    abbreviation: input.abbreviation,
    active: true,
    schemaVersion: "1",
  });
}

function mergeProgramV2(current: ProgramRecord, input: UpdateProgramInput): ProgramRecord {
  return Object.freeze({
    ...current,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
    ...(input.abbreviation !== undefined ? { abbreviation: input.abbreviation } : {}),
    ...(input.colour !== undefined ? { colour: input.colour } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.dropInPolicy !== undefined ? { dropInPolicy: input.dropInPolicy } : {}),
    ...(input.notifyByEmail !== undefined ? { notifyByEmail: input.notifyByEmail } : {}),
    ...(input.showInList !== undefined ? { showInList: input.showInList } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
  });
}

/**
 * The booking rules turning a place down — no room, no credit, not entitled — is an answer about
 * that one member, and the rest of the week still copies. Anything else (a broken transaction, an
 * unreachable store) is a failure of the copy itself and must not be swallowed.
 */
const uncopyableBookingCodes: readonly string[] = [
  "capacity",
  "capacity-not-set",
  "financial",
  "ineligible",
  "weekly-limit",
];

function refusedByBookingRules(error: unknown): boolean {
  return error instanceof BookingTransactionError && uncopyableBookingCodes.includes(error.code);
}

/**
 * The week-wide operations are written once against the store surface they need, so the Firestore
 * and in-memory stores answer identically and the timezone stays the caller's decision.
 */
type WeekOperationsStore = Pick<
  ScheduleStore,
  "cancelSession" | "createSession" | "listSessionBookings" | "listSessions" | "requestBooking"
>;

function weekRangeOrThrow(weekStart: string, timezone: string): ListSessionsQuery {
  const range = weekRangeFor(weekStart, timezone);
  if (!range.ok) throw new Error(range.error);
  return range.value;
}

function liveSessions(sessions: readonly SessionRecord[]): readonly SessionRecord[] {
  return sessions.filter(
    (session) => session.status === "scheduled" || session.status === "active",
  );
}

async function previewWeekWith(
  store: WeekOperationsStore,
  academyId: string,
  weekStart: string,
  timezone: string,
): Promise<WeekPreview> {
  const sessions = liveSessions(
    await store.listSessions(academyId, weekRangeOrThrow(weekStart, timezone)),
  );
  return Object.freeze({
    count: sessions.length,
    sample: Object.freeze(
      sessions.slice(0, weekPreviewSampleSize).map((session) =>
        Object.freeze({
          sessionId: session.sessionId,
          title: session.title,
          startAt: session.startAt,
        }),
      ),
    ),
  });
}

async function copyWeekWith(
  store: WeekOperationsStore,
  academyId: string,
  input: CopyWeekInput,
  timezone: string,
  actorId: string,
): Promise<readonly SessionRecord[]> {
  const from = weekRangeOrThrow(input.fromWeekStart, timezone);
  const to = weekRangeOrThrow(input.toWeekStart, timezone);
  // Calendar days between the two Mondays; a clock change makes the two ranges differ by an hour,
  // which is exactly what `shiftIsoInZone` then puts back.
  const days = Math.round(
    (Date.parse(`${input.toWeekStart}T00:00:00.000Z`) -
      Date.parse(`${input.fromWeekStart}T00:00:00.000Z`)) /
      86_400_000,
  );
  // The same predicate as the preview: what the operator was shown is what gets copied.
  const source = liveSessions(await store.listSessions(academyId, from)).filter(session => !session.courseId);
  if (source.some((session) => session.capacity === null)) {
    throw new Error("Every session in the source week needs a capacity before it can be copied");
  }
  // Only a live session occupies a slot: a week that was deleted must be refillable.
  const target = liveSessions(await store.listSessions(academyId, to));
  const created: SessionRecord[] = [];

  for (const session of source) {
    const startAt = shiftIsoInZone(session.startAt, days, timezone);
    // ponytail: copying the same week twice must add nothing, or a misclick doubles the timetable.
    const alreadyThere = target.some(
      (existing) =>
        existing.programId === session.programId &&
        existing.locationId === session.locationId &&
        existing.startAt === startAt,
    );
    if (alreadyThere) continue;

    const copy = await store.createSession(
      academyId,
      {
        classId: null,
        programId: session.programId,
        locationId: session.locationId,
        instructorId: session.instructorId,
        title: session.title,
        startAt,
        endAt: shiftIsoInZone(session.endAt, days, timezone),
        // checked above: no source session is uncapped
        capacity: session.capacity as number,
        minParticipants: session.minParticipants,
        isSeminar: session.isSeminar,
        ...(session.description !== undefined ? { description: session.description } : {}),
        ...(session.ageRange !== undefined ? { ageRange: session.ageRange } : {}),
        ...(session.levelRange !== undefined ? { levelRange: session.levelRange } : {}),
        ...(session.instructorIds !== undefined ? { instructorIds: session.instructorIds } : {}),
        ...(session.bookingRules !== undefined ? { bookingRules: session.bookingRules } : {}),
        ...(session.waitingList !== undefined ? { waitingList: session.waitingList } : {}),
      },
      actorId,
    );
    created.push(copy);
    if (!input.copyBookings) continue;

    for (const booking of await store.listSessionBookings(academyId, session.sessionId)) {
      if (booking.status !== "confirmed" || booking.membershipId === null) continue;
      try {
        await store.requestBooking(
          academyId,
          {
            sessionId: copy.sessionId,
            studentId: booking.studentId,
            membershipId: booking.membershipId,
          },
          actorId,
        );
      } catch (error) {
        // ponytail: a place the member is no longer entitled to does not travel with them; a
        // store that is simply broken must still stop the copy.
        if (!refusedByBookingRules(error)) throw error;
      }
    }
  }

  return Object.freeze(created);
}

async function deleteWeekWith(
  store: WeekOperationsStore,
  academyId: string,
  input: DeleteWeekInput,
  timezone: string,
  actorId: string,
): Promise<readonly SessionRecord[]> {
  const sessions = liveSessions(
    await store.listSessions(academyId, weekRangeOrThrow(input.weekStart, timezone)),
  );
  const cancelled: SessionRecord[] = [];
  for (const session of sessions) {
    cancelled.push(await store.cancelSession(academyId, session.sessionId, input.reason, actorId));
  }
  return Object.freeze(cancelled);
}

export function createFirestoreScheduleStore(options: {
  firestore: GenericFirestore;
}): ScheduleStore {
  const { firestore } = options;
  const weekly = createWeeklySessionStore(firestore as unknown as Firestore);
  const bookingTransactions = createBookingTransactionService({
    firestore: firestore as unknown as BookingFirestore,
  });
  const attendanceTransactions = createTransactionalAttendanceService({
    firestore: firestore as unknown as AttendanceFirestore,
  });
  const quorumSweep = createQuorumSweepService({
    firestore: firestore as unknown as BookingFirestore,
  });

  /**
   * `listPrograms` falls back to the canonical seven only while the collection is empty, so the
   * first written type would otherwise hide the rest. Writing them once keeps the list whole.
   */
  const materialiseDefaultPrograms = async (academyId: string): Promise<void> => {
    const collection = firestore.collection(`academies/${academyId}/programs`);
    const snapshot = await collection.get();
    if (snapshot.docs.length > 0) return;
    await Promise.all(
      defaultPrograms.map((program) =>
        collection.doc(program.programId).set({ ...program, academyId }),
      ),
    );
  };

  const requireAttendanceActorRole = (
    value: ScheduleMutationActorRole | undefined,
  ): ScheduleMutationActorRole => {
    if (value === undefined) {
      throw new ScheduleAttendanceError("credential", "Attendance mutation authority is required");
    }
    return value;
  };

  return {
    async listLocations(academyId: string): Promise<readonly LocationRecord[]> {
      const snapshot = await firestore.collection(`academies/${academyId}/locations`).get();

      // Stored documents override the canonical defaults site by site. Nothing else seeds this
      // collection, so recording one site's coordinates (T109) must not make the other vanish.
      const stored = new Map(
        snapshot.docs.map((doc) => {
          const record = doc.data() as LocationRecord;
          return [record.locationId, record] as const;
        }),
      );
      const canonical = defaultLocations.map(
        (location) => stored.get(location.locationId) ?? { ...location, academyId },
      );
      // Sites created in the Classes / Services screen are not among the canonical two, and would
      // otherwise be written and never listed again.
      const created = [...stored.values()].filter(
        (location) =>
          !defaultLocations.some((fallback) => fallback.locationId === location.locationId),
      );
      return orderLocations([...canonical, ...created]);
    },

    async createLocation(academyId: string, input: CreateLocationInput): Promise<LocationRecord> {
      const taken = new Set((await this.listLocations(academyId)).map((l) => l.locationId));
      const record = buildLocationRecord(academyId, nextLocationId(input.name, taken), input);
      await firestore
        .collection(`academies/${academyId}/locations`)
        .doc(record.locationId)
        .set(record);
      return record;
    },

    async updateLocation(academyId: string, input: UpdateLocationInput): Promise<LocationRecord> {
      const docRef = firestore.collection(`academies/${academyId}/locations`).doc(input.locationId);
      const existing = await docRef.get();
      const fallback = defaultLocations.find(
        (location) => location.locationId === input.locationId,
      );
      // A canonical site has no document until something edits it, so materialise it first.
      const current = existing.exists
        ? (existing.data() as LocationRecord)
        : fallback && { ...fallback, academyId };
      if (current === undefined) throw new Error(`Location ${input.locationId} does not exist`);
      const updated = mergeLocationUpdate(current, input);
      await docRef.set(updated);
      return updated;
    },

    /**
     * Records or clears the coordinates of one academy site, which is what makes the 50 m check-in
     * eligibility signal answerable at all (T109). The write and its audit event commit together,
     * and clearing the coordinates returns later check-ins to an honest `unavailable`.
     */
    async saveLocationGeofence(
      academyId: string,
      input: SaveLocationGeofenceInput,
      actorId: string,
    ): Promise<LocationRecord> {
      const transactional = firestore as unknown as AttendanceFirestore;
      const locationRef = transactional.doc(`academies/${academyId}/locations/${input.locationId}`);
      const occurredAt = new Date().toISOString();
      const auditRef = transactional.doc(
        `academies/${academyId}/auditEvents/location-geofence-${input.locationId}-` +
          occurredAt.replaceAll(/[^0-9]/gu, ""),
      );
      const fallback = defaultLocations.find(
        (location) => location.locationId === input.locationId,
      );
      if (fallback === undefined) {
        throw new Error(`Location ${input.locationId} is not an academy site`);
      }

      return transactional.runTransaction(async (transaction) => {
        const existing = await transaction.get(locationRef);
        const current = (existing.exists ? existing.data() : undefined) as
          LocationRecord | undefined;
        const record: LocationRecord = Object.freeze({
          ...(current ?? { ...fallback, academyId }),
          locationId: input.locationId,
          academyId,
          geofence: input.geofence,
          schemaVersion: "1",
        });
        transaction.set(locationRef, record as unknown as Record<string, unknown>);
        appendAuditEventInTransaction(transaction, auditRef, {
          academyId,
          actorId,
          action: "location.geofence.saved",
          targetRef: `academies/${academyId}/locations/${input.locationId}`,
          purpose: "schedule-location-geofence",
          correlationId: `geofence-${input.locationId}`,
        } as AuditEventDraft);
        return record;
      });
    },

    /** T110: cancels one session that never reached its minimum and releases its bookings. */
    reconcileSessionQuorum(
      academyId: string,
      sessionId: string,
      actorId: string,
      now?: string,
    ): Promise<SessionQuorumSweepResult> {
      return quorumSweep.reconcileSessionQuorum({
        academyId,
        sessionId,
        actorId,
        ...(now === undefined ? {} : { now }),
      });
    },

    /**
     * T110: the classes this student had booked and that are cancelled, in the notice window. The
     * in-app notice is derived from the canonical session, not from a queue of messages.
     */
    async listCancelledSessionsForStudent(
      academyId: string,
      studentId: string,
      now?: string,
    ): Promise<readonly Readonly<{ title: string; startAt: string; reason: string }>[]> {
      const bookings = await readCanonicalMemberHistoryDocuments(firestore as unknown as Firestore, academyId, studentId, "bookings");
      const studentBookings = bookings.docs
        .map((document) => document.data() as BookingRecord)
        .filter((booking) => typeof booking.sessionId === "string");
      if (studentBookings.length === 0) return Object.freeze([]);

      const sessionIds = [...new Set(studentBookings.map((booking) => booking.sessionId))];
      const sessions = await Promise.all(sessionIds.map((id) => firestore.collection(`academies/${academyId}/sessions`).doc(id).get()));
      const sessionRecords = sessions.flatMap((document, index) => {
        if (!document.exists) return [];
        const record = document.data() as SessionRecord;
        if (record.academyId !== academyId || record.sessionId !== sessionIds[index]) throw new Error("Session scope is invalid");
        return [record];
      });
      return cancelledSessionNotices(
        sessionRecords,
        studentBookings,
        Date.parse(now ?? new Date().toISOString()),
      );
    },

    async listPrograms(academyId: string): Promise<readonly ProgramRecord[]> {
      const snapshot = await firestore.collection(`academies/${academyId}/programs`).get();

      if (snapshot.docs.length === 0) {
        return defaultPrograms.map((prog) => ({ ...prog, academyId }));
      }

      return snapshot.docs.map((doc) => doc.data() as ProgramRecord);
    },

    async createProgram(academyId: string, input: CreateProgramInput): Promise<ProgramRecord> {
      const docRef = firestore.collection(`academies/${academyId}/programs`).doc();
      const programId = docRef.id;

      const record: ProgramRecord = Object.freeze({
        programId,
        academyId,
        name: input.name,
        ageBand: input.ageBand,
        discipline: input.discipline,
        level: input.level,
        active: true,
        schemaVersion: "1",
      });

      await docRef.set(record);
      return record;
    },

    async updateProgram(
      academyId: string,
      programId: string,
      input: Partial<CreateProgramInput & { active: boolean }>,
    ): Promise<ProgramRecord> {
      const docRef = firestore.collection(`academies/${academyId}/programs`).doc(programId);
      const existing = await docRef.get();

      if (!existing.exists) {
        throw new Error(`Program ${programId} does not exist`);
      }

      const current = existing.data() as ProgramRecord;
      const updated: ProgramRecord = Object.freeze({
        ...current,
        name: input.name ?? current.name,
        ageBand: input.ageBand ?? current.ageBand,
        discipline: input.discipline ?? current.discipline,
        level: input.level ?? current.level,
        active: input.active ?? current.active,
      });

      await docRef.set(updated);
      return updated;
    },

    async createProgramV2(academyId: string, input: CreateProgramInputV2): Promise<ProgramRecord> {
      await materialiseDefaultPrograms(academyId);
      const docRef = firestore.collection(`academies/${academyId}/programs`).doc();
      const record = buildProgramV2(docRef.id, academyId, input);
      await docRef.set(record);
      return record;
    },

    async updateProgramV2(academyId: string, input: UpdateProgramInput): Promise<ProgramRecord> {
      await materialiseDefaultPrograms(academyId);
      const docRef = firestore.collection(`academies/${academyId}/programs`).doc(input.programId);
      const existing = await docRef.get();
      const fallback = defaultPrograms.find((program) => program.programId === input.programId);
      // A v1 `createProgram` fills the collection without seeding the canonical seven, so a
      // canonical type can still be missing its own document here.
      const current = existing.exists
        ? (existing.data() as ProgramRecord)
        : fallback && { ...fallback, academyId };
      if (current === undefined) throw new Error(`Program ${input.programId} does not exist`);
      const updated = mergeProgramV2(current, input);
      await docRef.set(updated);
      return updated;
    },

    async listClasses(academyId: string): Promise<readonly ClassRecord[]> {
      const snapshot = await firestore.collection(`academies/${academyId}/classes`).get();

      return snapshot.docs.map((doc) => normalizeClassRecord(doc.data()));
    },

    async getClass(academyId: string, classId: string): Promise<ClassRecord | null> {
      const doc = await firestore.collection(`academies/${academyId}/classes`).doc(classId).get();

      if (!doc.exists) return null;
      return normalizeClassRecord(doc.data());
    },

    async createClass(
      academyId: string,
      input: CreateClassInput,
      actorId: string,
    ): Promise<ClassRecord> {
      const now = new Date().toISOString();
      const docRef = firestore.collection(`academies/${academyId}/classes`).doc();
      const classId = docRef.id;

      const record: ClassRecord = Object.freeze({
        classId,
        academyId,
        programId: input.programId,
        locationId: input.locationId,
        name: input.name,
        recurrenceRules: input.recurrenceRules,
        description: input.description ?? "",
        ageRange: input.ageRange ?? null,
        levelRange: input.levelRange ?? null,
        instructorIds: input.instructorIds,
        capacity: input.capacity,
        minParticipants: input.minParticipants ?? 4,
        active: true,
        schemaVersion: "2",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      await docRef.set(record);
      return record;
    },

    async updateClass(
      academyId: string,
      input: UpdateClassInput,
      actorId: string,
    ): Promise<ClassRecord> {
      const docRef = firestore.collection(`academies/${academyId}/classes`).doc(input.classId);
      const existing = await docRef.get();

      if (!existing.exists) {
        throw new Error(`Class ${input.classId} does not exist`);
      }

      const current = normalizeClassRecord(existing.data());
      const now = new Date().toISOString();

      const nextCapacity = input.capacity ?? current.capacity;
      const nextMinimum = input.minParticipants ?? current.minParticipants;
      if (nextMinimum > nextCapacity) {
        throw new Error("Class minimum participants cannot exceed capacity");
      }

      const updated: ClassRecord = Object.freeze({
        ...current,
        name: input.name ?? current.name,
        recurrenceRules: input.recurrenceRules ?? current.recurrenceRules,
        instructorIds: input.instructorIds ?? current.instructorIds,
        capacity: nextCapacity,
        minParticipants: nextMinimum,
        description: input.description === undefined ? current.description : input.description,
        ageRange: input.ageRange === undefined ? current.ageRange : input.ageRange,
        levelRange: input.levelRange === undefined ? current.levelRange : input.levelRange,
        active: input.active ?? current.active,
        updatedAt: now,
        updatedBy: actorId,
      });

      await docRef.set(updated);
      return updated;
    },

    async generateSessions(
      academyId: string,
      classId: string,
      fromDate: string,
      toDate: string,
      timezone: string,
      actorId: string,
    ): Promise<readonly SessionRecord[]> {
      const docRef = firestore.collection(`academies/${academyId}/classes`).doc(classId);
      const existing = await docRef.get();

      if (!existing.exists) {
        throw new Error(`Class ${classId} does not exist`);
      }

      const cls = normalizeClassRecord(existing.data());
      const drafts = generateSessionsFromClass(cls, fromDate, toDate, timezone);
      const now = new Date().toISOString();
      const created: SessionRecord[] = [];
      // ponytail: two rules on the same weekday share a date; only the first draft for a given
      // date may claim the legacy `${classId}__${date}` document, or the second rule's session is
      // skipped forever (and the legacy session gets pushed twice into `created`).
      const seenLegacyDates = new Set<string>();

      for (const draft of drafts) {
        const sessionRef = firestore
          .collection(`academies/${academyId}/sessions`)
          .doc(draft.sessionId);
        const draftDate = draft.sessionId.split("__")[1]!;
        // ponytail: a v1 class generated `${classId}__${date}`; keep that document instead of a twin.
        const isFirstForDate = !seenLegacyDates.has(draftDate);
        seenLegacyDates.add(draftDate);
        const legacyRef = isFirstForDate
          ? firestore
              .collection(`academies/${academyId}/sessions`)
              .doc(legacySessionId(cls.classId, draftDate))
          : null;
        const [existingSession, legacySession] = await Promise.all([
          sessionRef.get(),
          legacyRef?.get() ?? Promise.resolve(undefined),
        ]);

        if (existingSession.exists) {
          created.push(existingSession.data() as SessionRecord);
        } else if (legacySession?.exists) {
          created.push(legacySession.data() as SessionRecord);
        } else {
          const sessionRecord: SessionRecord = Object.freeze({
            ...draft,
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });
          await sessionRef.set(sessionRecord);
          created.push(sessionRecord);
        }
      }

      return created;
    },

    async updateSession(
      academyId: string,
      input: UpdateSessionInput,
      actorId: string,
      allowHistorical = false,
    ): Promise<SessionRecord> {
      const docRef = firestore.collection(`academies/${academyId}/sessions`).doc(input.sessionId);
      const existing = await docRef.get();
      if (!existing.exists) throw new Error(`Session ${input.sessionId} does not exist`);
      const current = existing.data() as SessionRecord;
      if (current.courseId) throw new Error("Edit this session in Courses & Seminars.");
      if (!allowHistorical && current.status !== "scheduled")
        throw new Error("Only scheduled sessions can be edited");
      const timezone =
        (await this.listLocations(academyId)).find((row) => row.locationId === current.locationId)
          ?.timezone ?? "Europe/Jersey";
      return weekly.update(
        academyId,
        input,
        actorId,
        timezone,
        mergeSessionUpdate,
        allowHistorical,
      );
    },

    async removeClass(
      academyId: string,
      classId: string,
      reason: string,
      actorId: string,
      nowIso: string,
    ): Promise<Readonly<{ class: ClassRecord; cancelledSessions: readonly SessionRecord[] }>> {
      const classRef = firestore.collection(`academies/${academyId}/classes`).doc(classId);
      const existing = await classRef.get();
      if (!existing.exists) throw new Error(`Class ${classId} does not exist`);
      const current = normalizeClassRecord(existing.data());
      const retired: ClassRecord = Object.freeze({
        ...current,
        active: false,
        updatedAt: nowIso,
        updatedBy: actorId,
      });
      await classRef.set(retired);
      const snapshot = await firestore
        .collection(`academies/${academyId}/sessions`)
        .where("classId", "==", classId)
        .get();
      const cancelled: SessionRecord[] = [];
      for (const doc of snapshot.docs) {
        const session = doc.data() as SessionRecord;
        if (
          (session.status !== "scheduled" && session.status !== "active") ||
          session.startAt < nowIso
        ) {
          continue;
        }
        const next: SessionRecord = Object.freeze({
          ...session,
          status: "cancelled",
          cancellationReason: reason,
          updatedAt: nowIso,
          updatedBy: actorId,
        });
        await doc.ref.set(next);
        cancelled.push(next);
      }
      return Object.freeze({ class: retired, cancelledSessions: Object.freeze(cancelled) });
    },

    async countConfirmedBookings(
      academyId: string,
      sessionIds: readonly string[],
    ): Promise<Readonly<Record<string, number>>> {
      const counts: Record<string, number> = Object.fromEntries(sessionIds.map((id) => [id, 0]));
      const unique = [...new Set(sessionIds)];
      // ponytail: Firestore `in` takes 30 values; two weeks of sessions is under that most days.
      for (let index = 0; index < unique.length; index += 30) {
        const chunk = unique.slice(index, index + 30);
        const snapshot = await firestore
          .collection(`academies/${academyId}/bookings`)
          .where("sessionId", "in", chunk)
          .where("status", "==", "confirmed")
          .get();
        for (const doc of snapshot.docs) {
          const booking = doc.data() as BookingRecord;
          counts[booking.sessionId] = (counts[booking.sessionId] ?? 0) + 1;
        }
      }
      return Object.freeze(counts);
    },

    async listSessions(
      academyId: string,
      query: ListSessionsQuery,
    ): Promise<readonly SessionRecord[]> {
      await weekly.materialise(academyId, query);
      // A range on the single field startAt needs no composite index; location and program stay
      // in memory so any combination of filters keeps working without one.
      const snapshot = await firestore
        .collection(`academies/${academyId}/sessions`)
        .where("startAt", ">=", query.from)
        .where("startAt", "<=", query.to)
        .get();

      const published = await filterPublishedCourseSessions(firestore as unknown as Firestore, academyId, snapshot.docs.map(doc => doc.data() as SessionRecord));
      return published.filter((session) => {
          if (query.locationId && session.locationId !== query.locationId) {
            return false;
          }
          if (query.programId && session.programId !== query.programId) {
            return false;
          }
          return true;
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
    },

    previewWeek(academyId: string, weekStart: string, timezone: string): Promise<WeekPreview> {
      return previewWeekWith(this, academyId, weekStart, timezone);
    },

    copyWeek(
      academyId: string,
      input: CopyWeekInput,
      timezone: string,
      actorId: string,
    ): Promise<readonly SessionRecord[]> {
      return copyWeekWith(this, academyId, input, timezone, actorId);
    },

    deleteWeek(
      academyId: string,
      input: DeleteWeekInput,
      timezone: string,
      actorId: string,
    ): Promise<readonly SessionRecord[]> {
      return deleteWeekWith(this, academyId, input, timezone, actorId);
    },

    async getSession(academyId: string, sessionId: string): Promise<SessionRecord | null> {
      const doc = await firestore
        .collection(`academies/${academyId}/sessions`)
        .doc(sessionId)
        .get();

      if (!doc.exists) return null;
      const record = doc.data() as SessionRecord;
      return (await filterPublishedCourseSessions(firestore as unknown as Firestore, academyId, [record]))[0] ?? null;
    },

    async createSession(
      academyId: string,
      input: CreateSessionInput,
      actorId: string,
    ): Promise<SessionRecord> {
      const now = new Date().toISOString();
      const docRef = firestore.collection(`academies/${academyId}/sessions`).doc();
      const sessionId = docRef.id;

      const record: SessionRecord = Object.freeze({
        sessionId,
        academyId,
        classId: input.classId ?? null,
        programId: input.programId,
        locationId: input.locationId,
        instructorId: input.instructorId,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        capacity: input.capacity,
        minParticipants: input.minParticipants ?? 4,
        status: "scheduled",
        isSeminar: input.isSeminar ?? false,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.ageRange !== undefined ? { ageRange: input.ageRange } : {}),
        ...(input.levelRange !== undefined ? { levelRange: input.levelRange } : {}),
        ...(input.instructorIds !== undefined ? { instructorIds: input.instructorIds } : {}),
        ...(input.bookingRules !== undefined ? { bookingRules: input.bookingRules } : {}),
        ...(input.waitingList !== undefined ? { waitingList: input.waitingList } : {}),
      });

      if (input.repeatWeekly) {
        const timezone =
          (await this.listLocations(academyId)).find((row) => row.locationId === input.locationId)
            ?.timezone ?? "Europe/Jersey";
        return weekly.create(record, timezone);
      }
      await docRef.set(record);
      return record;
    },

    async cancelSession(
      academyId: string,
      sessionId: string,
      reason: string,
      actorId: string,
    ): Promise<SessionRecord> {
      const docRef = firestore.collection(`academies/${academyId}/sessions`).doc(sessionId);
      const existing = await docRef.get();

      if (!existing.exists) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const current = existing.data() as SessionRecord;
      if (current.courseId) throw new Error("Cancel this session in Courses & Seminars.");
      const now = new Date().toISOString();

      const cancelled: SessionRecord = Object.freeze({
        ...current,
        status: "cancelled",
        cancellationReason: reason,
        updatedAt: now,
        updatedBy: actorId,
      });

      await docRef.set(cancelled);
      return cancelled;
    },

    async requestBooking(
      academyId: string,
      input: RequestBookingInput,
      actorId: string,
      auditActor?: BookingAuditActor,
    ): Promise<BookingRecord> {
      return bookingTransactions.requestBooking(academyId, input, actorId, auditActor);
    },

    async cancelBooking(
      academyId: string,
      input: CancelBookingInput,
      actorId: string,
      isStaffOverride = false,
      auditActor?: BookingAuditActor,
    ): Promise<BookingRecord> {
      return bookingTransactions.cancelBooking(
        academyId,
        input,
        actorId,
        isStaffOverride,
        auditActor,
      );
    },

    async listSessionBookings(
      academyId: string,
      sessionId: string,
    ): Promise<readonly BookingRecord[]> {
      const snapshot = await firestore
        .collection(`academies/${academyId}/bookings`)
        .where("sessionId", "==", sessionId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as BookingRecord)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async listStudentBookings(
      academyId: string,
      studentId: string,
    ): Promise<readonly BookingRecord[]> {
      const snapshot = await readCanonicalMemberHistoryDocuments(firestore as unknown as Firestore, academyId, studentId, "bookings");

      return snapshot.docs
        .map((d) => d.data() as BookingRecord)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async evaluateSessionMinimum(
      academyId: string,
      sessionId: string,
    ): Promise<{ confirmedCount: number; minParticipants: number; quorumMet: boolean }> {
      const sessionRef = firestore.collection(`academies/${academyId}/sessions`).doc(sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const session = sessionDoc.data() as SessionRecord;
      const minParticipants = session.minParticipants ?? 4;

      const bookingsSnapshot = await firestore
        .collection(`academies/${academyId}/bookings`)
        .where("sessionId", "==", sessionId)
        .get();

      const confirmedCount = bookingsSnapshot.docs
        .map((d) => d.data() as BookingRecord)
        .filter((b) => b.status === "confirmed").length;

      return {
        confirmedCount,
        minParticipants,
        quorumMet: confirmedCount >= minParticipants,
      };
    },

    async recordCheckIn(
      academyId: string,
      input: CheckInInput,
      actorId: string,
      occurredAt?: string,
      actorRole?: ScheduleMutationActorRole,
      actorIp: string | null = null,
    ): Promise<AttendanceRecord> {
      const courseSession = await firestore.collection(`academies/${academyId}/sessions`).doc(input.sessionId).get();
      if (courseSession.data()?.courseId) await ensureCourseBooking(firestore as unknown as Firestore, {uid: actorId, academyId, role: requireAttendanceActorRole(actorRole)}, input.sessionId, input.studentId);
      return attendanceTransactions.recordCheckIn({
        academyId,
        input,
        actorId,
        actorRole: requireAttendanceActorRole(actorRole),
        actorIp,
        ...(occurredAt === undefined ? {} : { occurredAt }),
      });
    },

    async recordSelfCheckIn(
      academyId: string,
      input: SelfCheckInInput,
      actorId: string,
      occurredAt?: string,
      actorRole?: ScheduleMutationActorRole,
      actorIp: string | null = null,
    ): Promise<AttendanceRecord> {
      const courseSession = await firestore.collection(`academies/${academyId}/sessions`).doc(input.sessionId).get();
      if (courseSession.data()?.courseId) await ensureCourseBooking(firestore as unknown as Firestore, {uid: actorId, academyId, role: requireAttendanceActorRole(actorRole)}, input.sessionId, input.studentId);
      return attendanceTransactions.recordSelfCheckIn({
        academyId,
        input,
        actorId,
        actorRole: requireAttendanceActorRole(actorRole),
        actorIp,
        ...(occurredAt === undefined ? {} : { occurredAt }),
      });
    },

    async listSessionAttendance(
      academyId: string,
      sessionId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const snapshot = await firestore
        .collection(`academies/${academyId}/attendance`)
        .where("sessionId", "==", sessionId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as AttendanceRecord)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async listStudentAttendance(
      academyId: string,
      studentId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const snapshot = await readCanonicalMemberHistoryDocuments(firestore as unknown as Firestore, academyId, studentId, "attendance");

      return snapshot.docs
        .map((d) => d.data() as AttendanceRecord)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },

    async correctAttendance(
      academyId: string,
      input: CorrectAttendanceInput,
      actorId: string,
      occurredAt?: string,
      actorRole?: ScheduleMutationActorRole,
      actorIp: string | null = null,
    ): Promise<{ correction: AttendanceRecord; canonical: AttendanceRecord }> {
      return attendanceTransactions.correctAttendance({
        academyId,
        input,
        actorId,
        actorRole: requireAttendanceActorRole(actorRole),
        actorIp,
        ...(occurredAt === undefined ? {} : { occurredAt }),
      });
    },

    async reconcileSessionNoShows(
      academyId: string,
      sessionId: string,
      actorId: string,
      occurredAt?: string,
    ): Promise<{ noShowsMarked: number; records: readonly AttendanceRecord[] }> {
      const sessionRef = firestore.collection(`academies/${academyId}/sessions`).doc(sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const bookingsSnapshot = await firestore
        .collection(`academies/${academyId}/bookings`)
        .where("sessionId", "==", sessionId)
        .get();

      const confirmedBookings = bookingsSnapshot.docs
        .map((d) => d.data() as BookingRecord)
        .filter((b) => b.status === "confirmed");

      const attendanceSnapshot = await firestore
        .collection(`academies/${academyId}/attendance`)
        .where("sessionId", "==", sessionId)
        .get();

      const attendedStudentIds = new Set(
        attendanceSnapshot.docs.map((d) => (d.data() as AttendanceRecord).studentId),
      );

      const now = occurredAt ?? new Date().toISOString();
      const records: AttendanceRecord[] = [];

      for (const booking of confirmedBookings) {
        if (!attendedStudentIds.has(booking.studentId)) {
          const attendanceId = buildAttendanceId(sessionId, booking.studentId);
          const noShowRecord: AttendanceRecord = Object.freeze({
            attendanceId,
            academyId,
            sessionId,
            studentId: booking.studentId,
            method: "manual",
            state: "no_show",
            occurredAt: now,
            notes: "Automated no-show reconciliation",
            correctionOf: null,
            schemaVersion: "1",
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });

          await firestore
            .collection(`academies/${academyId}/attendance`)
            .doc(attendanceId)
            .set(noShowRecord);
          records.push(noShowRecord);
          attendedStudentIds.add(booking.studentId);
        }
      }

      return { noShowsMarked: records.length, records };
    },

    async listAttendanceHistory(
      academyId: string,
      sessionId: string,
      studentId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const snapshot = await readCanonicalMemberHistoryDocuments(firestore as unknown as Firestore, academyId, studentId, "attendance");
      const canonicalIds = new Set(snapshot.ids.map((id) => buildAttendanceId(sessionId, id)));

      return snapshot.docs
        .map((d) => d.data() as AttendanceRecord)
        .filter((record) => record.sessionId === sessionId)
        .filter((a) => canonicalIds.has(a.attendanceId) || (a.correctionOf !== null && canonicalIds.has(a.correctionOf)))
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async recordCheckout(
      academyId: string,
      input: RecordCheckoutInput,
      actorId: string,
      occurredAt?: string,
      actorRole?: ScheduleMutationActorRole,
      actorIp: string | null = null,
    ): Promise<CheckoutRecord> {
      return attendanceTransactions.recordCheckout({
        academyId,
        input,
        actorId,
        actorRole: requireAttendanceActorRole(actorRole),
        actorIp,
        ...(occurredAt === undefined ? {} : { occurredAt }),
      });
    },

    async listSessionCheckouts(
      academyId: string,
      sessionId: string,
    ): Promise<readonly CheckoutRecord[]> {
      const snapshot = await firestore
        .collection(`academies/${academyId}/checkouts`)
        .where("sessionId", "==", sessionId)
        .get();

      return snapshot.docs
        .map((d) => d.data() as CheckoutRecord)
        .sort((a, b) => a.checkedOutAt.localeCompare(b.checkedOutAt));
    },

    async getStudentCheckout(
      academyId: string,
      sessionId: string,
      studentId: string,
    ): Promise<CheckoutRecord | null> {
      const snapshot = await readCanonicalMemberHistoryDocuments(firestore as unknown as Firestore, academyId, studentId, "checkouts");
      const matches = snapshot.docs.map((doc) => doc.data() as CheckoutRecord).filter((record) => record.sessionId === sessionId);
      if (matches.length > 1) throw new Error("Checkout identity requires office review");
      return matches[0] ?? null;
    },

    async getSessionOperationalView(
      academyId: string,
      sessionId: string,
    ): Promise<SessionOperationalView> {
      const sessionDoc = await firestore
        .collection(`academies/${academyId}/sessions`)
        .doc(sessionId)
        .get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${sessionId} not found in academy ${academyId}`);
      }

      const session = sessionDoc.data() as SessionRecord;

      const [bookingsSnap, attendanceSnap, checkoutsSnap] = await Promise.all([
        firestore
          .collection(`academies/${academyId}/bookings`)
          .where("sessionId", "==", sessionId)
          .get(),
        firestore
          .collection(`academies/${academyId}/attendance`)
          .where("sessionId", "==", sessionId)
          .get(),
        firestore
          .collection(`academies/${academyId}/checkouts`)
          .where("sessionId", "==", sessionId)
          .get(),
      ]);

      const bookings = bookingsSnap.docs.map((d) => d.data() as BookingRecord);
      const attendance = attendanceSnap.docs.map((d) => d.data() as AttendanceRecord);
      const checkouts = checkoutsSnap.docs.map((d) => d.data() as CheckoutRecord);

      return buildSessionOperationalView({
        session,
        bookings,
        attendance,
        checkouts,
      });
    },

    async getDailyOperationsDashboard(
      academyId: string,
      query: ListSessionsQuery,
    ): Promise<DailyOperationsDashboard> {
      const sessions = await this.listSessions(academyId, query);
      const views = await Promise.all(
        sessions.map((session) => this.getSessionOperationalView(academyId, session.sessionId)),
      );
      return buildDailyOperationsDashboard({ query, views });
    },
  };
}

export function createInMemoryScheduleStore(): ScheduleStore & {
  // Test-only hook: plants a session copy under a legacy id, as a v1 `generateSessions` would have.
  __seedSessionId?: (academyId: string, session: SessionRecord, id: string) => Promise<void>;
} {
  const locationsMap = new Map<string, LocationRecord[]>();
  const programsMap = new Map<string, ProgramRecord[]>();
  const classesMap = new Map<string, Map<string, ClassRecord>>();
  const sessionsMap = new Map<string, Map<string, SessionRecord>>();
  const weeklyMap = new Map<string, Map<string, WeeklySeries>>();
  const bookingsMap = new Map<string, Map<string, BookingRecord>>();
  const attendanceMap = new Map<string, Map<string, AttendanceRecord>>();
  const checkoutsMap = new Map<string, Map<string, CheckoutRecord>>();

  let classSeq = 1;
  let sessionSeq = 1;

  /** The stored program list, seeded with the canonical seven the first time it is written. */
  const materialisedPrograms = (academyId: string): ProgramRecord[] => {
    const list = programsMap.get(academyId) ?? defaultPrograms.map((p) => ({ ...p, academyId }));
    programsMap.set(academyId, list);
    return list;
  };

  return {
    async listLocations(academyId: string): Promise<readonly LocationRecord[]> {
      const custom = locationsMap.get(academyId);
      if (!custom || custom.length === 0) {
        return defaultLocations.map((loc) => ({ ...loc, academyId }));
      }
      return orderLocations(custom);
    },

    // `listLocations` falls back to the canonical sites only while nothing is stored, so both
    // writers start from the listed sites and store the whole list back.
    async createLocation(academyId: string, input: CreateLocationInput): Promise<LocationRecord> {
      const existing = [...(await this.listLocations(academyId))];
      const taken = new Set(existing.map((location) => location.locationId));
      const record = buildLocationRecord(academyId, nextLocationId(input.name, taken), input);
      locationsMap.set(academyId, [...existing, record]);
      return record;
    },

    async updateLocation(academyId: string, input: UpdateLocationInput): Promise<LocationRecord> {
      const all = [...(await this.listLocations(academyId))];
      const index = all.findIndex((location) => location.locationId === input.locationId);
      if (index === -1) throw new Error(`Location ${input.locationId} does not exist`);
      const updated = mergeLocationUpdate(all[index]!, input);
      all[index] = updated;
      locationsMap.set(academyId, all);
      return updated;
    },

    // The in-memory store keeps no audit trail, so the actor is not needed here.
    /**
     * T110 in the in-memory store: the same decision and the same outcomes as the Firestore path,
     * without an audit trail because this store keeps none.
     */
    async reconcileSessionQuorum(
      academyId: string,
      sessionId: string,
      actorId: string,
      now?: string,
    ): Promise<SessionQuorumSweepResult> {
      const session = sessionsMap.get(academyId)?.get(sessionId);
      if (!session) {
        throw new SessionQuorumSweepError("not-found", "Session is unavailable");
      }
      const at = now ?? new Date().toISOString();
      const bookings = [...(bookingsMap.get(academyId)?.values() ?? [])].filter(
        (booking) => booking.sessionId === sessionId,
      );
      const confirmed = bookings.filter((booking) => booking.status === "confirmed");
      const decision = decideQuorumSweep({
        session: {
          startAt: session.startAt,
          status: session.status,
          minParticipants: session.minParticipants,
          cancellationReason: session.cancellationReason,
        },
        confirmedCount: confirmed.length,
        now: at,
      });
      if (!decision.cancels) {
        return Object.freeze({ ...decision, sessionId, releasedBookings: 0 });
      }

      sessionsMap.get(academyId)?.set(
        sessionId,
        Object.freeze({
          ...session,
          status: "cancelled",
          cancellationReason: quorumCancellationReason,
          updatedAt: at,
          updatedBy: actorId,
        }),
      );
      for (const booking of confirmed) {
        bookingsMap.get(academyId)?.set(
          booking.bookingId,
          Object.freeze({
            ...booking,
            status: "cancelled",
            cancelledAt: at,
            cancellationReason: quorumCancellationReason,
            updatedAt: at,
            updatedBy: actorId,
          }),
        );
      }
      return Object.freeze({ ...decision, sessionId, releasedBookings: confirmed.length });
    },

    async listCancelledSessionsForStudent(
      academyId: string,
      studentId: string,
      now?: string,
    ): Promise<readonly Readonly<{ title: string; startAt: string; reason: string }>[]> {
      return cancelledSessionNotices(
        [...(sessionsMap.get(academyId)?.values() ?? [])],
        [...(bookingsMap.get(academyId)?.values() ?? [])].filter(
          (booking) => booking.studentId === studentId,
        ),
        Date.parse(now ?? new Date().toISOString()),
      );
    },

    async saveLocationGeofence(
      academyId: string,
      input: SaveLocationGeofenceInput,
    ): Promise<LocationRecord> {
      const fallback = defaultLocations.find(
        (location) => location.locationId === input.locationId,
      );
      if (fallback === undefined) {
        throw new Error(`Location ${input.locationId} is not an academy site`);
      }
      const current =
        locationsMap.get(academyId) ?? defaultLocations.map((loc) => ({ ...loc, academyId }));
      const record: LocationRecord = Object.freeze({
        ...(current.find((location) => location.locationId === input.locationId) ?? {
          ...fallback,
          academyId,
        }),
        locationId: input.locationId,
        academyId,
        geofence: input.geofence,
        schemaVersion: "1",
      });
      locationsMap.set(
        academyId,
        current.map((location) => (location.locationId === input.locationId ? record : location)),
      );
      return record;
    },

    async listPrograms(academyId: string): Promise<readonly ProgramRecord[]> {
      const custom = programsMap.get(academyId);
      if (!custom || custom.length === 0) {
        return defaultPrograms.map((prog) => ({ ...prog, academyId }));
      }
      return custom;
    },

    async createProgram(academyId: string, input: CreateProgramInput): Promise<ProgramRecord> {
      let list = programsMap.get(academyId);
      if (!list) {
        list = defaultPrograms.map((prog) => ({ ...prog, academyId }));
        programsMap.set(academyId, list);
      }

      const programId = `prog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const record: ProgramRecord = Object.freeze({
        programId,
        academyId,
        name: input.name,
        ageBand: input.ageBand,
        discipline: input.discipline,
        level: input.level,
        active: true,
        schemaVersion: "1",
      });

      list.push(record);
      return record;
    },

    async updateProgram(
      academyId: string,
      programId: string,
      input: Partial<CreateProgramInput & { active: boolean }>,
    ): Promise<ProgramRecord> {
      let list = programsMap.get(academyId);
      if (!list) {
        list = defaultPrograms.map((prog) => ({ ...prog, academyId }));
        programsMap.set(academyId, list);
      }

      const index = list.findIndex((p) => p.programId === programId);
      if (index === -1) {
        throw new Error(`Program ${programId} does not exist`);
      }

      const current = list[index]!;
      const updated: ProgramRecord = Object.freeze({
        ...current,
        name: input.name ?? current.name,
        ageBand: input.ageBand ?? current.ageBand,
        discipline: input.discipline ?? current.discipline,
        level: input.level ?? current.level,
        active: input.active ?? current.active,
      });

      list[index] = updated;
      return updated;
    },

    async createProgramV2(academyId: string, input: CreateProgramInputV2): Promise<ProgramRecord> {
      const list = materialisedPrograms(academyId);
      const programId = `prog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const record = buildProgramV2(programId, academyId, input);
      list.push(record);
      return record;
    },

    async updateProgramV2(academyId: string, input: UpdateProgramInput): Promise<ProgramRecord> {
      const list = materialisedPrograms(academyId);
      const index = list.findIndex((program) => program.programId === input.programId);
      if (index === -1) throw new Error(`Program ${input.programId} does not exist`);
      const updated = mergeProgramV2(list[index]!, input);
      list[index] = updated;
      return updated;
    },

    async listClasses(academyId: string): Promise<readonly ClassRecord[]> {
      const map = classesMap.get(academyId);
      if (!map) return [];
      return Array.from(map.values()).map((cls) => normalizeClassRecord(cls));
    },

    async getClass(academyId: string, classId: string): Promise<ClassRecord | null> {
      const map = classesMap.get(academyId);
      const cls = map?.get(classId);
      return cls ? normalizeClassRecord(cls) : null;
    },

    async createClass(
      academyId: string,
      input: CreateClassInput,
      actorId: string,
    ): Promise<ClassRecord> {
      const now = new Date().toISOString();
      const classId = `class-${classSeq++}`;
      const record: ClassRecord = Object.freeze({
        classId,
        academyId,
        programId: input.programId,
        locationId: input.locationId,
        name: input.name,
        recurrenceRules: input.recurrenceRules,
        description: input.description ?? "",
        ageRange: input.ageRange ?? null,
        levelRange: input.levelRange ?? null,
        instructorIds: input.instructorIds,
        capacity: input.capacity,
        minParticipants: input.minParticipants ?? 4,
        active: true,
        schemaVersion: "2",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      if (!classesMap.has(academyId)) {
        classesMap.set(academyId, new Map());
      }
      classesMap.get(academyId)!.set(classId, record);
      return record;
    },

    async updateClass(
      academyId: string,
      input: UpdateClassInput,
      actorId: string,
    ): Promise<ClassRecord> {
      const map = classesMap.get(academyId);
      const existing = map?.get(input.classId);
      if (!existing) {
        throw new Error(`Class ${input.classId} does not exist`);
      }
      const current = normalizeClassRecord(existing);

      const now = new Date().toISOString();
      const updated: ClassRecord = Object.freeze({
        ...current,
        name: input.name ?? current.name,
        recurrenceRules: input.recurrenceRules ?? current.recurrenceRules,
        instructorIds: input.instructorIds ?? current.instructorIds,
        capacity: input.capacity ?? current.capacity,
        minParticipants: input.minParticipants ?? current.minParticipants,
        description: input.description === undefined ? current.description : input.description,
        ageRange: input.ageRange === undefined ? current.ageRange : input.ageRange,
        levelRange: input.levelRange === undefined ? current.levelRange : input.levelRange,
        active: input.active ?? current.active,
        updatedAt: now,
        updatedBy: actorId,
      });

      map!.set(input.classId, updated);
      return updated;
    },

    async generateSessions(
      academyId: string,
      classId: string,
      fromDate: string,
      toDate: string,
      timezone: string,
      actorId: string,
    ): Promise<readonly SessionRecord[]> {
      const map = classesMap.get(academyId);
      const existingCls = map?.get(classId);
      if (!existingCls) {
        throw new Error(`Class ${classId} does not exist`);
      }
      const cls = normalizeClassRecord(existingCls);

      const drafts = generateSessionsFromClass(cls, fromDate, toDate, timezone);
      const now = new Date().toISOString();
      const created: SessionRecord[] = [];

      if (!sessionsMap.has(academyId)) {
        sessionsMap.set(academyId, new Map());
      }
      const aSessions = sessionsMap.get(academyId)!;
      // ponytail: two rules on the same weekday share a date; only the first draft for a given
      // date may claim the legacy `${classId}__${date}` session.
      const seenLegacyDates = new Set<string>();

      for (const draft of drafts) {
        const draftDate = draft.sessionId.split("__")[1]!;
        const isFirstForDate = !seenLegacyDates.has(draftDate);
        seenLegacyDates.add(draftDate);
        const legacyId = legacySessionId(cls.classId, draftDate);
        if (aSessions.has(draft.sessionId)) {
          created.push(aSessions.get(draft.sessionId)!);
        } else if (isFirstForDate && aSessions.has(legacyId)) {
          created.push(aSessions.get(legacyId)!);
        } else {
          const sessionRecord: SessionRecord = Object.freeze({
            ...draft,
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });
          aSessions.set(draft.sessionId, sessionRecord);
          created.push(sessionRecord);
        }
      }

      return created;
    },

    async updateSession(
      academyId: string,
      input: UpdateSessionInput,
      actorId: string,
      allowHistorical = false,
    ): Promise<SessionRecord> {
      const map = sessionsMap.get(academyId);
      const current = map?.get(input.sessionId);
      if (!current) throw new Error(`Session ${input.sessionId} does not exist`);
      if (!allowHistorical && current.status !== "scheduled")
        throw new Error("Only scheduled sessions can be edited");
      const updated = mergeSessionUpdate(current, input, actorId, new Date().toISOString());
      if (!current.weeklySeriesId && input.repeatWeekly) {
        const timezone =
          (await this.listLocations(academyId)).find((row) => row.locationId === current.locationId)
            ?.timezone ?? "Europe/Jersey";
        const series = newWeeklySeries(updated, timezone);
        if (!weeklyMap.has(academyId)) weeklyMap.set(academyId, new Map());
        weeklyMap.get(academyId)!.set(series.seriesId, series);
        const first = {
          ...weeklyOccurrence(series, 0)!,
          status: updated.status,
          cancellationReason: updated.cancellationReason,
        };
        map!.set(first.sessionId, first);
        return first;
      }
      if (current.weeklySeriesId) {
        if (input.repeatScope !== "following") {
          if (input.repeatWeekly !== undefined && input.repeatWeekly !== current.repeatWeekly) {
            throw new Error("Choose this and following sessions to change weekly repetition");
          }
          const single = { ...updated, weeklyOverride: true };
          map!.set(single.sessionId, single);
          return single;
        }
        const series = weeklyMap.get(academyId)!.get(current.weeklySeriesId)!;
        const next = reviseWeeklySeries(
          series,
          current,
          updated,
          input.repeatWeekly ?? current.repeatWeekly ?? true,
        );
        const future = [...map!.values()].filter(
          (row) =>
            row.weeklySeriesId === series.seriesId &&
            (row.weeklyIndex ?? 0) >= (current.weeklyIndex ?? 0),
        );
        weeklyMap.get(academyId)!.set(series.seriesId, next);
        for (const row of future)
          map!.set(row.sessionId, reviseWeeklySession(next, row, current.sessionId, updated));
        return reviseWeeklySession(next, current, current.sessionId, updated);
      }
      map!.set(input.sessionId, updated);
      return updated;
    },

    async removeClass(
      academyId: string,
      classId: string,
      reason: string,
      actorId: string,
      nowIso: string,
    ): Promise<Readonly<{ class: ClassRecord; cancelledSessions: readonly SessionRecord[] }>> {
      const map = classesMap.get(academyId);
      const current = map?.get(classId);
      if (!current) throw new Error(`Class ${classId} does not exist`);
      const retired: ClassRecord = Object.freeze({
        ...current,
        active: false,
        updatedAt: nowIso,
        updatedBy: actorId,
      });
      map!.set(classId, retired);
      const sMap = sessionsMap.get(academyId);
      const cancelled: SessionRecord[] = [];
      if (sMap) {
        for (const [id, session] of sMap) {
          if (session.classId !== classId) continue;
          if (
            (session.status !== "scheduled" && session.status !== "active") ||
            session.startAt < nowIso
          ) {
            continue;
          }
          const next: SessionRecord = Object.freeze({
            ...session,
            status: "cancelled",
            cancellationReason: reason,
            updatedAt: nowIso,
            updatedBy: actorId,
          });
          sMap.set(id, next);
          cancelled.push(next);
        }
      }
      return Object.freeze({ class: retired, cancelledSessions: Object.freeze(cancelled) });
    },

    async countConfirmedBookings(
      academyId: string,
      sessionIds: readonly string[],
    ): Promise<Readonly<Record<string, number>>> {
      const counts: Record<string, number> = Object.fromEntries(sessionIds.map((id) => [id, 0]));
      const bMap = bookingsMap.get(academyId);
      if (bMap) {
        for (const booking of bMap.values()) {
          if (booking.status !== "confirmed" || booking.membershipId === null) continue;
          if (!(booking.sessionId in counts)) continue;
          counts[booking.sessionId] = (counts[booking.sessionId] ?? 0) + 1;
        }
      }
      return Object.freeze(counts);
    },

    async __seedSessionId(academyId: string, session: SessionRecord, id: string): Promise<void> {
      if (!sessionsMap.has(academyId)) {
        sessionsMap.set(academyId, new Map());
      }
      sessionsMap.get(academyId)!.set(id, Object.freeze({ ...session, sessionId: id }));
    },

    async listSessions(
      academyId: string,
      query: ListSessionsQuery,
    ): Promise<readonly SessionRecord[]> {
      for (const series of weeklyMap.get(academyId)?.values() ?? []) {
        for (const occurrence of weeklyOccurrences(series, query)) {
          const stored = sessionsMap.get(academyId)!;
          if (!stored.has(occurrence.sessionId)) stored.set(occurrence.sessionId, occurrence);
        }
      }
      const map = sessionsMap.get(academyId);
      if (!map) return [];

      return Array.from(map.values())
        .filter((session) => {
          if (session.startAt < query.from || session.startAt > query.to) {
            return false;
          }
          if (query.locationId && session.locationId !== query.locationId) {
            return false;
          }
          if (query.programId && session.programId !== query.programId) {
            return false;
          }
          return true;
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
    },

    previewWeek(academyId: string, weekStart: string, timezone: string): Promise<WeekPreview> {
      return previewWeekWith(this, academyId, weekStart, timezone);
    },

    copyWeek(
      academyId: string,
      input: CopyWeekInput,
      timezone: string,
      actorId: string,
    ): Promise<readonly SessionRecord[]> {
      return copyWeekWith(this, academyId, input, timezone, actorId);
    },

    deleteWeek(
      academyId: string,
      input: DeleteWeekInput,
      timezone: string,
      actorId: string,
    ): Promise<readonly SessionRecord[]> {
      return deleteWeekWith(this, academyId, input, timezone, actorId);
    },

    async getSession(academyId: string, sessionId: string): Promise<SessionRecord | null> {
      const map = sessionsMap.get(academyId);
      return map?.get(sessionId) ?? null;
    },

    async createSession(
      academyId: string,
      input: CreateSessionInput,
      actorId: string,
    ): Promise<SessionRecord> {
      const now = new Date().toISOString();
      const sessionId = `session-${sessionSeq++}`;
      const record: SessionRecord = Object.freeze({
        sessionId,
        academyId,
        classId: input.classId ?? null,
        programId: input.programId,
        locationId: input.locationId,
        instructorId: input.instructorId,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        capacity: input.capacity,
        minParticipants: input.minParticipants ?? 4,
        status: "scheduled",
        isSeminar: input.isSeminar ?? false,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.ageRange !== undefined ? { ageRange: input.ageRange } : {}),
        ...(input.levelRange !== undefined ? { levelRange: input.levelRange } : {}),
        ...(input.instructorIds !== undefined ? { instructorIds: input.instructorIds } : {}),
        ...(input.bookingRules !== undefined ? { bookingRules: input.bookingRules } : {}),
        ...(input.waitingList !== undefined ? { waitingList: input.waitingList } : {}),
      });

      if (!sessionsMap.has(academyId)) {
        sessionsMap.set(academyId, new Map());
      }
      sessionsMap.get(academyId)!.set(sessionId, record);
      if (input.repeatWeekly) {
        const timezone =
          (await this.listLocations(academyId)).find((row) => row.locationId === input.locationId)
            ?.timezone ?? "Europe/Jersey";
        const series = newWeeklySeries(record, timezone);
        if (!weeklyMap.has(academyId)) weeklyMap.set(academyId, new Map());
        weeklyMap.get(academyId)!.set(series.seriesId, series);
        const first = weeklyOccurrence(series, 0)!;
        sessionsMap.get(academyId)!.set(first.sessionId, first);
        return first;
      }
      return record;
    },

    async cancelSession(
      academyId: string,
      sessionId: string,
      reason: string,
      actorId: string,
    ): Promise<SessionRecord> {
      const map = sessionsMap.get(academyId);
      const current = map?.get(sessionId);
      if (!current) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const now = new Date().toISOString();
      const cancelled: SessionRecord = Object.freeze({
        ...current,
        status: "cancelled",
        cancellationReason: reason,
        updatedAt: now,
        updatedBy: actorId,
      });

      map!.set(sessionId, cancelled);
      return cancelled;
    },

    async requestBooking(
      academyId: string,
      input: RequestBookingInput,
      actorId: string,
    ): Promise<BookingRecord> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(input.sessionId);
      if (!session) {
        throw new BookingTransactionError("not-found", `Session ${input.sessionId} does not exist`);
      }
      if (session.status === "cancelled") {
        throw new BookingTransactionError(
          "ineligible",
          `Cannot book cancelled session ${input.sessionId}`,
        );
      }

      if (!bookingsMap.has(academyId)) {
        bookingsMap.set(academyId, new Map());
      }
      const bMap = bookingsMap.get(academyId)!;
      const bookingId = buildBookingId(input.sessionId, input.studentId);

      const existing = bMap.get(bookingId);
      if (existing && existing.status === "confirmed") {
        return existing;
      }

      const confirmedCount = Array.from(bMap.values()).filter(
        (b) =>
          b.sessionId === input.sessionId && b.status === "confirmed" && b.bookingId !== bookingId,
      ).length;

      if (session.capacity !== null && confirmedCount >= session.capacity) {
        throw new BookingTransactionError(
          "capacity",
          `Session capacity reached (${session.capacity})`,
        );
      }

      const now = new Date().toISOString();
      const record: BookingRecord = Object.freeze({
        bookingId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        membershipId: input.membershipId,
        status: "confirmed",
        requestedAt: now,
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: existing ? existing.createdAt : now,
        createdBy: existing ? existing.createdBy : actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      bMap.set(bookingId, record);
      return record;
    },

    async cancelBooking(
      academyId: string,
      input: CancelBookingInput,
      actorId: string,
      isStaffOverride = false,
    ): Promise<BookingRecord> {
      const bMap = bookingsMap.get(academyId);
      const bookingIds = buildBookingIdCandidates(input.sessionId, input.studentId);
      const existingIds = bookingIds.filter((bookingId) => bMap?.has(bookingId));
      if (existingIds.length > 1) {
        throw new Error("Duplicate booking versions cannot be cancelled");
      }
      const bookingId = existingIds[0] ?? bookingIds[0];
      const existing = bMap?.get(bookingId);

      if (!existing) {
        throw new Error(`Booking ${bookingId} does not exist`);
      }
      if (existing.status === "cancelled") {
        return existing;
      }

      if (!isStaffOverride) {
        const sMap = sessionsMap.get(academyId);
        const session = sMap?.get(input.sessionId);
        if (session && !isWithinBookingCutoff(session.startAt)) {
          throw new Error("Cannot cancel within 1 hour of session start without staff override");
        }
      }

      const now = new Date().toISOString();
      const updated: BookingRecord = Object.freeze({
        ...existing,
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: input.reason,
        updatedAt: now,
        updatedBy: actorId,
      });

      bMap!.set(bookingId, updated);
      return updated;
    },

    async listSessionBookings(
      academyId: string,
      sessionId: string,
    ): Promise<readonly BookingRecord[]> {
      const bMap = bookingsMap.get(academyId);
      if (!bMap) return [];
      return Array.from(bMap.values())
        .filter((b) => b.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async listStudentBookings(
      academyId: string,
      studentId: string,
    ): Promise<readonly BookingRecord[]> {
      const bMap = bookingsMap.get(academyId);
      if (!bMap) return [];
      return Array.from(bMap.values())
        .filter((b) => b.studentId === studentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async evaluateSessionMinimum(
      academyId: string,
      sessionId: string,
    ): Promise<{ confirmedCount: number; minParticipants: number; quorumMet: boolean }> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const minParticipants = session.minParticipants ?? 4;
      const bMap = bookingsMap.get(academyId);
      const confirmedCount = bMap
        ? Array.from(bMap.values()).filter(
            (b) => b.sessionId === sessionId && b.status === "confirmed",
          ).length
        : 0;

      return {
        confirmedCount,
        minParticipants,
        quorumMet: confirmedCount >= minParticipants,
      };
    },

    async recordCheckIn(
      academyId: string,
      input: CheckInInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<AttendanceRecord> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(input.sessionId);
      if (!session) {
        throw new Error(`Session ${input.sessionId} does not exist`);
      }
      if (session.status === "cancelled") {
        throw new Error(`Cannot check in to cancelled session ${input.sessionId}`);
      }

      if (!attendanceMap.has(academyId)) {
        attendanceMap.set(academyId, new Map());
      }
      const aMap = attendanceMap.get(academyId)!;
      const attendanceId = buildAttendanceId(input.sessionId, input.studentId);

      const existing = aMap.get(attendanceId);
      const checkInTime = occurredAt ?? new Date().toISOString();
      const state = determinePunctuality(session.startAt, checkInTime);

      // Same rule as the Firestore path: a retry is judged at the original check-in time, so an
      // identical replay never changes its verdict because the measurement aged in between.
      const site = (
        locationsMap.get(academyId) ?? defaultLocations.map((loc) => ({ ...loc, academyId }))
      ).find((location) => location.locationId === session.locationId);
      const proximityResult = resolveCheckInProximity({
        ...(input.proximity === undefined ? {} : { measurement: input.proximity }),
        siteHasGeofence:
          site?.geofence !== undefined &&
          site.geofence !== null &&
          Number.isFinite(site.geofence.latitude) &&
          Number.isFinite(site.geofence.longitude),
        ...(input.overrideReason === undefined ? {} : { overrideReason: input.overrideReason }),
        nowMs: Date.parse(existing?.occurredAt ?? checkInTime),
      });
      if (!proximityResult.ok) {
        throw new ScheduleAttendanceError("invalid", proximityResult.error);
      }
      if (existing) {
        return existing;
      }

      const record: AttendanceRecord = Object.freeze({
        attendanceId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: input.method,
        state,
        occurredAt: checkInTime,
        notes: input.notes ?? null,
        correctionOf: null,
        proximity: proximityResult.value,
        schemaVersion: "1",
        createdAt: checkInTime,
        createdBy: actorId,
        updatedAt: checkInTime,
        updatedBy: actorId,
      });

      aMap.set(attendanceId, record);
      return record;
    },

    async recordSelfCheckIn(
      academyId: string,
      input: SelfCheckInInput,
      actorId: string,
      occurredAt?: string,
      actorRole?: ScheduleMutationActorRole,
    ): Promise<AttendanceRecord> {
      if (
        actorRole === undefined ||
        !["adultStudent", "teenStudent", "guardian"].includes(actorRole)
      ) {
        throw new ScheduleAttendanceError(
          "credential",
          "Member authority is required for self check-in",
        );
      }
      const session = sessionsMap.get(academyId)?.get(input.sessionId);
      if (!session) throw new Error(`Session ${input.sessionId} does not exist`);
      if (session.status === "cancelled") {
        throw new Error(`Cannot check in to cancelled session ${input.sessionId}`);
      }
      const booked = [...(bookingsMap.get(academyId)?.values() ?? [])].some(
        (booking) =>
          booking.sessionId === input.sessionId &&
          booking.studentId === input.studentId &&
          booking.status === "confirmed",
      );
      if (!booked) throw new SelfCheckInRefusedError("not_booked");
      if (!attendanceMap.has(academyId)) attendanceMap.set(academyId, new Map());
      const attendance = attendanceMap.get(academyId)!;
      const attendanceId = buildAttendanceId(input.sessionId, input.studentId);
      const existing = attendance.get(attendanceId);
      if (existing) {
        if (existing.method === "self" && existing.createdBy === actorId) return existing;
        throw new SelfCheckInRefusedError("already_checked_in");
      }
      const checkInTime = occurredAt ?? new Date().toISOString();
      const site = (
        locationsMap.get(academyId) ??
        defaultLocations.map((location) => ({ ...location, academyId }))
      ).find((location) => location.locationId === session.locationId);
      const program = (programsMap.get(academyId) ?? defaultPrograms).find(
        (candidate) => candidate.programId === session.programId,
      );
      const decision = decideSelfCheckIn({
        session,
        isOpenMat: isOpenMatProgram(program),
        site: site?.geofence ?? null,
        position: input.position,
        nowMs: Date.parse(checkInTime),
      });
      if (!decision.ok) {
        throw new SelfCheckInRefusedError(decision.error.reason, decision.error.distanceMeters);
      }
      const record: AttendanceRecord = Object.freeze({
        attendanceId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: "self",
        state: determinePunctuality(session.startAt, checkInTime),
        occurredAt: checkInTime,
        notes: null,
        correctionOf: null,
        proximity: decision.value,
        schemaVersion: "1",
        createdAt: checkInTime,
        createdBy: actorId,
        updatedAt: checkInTime,
        updatedBy: actorId,
      });
      attendance.set(attendanceId, record);
      return record;
    },

    async listSessionAttendance(
      academyId: string,
      sessionId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const aMap = attendanceMap.get(academyId);
      if (!aMap) return [];
      return Array.from(aMap.values())
        .filter((a) => a.sessionId === sessionId)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async listStudentAttendance(
      academyId: string,
      studentId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const aMap = attendanceMap.get(academyId);
      if (!aMap) return [];
      return Array.from(aMap.values())
        .filter((a) => a.studentId === studentId && a.correctionOf === null)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },

    async correctAttendance(
      academyId: string,
      input: CorrectAttendanceInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<{ correction: AttendanceRecord; canonical: AttendanceRecord }> {
      if (!attendanceMap.has(academyId)) {
        attendanceMap.set(academyId, new Map());
      }
      const aMap = attendanceMap.get(academyId)!;
      const canonicalId = buildAttendanceId(input.sessionId, input.studentId);
      const existingCanonical = aMap.get(canonicalId);

      if (!existingCanonical) {
        throw new Error(`Canonical attendance record ${canonicalId} does not exist`);
      }

      const now = occurredAt ?? new Date().toISOString();
      const correctionId = buildCorrectionAttendanceId();

      const correction: AttendanceRecord = Object.freeze({
        attendanceId: correctionId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: existingCanonical.method,
        state: input.newState,
        occurredAt: now,
        notes: input.reason,
        correctionOf: canonicalId,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      const updatedCanonical: AttendanceRecord = Object.freeze({
        ...existingCanonical,
        state: input.newState,
        updatedAt: now,
        updatedBy: actorId,
      });

      aMap.set(correctionId, correction);
      aMap.set(canonicalId, updatedCanonical);

      return { correction, canonical: updatedCanonical };
    },

    async reconcileSessionNoShows(
      academyId: string,
      sessionId: string,
      actorId: string,
      occurredAt?: string,
    ): Promise<{ noShowsMarked: number; records: readonly AttendanceRecord[] }> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} does not exist`);
      }

      const bMap = bookingsMap.get(academyId);
      const confirmedBookings = bMap
        ? Array.from(bMap.values()).filter(
            (b) => b.sessionId === sessionId && b.status === "confirmed",
          )
        : [];

      if (!attendanceMap.has(academyId)) {
        attendanceMap.set(academyId, new Map());
      }
      const aMap = attendanceMap.get(academyId)!;

      const now = occurredAt ?? new Date().toISOString();
      const records: AttendanceRecord[] = [];

      for (const booking of confirmedBookings) {
        const canonicalId = buildAttendanceId(sessionId, booking.studentId);
        if (!aMap.has(canonicalId)) {
          const noShowRecord: AttendanceRecord = Object.freeze({
            attendanceId: canonicalId,
            academyId,
            sessionId,
            studentId: booking.studentId,
            method: "manual",
            state: "no_show",
            occurredAt: now,
            notes: "Automated no-show reconciliation",
            correctionOf: null,
            schemaVersion: "1",
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });

          aMap.set(canonicalId, noShowRecord);
          records.push(noShowRecord);
        }
      }

      return { noShowsMarked: records.length, records };
    },

    async listAttendanceHistory(
      academyId: string,
      sessionId: string,
      studentId: string,
    ): Promise<readonly AttendanceRecord[]> {
      const aMap = attendanceMap.get(academyId);
      if (!aMap) return [];
      const canonicalId = buildAttendanceId(sessionId, studentId);
      return Array.from(aMap.values())
        .filter((a) => a.attendanceId === canonicalId || a.correctionOf === canonicalId)
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async recordCheckout(
      academyId: string,
      input: RecordCheckoutInput,
      actorId: string,
      occurredAt?: string,
    ): Promise<CheckoutRecord> {
      if (!checkoutsMap.has(academyId)) {
        checkoutsMap.set(academyId, new Map());
      }
      const cMap = checkoutsMap.get(academyId)!;
      const checkoutId = buildCheckoutId(input.sessionId, input.studentId);

      const existing = cMap.get(checkoutId);
      if (existing) {
        return existing;
      }

      // Verify attendance
      const aMap = attendanceMap.get(academyId);
      const attendanceId = buildAttendanceId(input.sessionId, input.studentId);
      const attendance = aMap?.get(attendanceId);

      if (!attendance || (attendance.state !== "attended" && attendance.state !== "late")) {
        throw new Error(
          `Student ${input.studentId} did not attend this session ${input.sessionId}${
            attendance ? ` (state: ${attendance.state})` : ""
          }`,
        );
      }

      const now = occurredAt ?? new Date().toISOString();
      const record: CheckoutRecord = Object.freeze({
        checkoutId,
        academyId,
        sessionId: input.sessionId,
        studentId: input.studentId,
        method: input.method,
        authorizedAdultId: input.authorizedAdultId ?? null,
        authorizedAdultName: input.authorizedAdultName ?? null,
        notes: input.notes ?? null,
        checkedOutAt: now,
        schemaVersion: "1",
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
      });

      cMap.set(checkoutId, record);
      return record;
    },

    async listSessionCheckouts(
      academyId: string,
      sessionId: string,
    ): Promise<readonly CheckoutRecord[]> {
      const cMap = checkoutsMap.get(academyId);
      if (!cMap) return [];
      return Array.from(cMap.values())
        .filter((c) => c.sessionId === sessionId)
        .sort((a, b) => a.checkedOutAt.localeCompare(b.checkedOutAt));
    },

    async getStudentCheckout(
      academyId: string,
      sessionId: string,
      studentId: string,
    ): Promise<CheckoutRecord | null> {
      const cMap = checkoutsMap.get(academyId);
      if (!cMap) return null;
      const checkoutId = buildCheckoutId(sessionId, studentId);
      return cMap.get(checkoutId) ?? null;
    },

    async getSessionOperationalView(
      academyId: string,
      sessionId: string,
    ): Promise<SessionOperationalView> {
      const sMap = sessionsMap.get(academyId);
      const session = sMap?.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found in academy ${academyId}`);
      }

      const bMap = bookingsMap.get(academyId);
      const bookings = bMap
        ? Array.from(bMap.values()).filter((b) => b.sessionId === sessionId)
        : [];

      const aMap = attendanceMap.get(academyId);
      const attendance = aMap
        ? Array.from(aMap.values()).filter((a) => a.sessionId === sessionId)
        : [];

      const cMap = checkoutsMap.get(academyId);
      const checkouts = cMap
        ? Array.from(cMap.values()).filter((c) => c.sessionId === sessionId)
        : [];

      return buildSessionOperationalView({
        session,
        bookings,
        attendance,
        checkouts,
      });
    },

    async getDailyOperationsDashboard(
      academyId: string,
      query: ListSessionsQuery,
    ): Promise<DailyOperationsDashboard> {
      const sessions = await this.listSessions(academyId, query);
      const views = await Promise.all(
        sessions.map((session) => this.getSessionOperationalView(academyId, session.sessionId)),
      );
      return buildDailyOperationsDashboard({ query, views });
    },
  };
}
