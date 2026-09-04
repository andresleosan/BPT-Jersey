import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { parseFamilyRecord, parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parseStudentProfile, type StudentProfile } from "@bpt-jersey/domain/profiles";
import {
  attendanceStates,
  buildAttendanceId,
  buildBookingIdCandidates,
  buildCheckoutId,
  buildCorrectionAttendanceId,
  determinePunctuality,
  type AttendanceRecord,
  type CheckInInput,
  type CheckoutRecord,
  type CorrectAttendanceInput,
  type RecordCheckoutInput,
} from "@bpt-jersey/domain/schedule";

import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import type {
  BookingDocumentData,
  BookingDocumentReference,
  BookingDocumentSnapshot,
  BookingQuery,
  BookingQuerySnapshot,
} from "./booking-transaction-service.js";

export type ScheduleMutationActorRole =
  "owner" | "administrator" | "headCoach" | "coach" | "guardian" | "adultStudent";

type ScheduleAttendanceErrorCode =
  "conflict" | "credential" | "ineligible" | "invalid" | "not-found" | "tenant";

export class ScheduleAttendanceError extends Error {
  public constructor(
    public readonly code: ScheduleAttendanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScheduleAttendanceError";
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

type MutationContext<Input> = Readonly<{
  academyId: string;
  input: Input;
  actorId: string;
  actorRole: ScheduleMutationActorRole;
  occurredAt?: string;
}>;

export type TransactionalAttendanceService = Readonly<{
  recordCheckIn: (context: MutationContext<CheckInInput>) => Promise<AttendanceRecord>;
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

function auditDraft(
  academyId: string,
  actorId: string,
  action: "attendance.checked_in" | "attendance.corrected" | "student.checked_out",
  targetRef: string,
  correlationId: string,
): AuditEventDraft {
  return {
    academyId,
    actorId,
    action,
    targetRef,
    purpose: "schedule-attendance-operation",
    correlationId,
  } as AuditEventDraft;
}

function requireSession(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  sessionId: string,
  allowCompleted: boolean,
): Readonly<{ startAt: string; status: string }> {
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
  return { startAt: value.startAt, status: String(value.status) };
}

function requireStudent(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  studentId: string,
): StudentProfile {
  const value = data(snapshot);
  if (value === undefined) return fail("not-found", "Student is unavailable");
  const parsed = parseStudentProfile(value);
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

function requireConfirmedBooking(
  snapshots: readonly BookingDocumentSnapshot[],
  academyId: string,
  sessionId: string,
  studentId: string,
): void {
  const existing = snapshots.filter((snapshot) => snapshot.exists);
  if (existing.length === 0) return fail("ineligible", "Confirmed booking is required");
  if (existing.length !== 1) return fail("conflict", "Booking identity is ambiguous");
  const snapshot = existing[0]!;
  const value = data(snapshot);
  if (
    value === undefined ||
    snapshot.id !== value.bookingId ||
    value.academyId !== academyId ||
    value.sessionId !== sessionId ||
    value.studentId !== studentId
  ) {
    return fail("tenant", "Booking tenant binding is invalid");
  }
  if (value.status !== "confirmed") {
    return fail("ineligible", "Confirmed booking is required");
  }
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

function validGuardianRelationship(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  familyId: string,
  studentId: string,
  adultUserId: string,
  nowMs: number,
): boolean {
  const value = data(snapshot);
  if (value === undefined) return false;
  const parsed = parseFamilyRelationship(value);
  if (!parsed.ok) return false;
  const validFromMs = Date.parse(parsed.value.validFrom);
  const validToMs =
    parsed.value.validTo === undefined ? undefined : Date.parse(parsed.value.validTo);
  return (
    snapshot.id === parsed.value.relationshipId &&
    parsed.value.academyId === academyId &&
    parsed.value.familyId === familyId &&
    parsed.value.studentId === studentId &&
    parsed.value.adultUserId === adultUserId &&
    parsed.value.relationshipType === "guardian" &&
    parsed.value.permissions.includes("readProfile") &&
    parsed.value.active &&
    parsed.value.status === "active" &&
    Number.isFinite(validFromMs) &&
    validFromMs <= nowMs &&
    (validToMs === undefined || (Number.isFinite(validToMs) && nowMs < validToMs))
  );
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
      const draft = auditDraft(
        academyId,
        actorId,
        "attendance.checked_in",
        path(academyId, "attendance", attendanceId),
        attendanceId,
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
        requireConfirmedBooking(bookings, academyId, sessionId, studentId);
        const existing = storedAttendance(attendanceSnapshot, academyId, sessionId, studentId);
        if (existing !== undefined) {
          if (
            existing.method !== "manual" ||
            existing.notes !== (context.input.notes ?? null) ||
            existing.createdBy !== actorId ||
            !auditSnapshot.exists ||
            !matchesAuditEventReplay(auditSnapshot.data(), auditRef.id, draft)
          ) {
            return fail("conflict", "Attendance replay evidence is invalid");
          }
          return existing;
        }
        if (auditSnapshot.exists) return fail("conflict", "Attendance evidence already exists");

        const record: AttendanceRecord = Object.freeze({
          attendanceId,
          academyId,
          sessionId,
          studentId,
          method: "manual",
          state: determinePunctuality(session.startAt, occurredAt),
          occurredAt,
          notes: context.input.notes ?? null,
          correctionOf: null,
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
      const draft = auditDraft(
        academyId,
        actorId,
        "attendance.corrected",
        path(academyId, "attendance", canonicalId),
        correctionId,
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
        requireSession(sessionSnapshot, academyId, sessionId, true);
        requireStudent(studentSnapshot, academyId, studentId);
        requireConfirmedBooking(bookings, academyId, sessionId, studentId);
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

        const correction: AttendanceRecord = Object.freeze({
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
      } else if (context.actorRole !== "guardian" && !isStaff) {
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
      const draft = auditDraft(
        academyId,
        actorId,
        "student.checked_out",
        path(academyId, "checkouts", checkoutId),
        checkoutId,
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
        requireSession(sessionSnapshot, academyId, sessionId, true);
        requireConfirmedBooking(bookings, academyId, sessionId, studentId);
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
          const nowMs = Date.parse(occurredAt);
          if (
            authorizedAdultId === undefined ||
            !relationshipSnapshot.docs.some((snapshot) =>
              validGuardianRelationship(
                snapshot,
                academyId,
                student.familyId!,
                studentId,
                authorizedAdultId,
                nowMs,
              ),
            )
          ) {
            return fail("credential", "Authorized adult relationship is unavailable");
          }
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
