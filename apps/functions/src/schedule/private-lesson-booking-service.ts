import type { ClassActorRole } from "@bpt-jersey/domain/audit";
import {
  pickCreditPurchase,
  privateLessonCreditUseSchema,
  privateLessonPurchaseSchema,
  type PrivateLessonCreditUse,
  type PrivateLessonPurchase,
} from "@bpt-jersey/domain/private-lessons";
import {
  buildBookingId,
  isPrivateLessonBooking,
  sessionAccessMode,
  type BookingRecord,
  type PrivateLessonBookingRecord,
} from "@bpt-jersey/domain/schedule";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import {
  BookingTransactionError,
  classBookingDraft,
  type BookingDocumentData,
  type BookingFirestore,
  type BookingTransaction,
} from "./booking-transaction-service.js";

export type PrivateLessonBookingCommand = Readonly<{
  academyId: string;
  actorId: string;
  actorRole: ClassActorRole;
  actorIp: string | null;
  studentId: string;
  sessionId: string;
  now: string;
}>;

export type CancelPrivateLessonBookingCommand = Readonly<{
  academyId: string;
  actorId: string;
  actorRole: ClassActorRole;
  actorIp: string | null;
  bookingId: string;
  reason: string;
  now: string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const maxRows = 100;

function fail(
  code: "capacity" | "conflict" | "ineligible" | "invalid" | "not-found" | "tenant",
  message: string,
): never {
  throw new BookingTransactionError(code, message);
}

function identifier(value: string, label: string): string {
  return identifierPattern.test(value) ? value : fail("invalid", `${label} is invalid`);
}

/** ADR-018: only the office arranges private lessons; nobody else books or cancels them. */
function assertOffice(role: ClassActorRole): void {
  if (role !== "owner" && role !== "administrator") {
    fail("tenant", "Private lessons are arranged by the office.");
  }
}

function collection(academyId: string, name: string): string {
  return `academies/${academyId}/${name}`;
}

type StoredSession = Readonly<{
  startAt: string;
  capacity: number | null;
  programId: string;
  locationId: string;
  accessMode?: unknown;
}>;

function storedSession(
  value: BookingDocumentData | undefined,
  academyId: string,
  sessionId: string,
): StoredSession {
  if (!value || value.academyId !== academyId || value.sessionId !== sessionId) {
    return fail("not-found", "Session is not available");
  }
  if (
    typeof value.startAt !== "string" ||
    !Number.isFinite(Date.parse(value.startAt)) ||
    typeof value.programId !== "string" ||
    typeof value.locationId !== "string" ||
    (value.capacity !== null &&
      (!Number.isSafeInteger(value.capacity) || Number(value.capacity) < 1))
  ) {
    return fail("ineligible", "Session is not bookable");
  }
  return value as StoredSession;
}

function isPrivateLessonSession(value: StoredSession): boolean {
  try {
    return sessionAccessMode(value) === "private-lesson";
  } catch {
    return false;
  }
}

function storedPurchase(
  value: BookingDocumentData | undefined,
  academyId: string,
  id: string,
): PrivateLessonPurchase | null {
  if (!value || value.academyId !== academyId) return null;
  const rest: Record<string, unknown> = { ...value };
  delete rest.academyId;
  const parsed = privateLessonPurchaseSchema.safeParse(rest);
  return parsed.success && parsed.data.purchaseId === id ? parsed.data : null;
}

function storedCreditUse(
  value: BookingDocumentData | undefined,
  academyId: string,
  bookingId: string,
): PrivateLessonCreditUse | null {
  if (!value || value.academyId !== academyId) return null;
  const rest: Record<string, unknown> = { ...value };
  delete rest.academyId;
  const parsed = privateLessonCreditUseSchema.safeParse(rest);
  return parsed.success && parsed.data.bookingId === bookingId ? parsed.data : null;
}

function bumpCapacity(
  firestore: BookingFirestore,
  transaction: BookingTransaction,
  academyId: string,
  sessionId: string,
  current: BookingDocumentData | undefined,
  actorId: string,
  now: string,
): void {
  const revision = Number.isSafeInteger(current?.revision) ? Number(current?.revision) : 0;
  transaction.set(firestore.doc(`${collection(academyId, "sessionCapacityStates")}/${sessionId}`), {
    academyId,
    sessionId,
    revision: revision + 1,
    schemaVersion: "1",
    updatedAt: now,
    updatedBy: actorId,
  });
}

export async function bookPrivateLesson(
  firestore: BookingFirestore,
  command: PrivateLessonBookingCommand,
): Promise<PrivateLessonBookingRecord> {
  assertOffice(command.actorRole);
  const academyId = identifier(command.academyId, "academyId");
  const actorId = identifier(command.actorId, "actorId");
  const studentId = identifier(command.studentId, "studentId");
  const sessionId = identifier(command.sessionId, "sessionId");
  if (!Number.isFinite(Date.parse(command.now))) return fail("invalid", "now is invalid");
  const bookingId = buildBookingId(sessionId, studentId);

  return firestore.runTransaction(async (transaction) => {
    const bookingRef = firestore.doc(`${collection(academyId, "bookings")}/${bookingId}`);
    const creditUseRef = firestore.doc(
      `${collection(academyId, "privateLessonCreditUses")}/${bookingId}`,
    );
    const [
      sessionSnapshot,
      capacitySnapshot,
      studentSnapshot,
      bookingSnapshot,
      purchaseSnapshots,
      sessionBookings,
    ] = await Promise.all([
      transaction.get(firestore.doc(`${collection(academyId, "sessions")}/${sessionId}`)),
      transaction.get(
        firestore.doc(`${collection(academyId, "sessionCapacityStates")}/${sessionId}`),
      ),
      transaction.get(firestore.doc(`${collection(academyId, "students")}/${studentId}`)),
      transaction.get(bookingRef),
      transaction.get(
        firestore
          .collection(collection(academyId, "privateLessonPurchases"))
          .where("studentId", "==", studentId)
          .limit(maxRows),
      ),
      transaction.get(
        firestore
          .collection(collection(academyId, "bookings"))
          .where("sessionId", "==", sessionId)
          .limit(maxRows + 1),
      ),
    ]);
    const sessionValue = sessionSnapshot.data();
    const session = storedSession(sessionValue, academyId, sessionId);
    if (!isPrivateLessonSession(session))
      return fail("ineligible", "This session is not a private lesson.");
    if (sessionValue?.status !== "scheduled")
      return fail("ineligible", "This private lesson is not scheduled.");
    if (Date.parse(session.startAt) <= Date.parse(command.now)) {
      return fail("ineligible", "This private lesson has already started.");
    }
    const student = studentSnapshot.data();
    if (
      !student ||
      student.academyId !== academyId ||
      student.studentId !== studentId ||
      student.active !== true ||
      student.status !== "active"
    ) {
      return fail("ineligible", "Student is not eligible");
    }
    const existing = bookingSnapshot.data();
    if (existing) {
      if (existing.academyId !== academyId || existing.bookingId !== bookingId) {
        return fail("tenant", "Booking scope is invalid");
      }
      if (existing.status === "confirmed" && isPrivateLessonBooking(existing as BookingRecord)) {
        return existing as PrivateLessonBookingRecord;
      }
      if (existing.status !== "cancelled")
        return fail("conflict", "This member is already booked on this session.");
    }
    if (sessionBookings.docs.length > maxRows)
      return fail("ineligible", "Session capacity requires office review");
    const confirmed = sessionBookings.docs.filter(
      (doc) => doc.data()?.status === "confirmed",
    ).length;
    if (session.capacity !== null && confirmed >= session.capacity) {
      return fail("capacity", "This private lesson is already booked.");
    }
    const purchases = purchaseSnapshots.docs.flatMap((doc) => {
      const purchase = storedPurchase(doc.data(), academyId, doc.id);
      return purchase && purchase.studentId === studentId ? [purchase] : [];
    });
    const credit = pickCreditPurchase(purchases, command.now);
    if (!credit) return fail("ineligible", "No private lesson credit available.");

    const booking: PrivateLessonBookingRecord = Object.freeze({
      bookingId,
      academyId,
      sessionId,
      studentId,
      membershipId: null,
      source: { kind: "private-lesson" as const, purchaseId: credit.purchaseId },
      status: "confirmed",
      requestedAt: command.now,
      cancelledAt: null,
      cancellationReason: null,
      schemaVersion: "4",
      createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : command.now,
      createdBy: typeof existing?.createdBy === "string" ? existing.createdBy : actorId,
      updatedAt: command.now,
      updatedBy: actorId,
    });
    const creditUse: PrivateLessonCreditUse = {
      bookingId,
      purchaseId: credit.purchaseId,
      studentId,
      sessionId,
      state: "consumed",
      consumedAt: command.now,
      restoredAt: null,
    };
    if (existing) transaction.set(bookingRef, booking);
    else transaction.create(bookingRef, booking);
    transaction.set(
      firestore.doc(`${collection(academyId, "privateLessonPurchases")}/${credit.purchaseId}`),
      { ...credit, academyId, creditsRemaining: credit.creditsRemaining - 1 },
    );
    transaction.set(creditUseRef, { ...creditUse, academyId });
    appendAuditEventInTransaction(
      transaction,
      firestore.collection(collection(academyId, "auditEvents")).doc(),
      classBookingDraft({
        academyId,
        actorId,
        action: "booking.created",
        bookingId,
        studentId,
        sessionId,
        sessionStartAt: session.startAt,
        programId: session.programId,
        locationId: session.locationId,
        actorIp: command.actorIp,
        actorRole: command.actorRole,
      }),
    );
    bumpCapacity(
      firestore,
      transaction,
      academyId,
      sessionId,
      capacitySnapshot.data(),
      actorId,
      command.now,
    );
    return booking;
  });
}

export async function cancelPrivateLessonBooking(
  firestore: BookingFirestore,
  command: CancelPrivateLessonBookingCommand,
): Promise<{ booking: PrivateLessonBookingRecord; creditRestored: boolean }> {
  assertOffice(command.actorRole);
  const academyId = identifier(command.academyId, "academyId");
  const actorId = identifier(command.actorId, "actorId");
  const bookingId = identifier(command.bookingId, "bookingId");
  if (!Number.isFinite(Date.parse(command.now))) return fail("invalid", "now is invalid");

  return firestore.runTransaction(async (transaction) => {
    const bookingRef = firestore.doc(`${collection(academyId, "bookings")}/${bookingId}`);
    const creditUseRef = firestore.doc(
      `${collection(academyId, "privateLessonCreditUses")}/${bookingId}`,
    );
    const [bookingSnapshot, creditUseSnapshot] = await Promise.all([
      transaction.get(bookingRef),
      transaction.get(creditUseRef),
    ]);
    const stored = bookingSnapshot.data();
    if (!stored || stored.academyId !== academyId || stored.bookingId !== bookingId) {
      return fail("not-found", "Booking not found");
    }
    if (!isPrivateLessonBooking(stored as BookingRecord)) {
      return fail("ineligible", "This booking is not a private lesson.");
    }
    const existing = stored as PrivateLessonBookingRecord;
    const creditUse = storedCreditUse(creditUseSnapshot.data(), academyId, bookingId);
    if (existing.status === "cancelled") {
      return { booking: existing, creditRestored: creditUse?.state === "restored" };
    }
    const sessionId = identifier(existing.sessionId, "sessionId");
    const purchaseRef = firestore.doc(
      `${collection(academyId, "privateLessonPurchases")}/${identifier(existing.source.purchaseId, "purchaseId")}`,
    );
    const [sessionSnapshot, capacitySnapshot, purchaseSnapshot] = await Promise.all([
      transaction.get(firestore.doc(`${collection(academyId, "sessions")}/${sessionId}`)),
      transaction.get(
        firestore.doc(`${collection(academyId, "sessionCapacityStates")}/${sessionId}`),
      ),
      transaction.get(purchaseRef),
    ]);
    const session = storedSession(sessionSnapshot.data(), academyId, sessionId);
    const purchase = storedPurchase(purchaseSnapshot.data(), academyId, existing.source.purchaseId);
    // The credit only goes back to a purchase that is still valid; an expired one stays spent.
    const creditRestored =
      creditUse?.state === "consumed" &&
      purchase !== null &&
      purchase.expiresAt !== null &&
      Date.parse(purchase.expiresAt) > Date.parse(command.now) &&
      purchase.creditsRemaining < purchase.creditsGranted;

    const booking: PrivateLessonBookingRecord = Object.freeze({
      ...existing,
      status: "cancelled",
      cancelledAt: command.now,
      cancellationReason: command.reason,
      updatedAt: command.now,
      updatedBy: actorId,
    });
    transaction.set(bookingRef, booking);
    if (creditRestored) {
      transaction.set(purchaseRef, {
        ...purchase,
        academyId,
        creditsRemaining: purchase.creditsRemaining + 1,
      });
      transaction.set(creditUseRef, {
        ...creditUse,
        academyId,
        state: "restored",
        restoredAt: command.now,
      });
    }
    appendAuditEventInTransaction(
      transaction,
      firestore.collection(collection(academyId, "auditEvents")).doc(),
      classBookingDraft({
        academyId,
        actorId,
        action: "booking.cancelled",
        bookingId,
        studentId: existing.studentId,
        sessionId,
        sessionStartAt: session.startAt,
        programId: session.programId,
        locationId: session.locationId,
        actorIp: command.actorIp,
        actorRole: command.actorRole,
      }),
    );
    bumpCapacity(
      firestore,
      transaction,
      academyId,
      sessionId,
      capacitySnapshot.data(),
      actorId,
      command.now,
    );
    return { booking, creditRestored };
  });
}
