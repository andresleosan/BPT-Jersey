import { isClassPaymentSettled } from "./payg-attendance.js";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { canAccessCourseSession, type Course, type CourseEnrolment } from "@bpt-jersey/domain/courses";
import { assertCourseActorLive } from "../courses/course-store.js";
import { authorizeCourseSessionActor } from "../courses/course-access.js";
import { resolveCourseParticipantInTransaction } from "../courses/course-participants.js";
import { classActorGroup, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import { parseFamilyRecord } from "@bpt-jersey/domain/families";
import { parseEffectiveStudentProfileAt, type StudentProfile } from "@bpt-jersey/domain/profiles";
import {
  attendanceStates,
  buildAttendanceId,
  buildBookingIdCandidates,
  buildCheckoutId,
  buildCorrectionAttendanceId,
  determinePunctuality,
  resolveCheckInProximity,
  type AttendanceProximity,
  type AttendanceRecord,
  type CheckInInput,
  type LocationGeofence,
  type LocationId,
  type CheckoutRecord,
  type CorrectAttendanceInput,
  type RecordCheckoutInput,
} from "@bpt-jersey/domain/schedule";
import {
  decideSelfCheckIn,
  isOpenMatProgram,
  type SelfCheckInInput,
  type SelfCheckInRefusal,
} from "@bpt-jersey/domain/schedule/self-check-in";

import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import { assertBookingMemberAccess } from "./booking-transaction-service.js";
import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import type {
  BookingDocumentData,
  BookingDocumentReference,
  BookingDocumentSnapshot,
  BookingQuery,
  BookingQuerySnapshot,
} from "./booking-transaction-service.js";

export type ScheduleMutationActorRole =
  "owner" | "administrator" | "headCoach" | "coach" | "guardian" | "adultStudent" | "teenStudent" | "shopper";

type ScheduleAttendanceErrorCode =
  "conflict" | "credential" | "ineligible" | "invalid" | "not-found" | "tenant" | "payment";

export class ScheduleAttendanceError extends Error {
  public constructor(
    public readonly code: ScheduleAttendanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScheduleAttendanceError";
  }
}

/** A member self check-in that the server refused; the reason is safe to send to the client. */
export class SelfCheckInRefusedError extends Error {
  public constructor(
    public readonly reason: SelfCheckInRefusal,
    public readonly distanceMeters?: number,
  ) {
    super(`Self check-in refused: ${reason}`);
    this.name = "SelfCheckInRefusedError";
  }
}

export type AttendanceTransaction = Readonly<{
  get: {
    (reference: BookingDocumentReference): Promise<BookingDocumentSnapshot>;
    (query: BookingQuery): Promise<BookingQuerySnapshot>;
  };
  create: (reference: BookingDocumentReference, data: BookingDocumentData) => unknown;
  set: (reference: BookingDocumentReference, data: BookingDocumentData) => unknown;
  update: (reference: BookingDocumentReference, data: BookingDocumentData) => unknown;
}>;

export type AttendanceFirestore = Readonly<{
  doc: (path: string) => BookingDocumentReference;
  collection: (path: string) => BookingQuery;
  runTransaction: <T>(update: (transaction: AttendanceTransaction) => Promise<T>) => Promise<T>;
}>;

/** What the class block of an attendance audit event needs to know about the session. */
type SessionAuditFacts = Readonly<{
  sessionId: string;
  startAt: string;
  status: string;
  locationId: LocationId | null;
  programId: string | null;
}>;

type MutationContext<Input> = Readonly<{
  academyId: string;
  input: Input;
  actorId: string;
  actorRole: ScheduleMutationActorRole;
  /** The caller's address as the callable read it; a scheduled or system call has none. */
  actorIp?: string | null;
  occurredAt?: string;
}>;

export type TransactionalAttendanceService = Readonly<{
  recordCheckIn: (context: MutationContext<CheckInInput>) => Promise<AttendanceRecord>;
  recordSelfCheckIn: (context: MutationContext<SelfCheckInInput>) => Promise<AttendanceRecord>;
  correctAttendance: (
    context: MutationContext<CorrectAttendanceInput>,
  ) => Promise<{ correction: AttendanceRecord; canonical: AttendanceRecord }>;
  recordCheckout: (context: MutationContext<RecordCheckoutInput>) => Promise<CheckoutRecord>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const correctionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const staffRoles = new Set<ScheduleMutationActorRole>([
  "owner",
  "administrator",
  "headCoach",
  "coach",
]);
const memberRoles = new Set<ScheduleMutationActorRole>(["adultStudent", "teenStudent", "guardian"]);
const maximumRelationships = 100;

function fail(code: ScheduleAttendanceErrorCode, message: string): never {
  throw new ScheduleAttendanceError(code, message);
}

function segment(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    return fail("invalid", label + " is invalid");
  }
  return value;
}

function validDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function data(snapshot: BookingDocumentSnapshot): BookingDocumentData | undefined {
  return snapshot.exists ? snapshot.data() : undefined;
}

function path(academyId: string, collection: string, id: string): string {
  return `academies/${academyId}/${collection}/${id}`;
}

/**
 * Every attendance event carries the same class block as a booking event, so the class
 * registrations log reads one shape for the whole life of a place in a class. The student is
 * always a record here, so the name column stays empty; only a Regyfit import fills it.
 */
function auditDraft(
  input: Readonly<{
    academyId: string;
    actorId: string;
    actorRole: ScheduleMutationActorRole;
    actorIp: string | null;
    action:
      | "attendance.checked_in"
      | "attendance.corrected"
      | "attendance.proximity_override"
      | "student.checked_out";
    targetRef: string;
    correlationId: string;
    studentId: string;
    session: SessionAuditFacts;
  }>,
): AuditEventDraft {
  return {
    academyId: input.academyId,
    actorId: input.actorId,
    action: input.action,
    targetRef: input.targetRef,
    purpose: "schedule-attendance-operation",
    correlationId: input.correlationId,
    class: {
      studentId: input.studentId,
      memberId: null,
      studentName: null,
      sessionId: input.session.sessionId,
      sessionStartAt: input.session.startAt,
      programId: input.session.programId,
      locationId: input.session.locationId,
    },
    actorIp: input.actorIp,
    actorRole: input.actorRole,
    actorGroup: classActorGroup(input.actorRole),
    actorName: null,
    source: "bpt",
  } as AuditEventDraft;
}

/**
 * Reads the site coordinates recorded for the session location. A site without coordinates is not
 * an error: it simply means no proximity question can be answered (T109, BRIEF decision 5).
 */
function siteHasGeofence(snapshot: BookingDocumentSnapshot): boolean {
  const value = data(snapshot);
  if (value === undefined) return false;
  const geofence = value.geofence;
  if (typeof geofence !== "object" || geofence === null) return false;
  const candidate = geofence as Readonly<{ latitude?: unknown; longitude?: unknown }>;
  return (
    typeof candidate.latitude === "number" &&
    Number.isFinite(candidate.latitude) &&
    typeof candidate.longitude === "number" &&
    Number.isFinite(candidate.longitude)
  );
}

function siteGeofence(snapshot: BookingDocumentSnapshot): LocationGeofence | null {
  const value = data(snapshot)?.geofence;
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Readonly<{ latitude?: unknown; longitude?: unknown }>;
  return typeof candidate.latitude === "number" && typeof candidate.longitude === "number"
    ? { latitude: candidate.latitude, longitude: candidate.longitude }
    : null;
}

/**
 * A replay must carry the same fact as the stored record. Records written before the signal
 * existed carry no proximity at all, which is the same fact as an `unavailable` retry.
 */
function sameProximity(
  stored: AttendanceRecord["proximity"],
  resolved: AttendanceProximity,
): boolean {
  if (stored === undefined) return resolved.signal === "unavailable";
  return (
    stored.signal === resolved.signal &&
    stored.distanceMeters === resolved.distanceMeters &&
    stored.accuracyMeters === resolved.accuracyMeters &&
    stored.overrideReason === resolved.overrideReason
  );
}

function requireSession(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  sessionId: string,
  allowCompleted: boolean,
): SessionAuditFacts {
  const value = data(snapshot);
  if (value === undefined) return fail("not-found", "Session is unavailable");
  if (snapshot.id !== sessionId || value.sessionId !== sessionId || value.academyId !== academyId) {
    return fail("tenant", "Session tenant binding is invalid");
  }
  if (!validDateTime(value.startAt)) {
    return fail("invalid", "Session time is invalid");
  }
  const permittedStatuses = allowCompleted
    ? ["scheduled", "active", "completed"]
    : ["scheduled", "active"];
  if (!permittedStatuses.includes(String(value.status))) {
    return fail("ineligible", "Session is not open for this operation");
  }
  const locationId =
    typeof value.locationId === "string" && identifierPattern.test(value.locationId)
      ? value.locationId
      : null;
  const programId =
    typeof value.programId === "string" && identifierPattern.test(value.programId)
      ? value.programId
      : null;
  return { sessionId, startAt: value.startAt, status: String(value.status), locationId, programId };
}

function requireStudent(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  studentId: string,
): StudentProfile {
  const value = data(snapshot);
  if (value === undefined) return fail("not-found", "Student is unavailable");
  const parsed = parseEffectiveStudentProfileAt(value, dateKeyInJersey(new Date()));
  if (
    !parsed.ok ||
    snapshot.id !== parsed.value.studentId ||
    parsed.value.studentId !== studentId ||
    parsed.value.academyId !== academyId
  ) {
    return fail("tenant", "Student tenant binding is invalid");
  }
  if (!parsed.value.active || parsed.value.status !== "active") {
    return fail("ineligible", "Student is not active");
  }
  return parsed.value;
}

export type ConfirmedBookingCheck = "confirmed" | "missing" | "ambiguous" | "tenant" | "not-confirmed";

/**
 * The one confirmed-booking rule: exactly one existing booking among a student's id candidates,
 * bound to this academy, session and student, with status `confirmed`. Shared with the session roster.
 */
export function checkConfirmedBooking(
  snapshots: readonly BookingDocumentSnapshot[],
  academyId: string,
  sessionId: string,
  studentId: string,
): ConfirmedBookingCheck {
  const existing = snapshots.filter((snapshot) => snapshot.exists);
  if (existing.length === 0) return "missing";
  if (existing.length !== 1) return "ambiguous";
  const snapshot = existing[0]!;
  const value = data(snapshot);
  if (
    value === undefined ||
    snapshot.id !== value.bookingId ||
    value.academyId !== academyId ||
    value.sessionId !== sessionId ||
    value.studentId !== studentId
  ) {
    return "tenant";
  }
  return value.status === "confirmed" ? "confirmed" : "not-confirmed";
}

function requireConfirmedBooking(
  snapshots: readonly BookingDocumentSnapshot[],
  academyId: string,
  sessionId: string,
  studentId: string,
): void {
  const check = checkConfirmedBooking(snapshots, academyId, sessionId, studentId);
  if (check === "ambiguous") return fail("conflict", "Booking identity is ambiguous");
  if (check === "tenant") return fail("tenant", "Booking tenant binding is invalid");
  if (check !== "confirmed") return fail("ineligible", "Confirmed booking is required");
}

function storedAttendance(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  sessionId: string,
  studentId: string,
): AttendanceRecord | undefined {
  const value = data(snapshot);
  if (value === undefined) return undefined;
  const attendanceId = buildAttendanceId(sessionId, studentId);
  if (
    snapshot.id !== attendanceId ||
    value.attendanceId !== attendanceId ||
    value.academyId !== academyId ||
    value.sessionId !== sessionId ||
    value.studentId !== studentId ||
    value.correctionOf !== null ||
    !attendanceStates.includes(value.state as AttendanceRecord["state"])
  ) {
    return fail("tenant", "Attendance tenant binding is invalid");
  }
  return value as AttendanceRecord;
}

function storedCheckout(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  sessionId: string,
  studentId: string,
): CheckoutRecord | undefined {
  const value = data(snapshot);
  if (value === undefined) return undefined;
  const checkoutId = buildCheckoutId(sessionId, studentId);
  if (
    snapshot.id !== checkoutId ||
    value.checkoutId !== checkoutId ||
    value.academyId !== academyId ||
    value.sessionId !== sessionId ||
    value.studentId !== studentId
  ) {
    return fail("tenant", "Checkout tenant binding is invalid");
  }
  return value as CheckoutRecord;
}

async function bookingSnapshots(
  firestore: AttendanceFirestore,
  transaction: AttendanceTransaction,
  academyId: string,
  sessionId: string,
  studentId: string,
): Promise<readonly BookingDocumentSnapshot[]> {
  return Promise.all(
    buildBookingIdCandidates(sessionId, studentId).map((bookingId) =>
      transaction.get(firestore.doc(path(academyId, "bookings", bookingId))),
    ),
  );
}

async function validateCourseAttendance(
  firestore: AttendanceFirestore, transaction: AttendanceTransaction, sessionSnapshot: BookingDocumentSnapshot,
  bookings: readonly BookingDocumentSnapshot[], context: MutationContext<unknown>, studentId: string, self: boolean,
): Promise<void> {
  const session = data(sessionSnapshot);
  if (!session?.courseId) {
    if (self && !memberRoles.has(context.actorRole)) fail("credential", "Member authority is required for ordinary check-in");
    if (self) await assertBookingMemberAccess({ firestore, transaction, academyId: context.academyId,
      actorId: context.actorId, actorRole: context.actorRole, studentId, now: new Date().toISOString() });
    return;
  }
  const db = firestore as unknown as Firestore;
  const tx = transaction as unknown as Transaction;
  const actor = {uid: context.actorId, academyId: context.academyId, role: context.actorRole};
  await assertCourseActorLive(db, tx, actor);
  const course = data(await transaction.get(firestore.doc(path(context.academyId, "courses", String(session.courseId))))) as Course | undefined;
  const booking = bookings.find(b => b.exists)?.data();
  const source = booking?.source as {kind?: string; courseId?: string; enrolmentId?: string} | undefined;
  if (!course || !["published", "completed"].includes(course.status) || course.academyId !== context.academyId || course.publicationRevision !== session.coursePublicationRevision || booking?.schemaVersion !== "2" || source?.kind !== "course" || source.courseId !== course.courseId || typeof source.enrolmentId !== "string") fail("ineligible", "Approved course access is required");
  const enrolment = data(await transaction.get(firestore.doc(path(context.academyId, "courseEnrolments", source.enrolmentId)))) as CourseEnrolment | undefined;
  if (!enrolment || enrolment.studentId !== studentId || enrolment.academyId !== context.academyId || !canAccessCourseSession(enrolment, {courseId: course.courseId, startAt: String(session.startAt), status: String(session.status)})) fail("ineligible", "Course access is no longer active");
  if (self) await resolveCourseParticipantInTransaction(db, tx, actor, {kind: "student", studentId});
  else await authorizeCourseSessionActor(db, tx, actor, course, studentId);
}

export function createTransactionalAttendanceService(
  options: Readonly<{
    firestore: AttendanceFirestore;
    now?: () => string;
    correctionId?: () => string;
  }>,
): TransactionalAttendanceService {
  const currentTime = (override?: string): string => {
    const value = override ?? options.now?.() ?? new Date().toISOString();
    if (!validDateTime(value)) return fail("invalid", "Operation time is invalid");
    return value;
  };

  return {
    async recordCheckIn(context) {
      const academyId = segment(context.academyId, "academyId");
      const actorId = segment(context.actorId, "actorId");
      const sessionId = segment(context.input.sessionId, "sessionId");
      const studentId = segment(context.input.studentId, "studentId");
      if (!staffRoles.has(context.actorRole) || context.input.method !== "manual") {
        return fail("credential", "Verified self-service check-in is unavailable");
      }
      const occurredAt = currentTime(context.occurredAt);
      const attendanceId = buildAttendanceId(sessionId, studentId);
      const sessionRef = options.firestore.doc(path(academyId, "sessions", sessionId));
      const studentRef = options.firestore.doc(path(academyId, "students", studentId));
      const attendanceRef = options.firestore.doc(path(academyId, "attendance", attendanceId));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `attendance-check-in-${attendanceId}`),
      );
      const overrideAuditRef = options.firestore.doc(
        path(academyId, "auditEvents", `attendance-proximity-override-${attendanceId}`),
      );

      return options.firestore.runTransaction(async (transaction) => {
        const [sessionSnapshot, studentSnapshot, bookings, attendanceSnapshot, auditSnapshot] =
          await Promise.all([
            transaction.get(sessionRef),
            transaction.get(studentRef),
            bookingSnapshots(options.firestore, transaction, academyId, sessionId, studentId),
            transaction.get(attendanceRef),
            transaction.get(auditRef),
          ]);
        const session = requireSession(sessionSnapshot, academyId, sessionId, false);
        requireStudent(studentSnapshot, academyId, studentId);
        await validateCourseAttendance(options.firestore, transaction, sessionSnapshot, bookings, context, studentId, false);
        requireConfirmedBooking(bookings, academyId, sessionId, studentId);
        const existing = storedAttendance(attendanceSnapshot, academyId, sessionId, studentId);
        const draft = auditDraft({
          academyId,
          actorId,
          actorRole: context.actorRole,
          actorIp: context.actorIp ?? null,
          action: "attendance.checked_in",
          targetRef: path(academyId, "attendance", attendanceId),
          correlationId: attendanceId,
          studentId,
          session,
        });
        const overrideDraft = auditDraft({
          academyId,
          actorId,
          actorRole: context.actorRole,
          actorIp: context.actorIp ?? null,
          action: "attendance.proximity_override",
          targetRef: path(academyId, "attendance", attendanceId),
          correlationId: attendanceId,
          studentId,
          session,
        });

        // The proximity signal is judged against the session's own site, and only when that site
        // has coordinates. It never blocks the check-in by itself: an out-of-radius measurement
        // demands a reasoned, separately audited staff override. A retry is judged at the original
        // check-in time, so an identical replay keeps its verdict however long the retry took.
        const locationSnapshot =
          session.locationId === null
            ? undefined
            : await transaction.get(
                options.firestore.doc(path(academyId, "locations", session.locationId)),
              );
        const proximityResult = resolveCheckInProximity({
          ...(context.input.proximity === undefined
            ? {}
            : { measurement: context.input.proximity }),
          siteHasGeofence:
            locationSnapshot === undefined ? false : siteHasGeofence(locationSnapshot),
          ...(context.input.overrideReason === undefined
            ? {}
            : { overrideReason: context.input.overrideReason }),
          nowMs: Date.parse(existing?.occurredAt ?? occurredAt),
        });
        if (!proximityResult.ok) return fail("invalid", proximityResult.error);
        const proximity = proximityResult.value;

        if (existing !== undefined) {
          if (
            existing.method !== "manual" ||
            existing.notes !== (context.input.notes ?? null) ||
            existing.createdBy !== actorId ||
            !sameProximity(existing.proximity, proximity) ||
            !auditSnapshot.exists ||
            !matchesAuditEventReplay(auditSnapshot.data(), auditRef.id, draft)
          ) {
            return fail("conflict", "Attendance replay evidence is invalid");
          }
          return existing;
        }
        if (auditSnapshot.exists) return fail("conflict", "Attendance evidence already exists");

        if (!(await isClassPaymentSettled(options.firestore, transaction, academyId, sessionId, bookings))) {
          return fail("payment", "Class payment must be confirmed before attendance can be recorded");
        }

        const record: AttendanceRecord = Object.freeze({
          ...(typeof data(sessionSnapshot)?.courseId === "string" ? {courseId: String(data(sessionSnapshot)?.courseId)} : {}),
          attendanceId,
          academyId,
          sessionId,
          studentId,
          method: "manual",
          state: determinePunctuality(session.startAt, occurredAt),
          occurredAt,
          notes: context.input.notes ?? null,
          correctionOf: null,
          proximity,
          schemaVersion: "1",
          createdAt: occurredAt,
          createdBy: actorId,
          updatedAt: occurredAt,
          updatedBy: actorId,
        });
        transaction.create(attendanceRef, record as unknown as BookingDocumentData);
        appendAuditEventInTransaction(transaction, auditRef, draft);
        if (proximity.signal === "outside") {
          appendAuditEventInTransaction(transaction, overrideAuditRef, overrideDraft);
        }
        return record;
      });
    },

    /**
     * The member path judges its window, site, accuracy and distance transactionally with server
     * data and time. Position is used only for that decision and is never persisted or audited.
     */
    async recordSelfCheckIn(context) {
      const academyId = segment(context.academyId, "academyId");
      const actorId = segment(context.actorId, "actorId");
      const sessionId = segment(context.input.sessionId, "sessionId");
      const studentId = segment(context.input.studentId, "studentId");
      if (!memberRoles.has(context.actorRole) && !staffRoles.has(context.actorRole) && context.actorRole !== "shopper") {
        return fail("credential", "Member authority is required for self check-in");
      }
      const occurredAt = currentTime(context.occurredAt);
      const attendanceId = buildAttendanceId(sessionId, studentId);
      const sessionRef = options.firestore.doc(path(academyId, "sessions", sessionId));
      const studentRef = options.firestore.doc(path(academyId, "students", studentId));
      const attendanceRef = options.firestore.doc(path(academyId, "attendance", attendanceId));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `attendance-check-in-${attendanceId}`),
      );

      return options.firestore.runTransaction(async (transaction) => {
        const [sessionSnapshot, studentSnapshot, bookings, attendanceSnapshot, auditSnapshot] =
          await Promise.all([
            transaction.get(sessionRef),
            transaction.get(studentRef),
            bookingSnapshots(options.firestore, transaction, academyId, sessionId, studentId),
            transaction.get(attendanceRef),
            transaction.get(auditRef),
          ]);
        const session = requireSession(sessionSnapshot, academyId, sessionId, false);
        requireStudent(studentSnapshot, academyId, studentId);
        const draft = auditDraft({
          academyId,
          actorId,
          actorRole: context.actorRole,
          actorIp: context.actorIp ?? null,
          action: "attendance.checked_in",
          targetRef: path(academyId, "attendance", attendanceId),
          correlationId: attendanceId,
          studentId,
          session,
        });
        await validateCourseAttendance(options.firestore, transaction, sessionSnapshot, bookings, context, studentId, true);
        try {
          requireConfirmedBooking(bookings, academyId, sessionId, studentId);
        } catch (error) {
          if (error instanceof ScheduleAttendanceError) {
            throw new SelfCheckInRefusedError("not_booked");
          }
          throw error;
        }

        const existing = storedAttendance(attendanceSnapshot, academyId, sessionId, studentId);
        if (existing !== undefined) {
          const replay =
            existing.method === "self" &&
            existing.createdBy === actorId &&
            auditSnapshot.exists &&
            matchesAuditEventReplay(auditSnapshot.data(), auditRef.id, draft);
          if (replay) return existing;
          throw new SelfCheckInRefusedError("already_checked_in");
        }
        if (auditSnapshot.exists) return fail("conflict", "Attendance evidence already exists");

        const raw = data(sessionSnapshot) ?? {};
        const endAt = typeof raw.endAt === "string" ? raw.endAt : session.startAt;
        const programId = typeof raw.programId === "string" ? raw.programId : null;
        const [locationSnapshot, programSnapshot] = await Promise.all([
          session.locationId === null
            ? Promise.resolve(undefined)
            : transaction.get(
                options.firestore.doc(path(academyId, "locations", session.locationId)),
              ),
          programId === null
            ? Promise.resolve(undefined)
            : transaction.get(options.firestore.doc(path(academyId, "programs", programId))),
        ]);
        const decision = decideSelfCheckIn({
          session: { startAt: session.startAt, endAt },
          isOpenMat: isOpenMatProgram(
            programSnapshot === undefined
              ? undefined
              : { discipline: data(programSnapshot)?.discipline as never },
          ),
          site: locationSnapshot === undefined ? null : siteGeofence(locationSnapshot),
          position: context.input.position,
          nowMs: Date.parse(occurredAt),
        });
        if (!decision.ok) {
          throw new SelfCheckInRefusedError(decision.error.reason, decision.error.distanceMeters);
        }

        if (!(await isClassPaymentSettled(options.firestore, transaction, academyId, sessionId, bookings))) {
          return fail("payment", "Class payment must be confirmed before attendance can be recorded");
        }

        const record: AttendanceRecord = Object.freeze({
          ...(typeof data(sessionSnapshot)?.courseId === "string" ? {courseId: String(data(sessionSnapshot)?.courseId)} : {}),
          attendanceId,
          academyId,
          sessionId,
          studentId,
          method: "self",
          state: determinePunctuality(session.startAt, occurredAt),
          occurredAt,
          notes: null,
          correctionOf: null,
          proximity: decision.value,
          schemaVersion: "1",
          createdAt: occurredAt,
          createdBy: actorId,
          updatedAt: occurredAt,
          updatedBy: actorId,
        });
        transaction.create(attendanceRef, record as unknown as BookingDocumentData);
        appendAuditEventInTransaction(transaction, auditRef, draft);
        return record;
      });
    },

    async correctAttendance(context) {
      const academyId = segment(context.academyId, "academyId");
      const actorId = segment(context.actorId, "actorId");
      const sessionId = segment(context.input.sessionId, "sessionId");
      const studentId = segment(context.input.studentId, "studentId");
      if (!staffRoles.has(context.actorRole)) {
        return fail("credential", "Staff attendance authority is required");
      }
      if (
        !attendanceStates.includes(context.input.newState) ||
        context.input.reason.trim().length < 2 ||
        context.input.reason.trim().length > 200
      ) {
        return fail("invalid", "Attendance correction is invalid");
      }
      const occurredAt = currentTime(context.occurredAt);
      const canonicalId = buildAttendanceId(sessionId, studentId);
      const correctionId = options.correctionId?.() ?? buildCorrectionAttendanceId();
      if (!correctionIdPattern.test(correctionId)) {
        return fail("invalid", "Correction identifier is invalid");
      }
      const sessionRef = options.firestore.doc(path(academyId, "sessions", sessionId));
      const studentRef = options.firestore.doc(path(academyId, "students", studentId));
      const canonicalRef = options.firestore.doc(path(academyId, "attendance", canonicalId));
      const correctionRef = options.firestore.doc(path(academyId, "attendance", correctionId));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `attendance-correction-${correctionId}`),
      );

      return options.firestore.runTransaction(async (transaction) => {
        const [
          sessionSnapshot,
          studentSnapshot,
          bookings,
          canonicalSnapshot,
          correctionSnapshot,
          auditSnapshot,
        ] = await Promise.all([
          transaction.get(sessionRef),
          transaction.get(studentRef),
          bookingSnapshots(options.firestore, transaction, academyId, sessionId, studentId),
          transaction.get(canonicalRef),
          transaction.get(correctionRef),
          transaction.get(auditRef),
        ]);
        const session = requireSession(sessionSnapshot, academyId, sessionId, true);
        requireStudent(studentSnapshot, academyId, studentId);
        requireConfirmedBooking(bookings, academyId, sessionId, studentId);
        const draft = auditDraft({
          academyId,
          actorId,
          actorRole: context.actorRole,
          actorIp: context.actorIp ?? null,
          action: "attendance.corrected",
          targetRef: path(academyId, "attendance", canonicalId),
          correlationId: correctionId,
          studentId,
          session,
        });
        const existingCanonical = storedAttendance(
          canonicalSnapshot,
          academyId,
          sessionId,
          studentId,
        );
        if (existingCanonical === undefined) {
          return fail("not-found", "Canonical attendance is unavailable");
        }
        if (correctionSnapshot.exists || auditSnapshot.exists) {
          return fail("conflict", "Correction identifier already exists");
        }

        if ((context.input.newState === "attended" || context.input.newState === "late") &&
          !(await isClassPaymentSettled(options.firestore, transaction, academyId, sessionId, bookings))) {
          return fail("payment", "Class payment must be confirmed before attendance can be recorded");
        }

        const correction: AttendanceRecord = Object.freeze({
          ...(typeof data(sessionSnapshot)?.courseId === "string" ? {courseId: String(data(sessionSnapshot)?.courseId)} : {}),
          attendanceId: correctionId,
          academyId,
          sessionId,
          studentId,
          method: existingCanonical.method,
          state: context.input.newState,
          occurredAt,
          notes: context.input.reason.trim(),
          correctionOf: canonicalId,
          schemaVersion: "1",
          createdAt: occurredAt,
          createdBy: actorId,
          updatedAt: occurredAt,
          updatedBy: actorId,
        });
        const canonical: AttendanceRecord = Object.freeze({
          ...existingCanonical,
          state: context.input.newState,
          updatedAt: occurredAt,
          updatedBy: actorId,
        });
        transaction.create(correctionRef, correction as unknown as BookingDocumentData);
        transaction.update(canonicalRef, {
          state: canonical.state,
          updatedAt: canonical.updatedAt,
          updatedBy: canonical.updatedBy,
        });
        appendAuditEventInTransaction(transaction, auditRef, draft);
        return { correction, canonical };
      });
    },

    async recordCheckout(context) {
      const academyId = segment(context.academyId, "academyId");
      const actorId = segment(context.actorId, "actorId");
      const sessionId = segment(context.input.sessionId, "sessionId");
      const studentId = segment(context.input.studentId, "studentId");
      const isStaff = staffRoles.has(context.actorRole);
      if (context.input.method === "independentRelease") {
        return fail("credential", "Independent release policy evidence is unavailable");
      }
      if (context.input.method === "staffOverride") {
        const reason = context.input.notes?.trim() ?? "";
        if (!isStaff || reason.length < 2 || reason.length > 200) {
          return fail("credential", "Staff override authority and reason are required");
        }
      } else if (!memberRoles.has(context.actorRole) && !isStaff) {
        return fail("credential", "Guardian or staff checkout authority is required");
      }

      const authorizedAdultId =
        context.input.method === "authorizedAdult"
          ? segment(context.input.authorizedAdultId, "authorizedAdultId")
          : undefined;
      const authorizedAdultName =
        context.input.method === "authorizedAdult"
          ? (context.input.authorizedAdultName ?? null)
          : null;
      if (context.input.method === "authorizedAdult" && !isStaff && authorizedAdultId !== actorId) {
        return fail("credential", "Guardian must check out as the authenticated adult");
      }
      const occurredAt = currentTime(context.occurredAt);
      const checkoutId = buildCheckoutId(sessionId, studentId);
      const sessionRef = options.firestore.doc(path(academyId, "sessions", sessionId));
      const studentRef = options.firestore.doc(path(academyId, "students", studentId));
      const attendanceRef = options.firestore.doc(
        path(academyId, "attendance", buildAttendanceId(sessionId, studentId)),
      );
      const checkoutRef = options.firestore.doc(path(academyId, "checkouts", checkoutId));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `student-checkout-${checkoutId}`),
      );

      return options.firestore.runTransaction(async (transaction) => {
        const studentSnapshot = await transaction.get(studentRef);
        const student = requireStudent(studentSnapshot, academyId, studentId);
        if (student.participantType !== "minor" || student.familyId === undefined) {
          return fail("ineligible", "Checkout is restricted to linked minors");
        }

        const familyRef = options.firestore.doc(
          path(academyId, "families", segment(student.familyId, "familyId")),
        );
        const relationshipQuery = options.firestore
          .collection(`academies/${academyId}/relationships`)
          .where("studentId", "==", studentId)
          .limit(maximumRelationships + 1);
        const [
          sessionSnapshot,
          bookings,
          attendanceSnapshot,
          checkoutSnapshot,
          auditSnapshot,
          familySnapshot,
          relationshipSnapshot,
        ] = await Promise.all([
          transaction.get(sessionRef),
          bookingSnapshots(options.firestore, transaction, academyId, sessionId, studentId),
          transaction.get(attendanceRef),
          transaction.get(checkoutRef),
          transaction.get(auditRef),
          transaction.get(familyRef),
          transaction.get(relationshipQuery),
        ]);
        const session = requireSession(sessionSnapshot, academyId, sessionId, true);
        requireConfirmedBooking(bookings, academyId, sessionId, studentId);
        const draft = auditDraft({
          academyId,
          actorId,
          actorRole: context.actorRole,
          actorIp: context.actorIp ?? null,
          action: "student.checked_out",
          targetRef: path(academyId, "checkouts", checkoutId),
          correlationId: checkoutId,
          studentId,
          session,
        });
        const attendance = storedAttendance(attendanceSnapshot, academyId, sessionId, studentId);
        if (
          attendance === undefined ||
          (attendance.state !== "attended" && attendance.state !== "late")
        ) {
          return fail("ineligible", "Current attendance is required for checkout");
        }
        const familyValue = data(familySnapshot);
        const parsedFamily = familyValue === undefined ? undefined : parseFamilyRecord(familyValue);
        if (
          parsedFamily === undefined ||
          !parsedFamily.ok ||
          familySnapshot.id !== parsedFamily.value.familyId ||
          parsedFamily.value.familyId !== student.familyId ||
          parsedFamily.value.academyId !== academyId ||
          !parsedFamily.value.active ||
          parsedFamily.value.status !== "active"
        ) {
          return fail("tenant", "Family tenant binding is invalid");
        }
        if (relationshipSnapshot.docs.length > maximumRelationships) {
          return fail("conflict", "Relationship scope is over limit");
        }
        if (context.input.method === "authorizedAdult") {
          if (!authorizedAdultId) return fail("credential", "Authorized adult relationship is unavailable");
          await assertBookingMemberAccess({ firestore: options.firestore, transaction, academyId,
            actorId: authorizedAdultId, actorRole: "guardian", studentId, now: new Date().toISOString(),
            requireVia: "guardian" });
        }


        const existing = storedCheckout(checkoutSnapshot, academyId, sessionId, studentId);
        if (existing !== undefined) {
          if (
            existing.method !== context.input.method ||
            existing.authorizedAdultId !== (authorizedAdultId ?? null) ||
            existing.authorizedAdultName !== authorizedAdultName ||
            existing.notes !== (context.input.notes ?? null) ||
            existing.createdBy !== actorId ||
            !auditSnapshot.exists ||
            !matchesAuditEventReplay(auditSnapshot.data(), auditRef.id, draft)
          ) {
            return fail("conflict", "Checkout replay evidence is invalid");
          }
          return existing;
        }
        if (auditSnapshot.exists) return fail("conflict", "Checkout evidence already exists");

        const record: CheckoutRecord = Object.freeze({
          checkoutId,
          academyId,
          sessionId,
          studentId,
          method: context.input.method,
          authorizedAdultId: authorizedAdultId ?? null,
          authorizedAdultName,
          notes: context.input.notes ?? null,
          checkedOutAt: occurredAt,
          schemaVersion: "1",
          createdAt: occurredAt,
          createdBy: actorId,
          updatedAt: occurredAt,
          updatedBy: actorId,
        });
        transaction.create(checkoutRef, record as unknown as BookingDocumentData);
        appendAuditEventInTransaction(transaction, auditRef, draft);
        return record;
      });
    },
  };
}
