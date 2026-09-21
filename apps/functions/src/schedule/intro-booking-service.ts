import type { AuditEventDraft, ClassActorRole } from "@bpt-jersey/domain/audit";
import {
  buildBookingId,
  buildBookingIdCandidates,
  isWithinBookingCutoff,
  sessionAccessMode,
  type IntroBookingRecord,
  type SessionRecord,
} from "@bpt-jersey/domain/schedule";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { consentRecordId } from "../consents/consent-identifiers.js";
import { canonicalMemberIdentityIds } from "../members/member-identity-resolution.js";
import {
  assertBookingMemberAccess,
  BookingTransactionError,
  type BookingDocumentData,
  type BookingDocumentReference,
  type BookingFirestore,
  type BookingQuery,
  type BookingTransaction,
} from "./booking-transaction-service.js";

export type IntroBookingCommand = Readonly<{
  academyId: string;
  actorId: string;
  actorRole: ClassActorRole;
  actorIp: string | null;
  studentId: string;
  sessionId: string;
  now: string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const maxQueryRows = 100;
const queryReadLimit = maxQueryRows + 1;

function fail(code: "capacity" | "conflict" | "ineligible" | "invalid" | "tenant", message: string): never {
  throw new BookingTransactionError(code, message);
}

function identifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) return fail("invalid", `${label} is invalid`);
  return value;
}

function academyPath(academyId: string, collection: string): string {
  return `academies/${academyId}/${collection}`;
}

async function bounded(
  transaction: BookingTransaction,
  query: BookingQuery,
  label: string,
) {
  const snapshot = await transaction.get(query.limit(queryReadLimit));
  if (snapshot.docs.length > maxQueryRows) {
    return fail("ineligible", `${label} requires office review`);
  }
  return snapshot.docs;
}

async function identityIds(
  firestore: BookingFirestore,
  transaction: BookingTransaction,
  academyId: string,
  studentId: string,
): Promise<readonly string[]> {
  return canonicalMemberIdentityIds(
    {
      get: async (path) => {
        const snapshot = await transaction.get(firestore.doc(path));
        return {
          id: snapshot.id,
          exists: snapshot.exists,
          data: snapshot.data(),
        };
      },
      listCollection: async (input) => {
        if (input.collection !== "memberIdentityAliases" || !input.equal) {
          return fail("invalid", "Identity query is invalid");
        }
        const docs = await bounded(
          transaction,
          firestore
            .collection(academyPath(input.academyId, input.collection))
            .where(input.equal.field, "==", input.equal.value),
          "Member identity aliases",
        );
        return docs.map((snapshot) => ({
          id: snapshot.id,
          exists: snapshot.exists,
          data: snapshot.data(),
        }));
      },
      create: () => fail("invalid", "Identity writes are unavailable"),
      set: () => fail("invalid", "Identity writes are unavailable"),
      listStudents: () => Promise.resolve([]),
    },
    academyId,
    studentId,
  );
}

function storedSession(
  value: BookingDocumentData | undefined,
  academyId: string,
  sessionId: string,
): SessionRecord {
  if (
    !value ||
    value.academyId !== academyId ||
    value.sessionId !== sessionId ||
    value.status !== "scheduled" ||
    typeof value.startAt !== "string" ||
    typeof value.endAt !== "string" ||
    !Number.isFinite(Date.parse(value.startAt)) ||
    !Number.isFinite(Date.parse(value.endAt)) ||
    Date.parse(value.endAt) <= Date.parse(value.startAt) ||
    (value.capacity !== null &&
      (!Number.isSafeInteger(value.capacity) || Number(value.capacity) < 1 || Number(value.capacity) > 300)) ||
    typeof value.locationId !== "string" ||
    typeof value.programId !== "string"
  ) {
    return fail("ineligible", "Intro session is not bookable");
  }
  try {
    if (sessionAccessMode(value) !== "intro") {
      return fail("ineligible", "Session is not an Intro Class");
    }
  } catch {
    return fail("ineligible", "Session access mode is invalid");
  }
  return value as SessionRecord;
}

function isConfirmedIntroBooking(value: BookingDocumentData): boolean {
  return (
    value.schemaVersion === "3" &&
    value.membershipId === null &&
    typeof value.source === "object" &&
    value.source !== null &&
    (value.source as { kind?: unknown }).kind === "intro" &&
    value.status === "confirmed"
  );
}

async function acceptedCurrentWaiver(
  firestore: BookingFirestore,
  transaction: BookingTransaction,
  academyId: string,
  ids: readonly string[],
  now: string,
): Promise<void> {
  const versions = await transaction.get(
    firestore
      .collection(academyPath(academyId, "waiverVersions"))
      .where("status", "==", "published")
      .limit(2),
  );
  if (versions.docs.length !== 1) return fail("ineligible", "Current waiver is unavailable");
  const version = versions.docs[0]!;
  const value = version.data();
  if (
    !value ||
    value.academyId !== academyId ||
    value.waiverVersionId !== version.id ||
    typeof value.effectiveAt !== "string" ||
    Date.parse(value.effectiveAt) > Date.parse(now)
  ) {
    return fail("ineligible", "Current waiver is invalid");
  }
  const consents = await Promise.all(
    ids.map((studentId) =>
      transaction.get(
        firestore.doc(
          `${academyPath(academyId, "consents")}/${consentRecordId(academyId, studentId, version.id)}`,
        ),
      ),
    ),
  );
  const accepted = consents.some((snapshot, index) => {
    const consent = snapshot.data();
    return (
      snapshot.exists &&
      consent?.academyId === academyId &&
      consent.consentId === snapshot.id &&
      consent.subjectId === ids[index] &&
      consent.waiverVersionId === version.id &&
      consent.status === "accepted" &&
      consent.revokedAt === null
    );
  });
  if (!accepted) return fail("ineligible", "Current waiver has not been accepted");
}

async function assertNoMembershipHistory(
  firestore: BookingFirestore,
  transaction: BookingTransaction,
  academyId: string,
  ids: readonly string[],
): Promise<void> {
  for (const studentId of ids) {
    const docs = await bounded(
      transaction,
      firestore
        .collection(academyPath(academyId, "memberships"))
        .where("studentId", "==", studentId),
      "Membership history",
    );
    for (const snapshot of docs) {
      const value = snapshot.data();
      if (!value || value.academyId !== academyId || value.studentId !== studentId) {
        return fail("tenant", "Membership scope is invalid");
      }
      return fail("ineligible", "Former and current members require office review");
    }
  }
}

async function assertNoIntroAttendance(
  firestore: BookingFirestore,
  transaction: BookingTransaction,
  academyId: string,
  ids: readonly string[],
): Promise<void> {
  const attendance: BookingDocumentData[] = [];
  for (const studentId of ids) {
    const docs = await bounded(
      transaction,
      firestore.collection(academyPath(academyId, "attendance")).where("studentId", "==", studentId),
      "Attendance history",
    );
    for (const snapshot of docs) {
      const value = snapshot.data();
      if (!value || value.academyId !== academyId || value.studentId !== studentId) {
        return fail("tenant", "Attendance scope is invalid");
      }
      if (value.state === "attended" || value.state === "late") attendance.push(value);
    }
  }
  if (attendance.length > maxQueryRows) return fail("ineligible", "Attendance history requires office review");
  const sessions = await Promise.all(
    attendance.map((record) =>
      transaction.get(
        firestore.doc(`${academyPath(academyId, "sessions")}/${identifier(String(record.sessionId), "sessionId")}`),
      ),
    ),
  );
  for (const snapshot of sessions) {
    const value = snapshot.data();
    if (!snapshot.exists || !value || value.academyId !== academyId || value.sessionId !== snapshot.id) {
      return fail("ineligible", "Attendance session history is unavailable");
    }
    try {
      if (sessionAccessMode(value) === "intro") {
        return fail("ineligible", "Intro Class attendance already exists");
      }
    } catch {
      return fail("ineligible", "Attendance session access is invalid");
    }
  }
}

async function introBookings(
  firestore: BookingFirestore,
  transaction: BookingTransaction,
  academyId: string,
  ids: readonly string[],
): Promise<readonly BookingDocumentData[]> {
  const found: BookingDocumentData[] = [];
  for (const studentId of ids) {
    const docs = await bounded(
      transaction,
      firestore.collection(academyPath(academyId, "bookings")).where("studentId", "==", studentId),
      "Booking history",
    );
    for (const snapshot of docs) {
      const value = snapshot.data();
      if (!value || value.academyId !== academyId || value.studentId !== studentId || value.bookingId !== snapshot.id) {
        return fail("tenant", "Booking scope is invalid");
      }
      if (isConfirmedIntroBooking(value)) found.push(value);
    }
  }
  if (found.length > maxQueryRows) return fail("ineligible", "Booking history requires office review");
  return found;
}

async function replayTarget(
  firestore: BookingFirestore,
  transaction: BookingTransaction,
  academyId: string,
  sessionId: string,
  ids: readonly string[],
): Promise<{ reference: BookingDocumentReference; existing?: BookingDocumentData }> {
  const candidates = ids.flatMap((studentId) => buildBookingIdCandidates(sessionId, studentId));
  const refs = candidates.map((id) => firestore.doc(`${academyPath(academyId, "bookings")}/${id}`));
  const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)));
  const existing = snapshots.filter((snapshot) => snapshot.exists);
  if (existing.length > 1) return fail("conflict", "Duplicate booking identities require review");
  const index = existing.length === 0 ? 0 : snapshots.findIndex((snapshot) => snapshot.exists);
  return { reference: refs[index]!, ...(existing[0]?.data() ? { existing: existing[0]!.data()! } : {}) };
}

function auditDraft(command: IntroBookingCommand, booking: IntroBookingRecord, session: SessionRecord): AuditEventDraft {
  return {
    academyId: command.academyId,
    actorId: command.actorId,
    action: "booking.created",
    targetRef: `${academyPath(command.academyId, "bookings")}/${booking.bookingId}`,
    purpose: "class-booking-log",
    correlationId: booking.bookingId,
    class: {
      studentId: booking.studentId,
      memberId: null,
      studentName: null,
      sessionId: booking.sessionId,
      sessionStartAt: session.startAt,
      programId: session.programId,
      locationId: session.locationId,
    },
    actorIp: command.actorIp,
    actorRole: command.actorRole,
    actorGroup: ["owner", "administrator", "headCoach", "coach"].includes(command.actorRole)
      ? "staff"
      : "member",
    actorName: null,
    source: "bpt",
  } as AuditEventDraft;
}

export async function requestIntroBooking(
  firestore: BookingFirestore,
  command: IntroBookingCommand,
): Promise<IntroBookingRecord> {
  const academyId = identifier(command.academyId, "academyId");
  const actorId = identifier(command.actorId, "actorId");
  const requestedStudentId = identifier(command.studentId, "studentId");
  const sessionId = identifier(command.sessionId, "sessionId");
  if (!Number.isFinite(Date.parse(command.now))) return fail("invalid", "now is invalid");

  return firestore.runTransaction(async (transaction) => {
    const ids = await identityIds(firestore, transaction, academyId, requestedStudentId);
    const studentId = ids[0]!;
    await assertBookingMemberAccess({
      firestore,
      transaction,
      academyId,
      actorId,
      studentId,
      actorRole: command.actorRole,
      now: command.now,
    });
    const sessionRef = firestore.doc(`${academyPath(academyId, "sessions")}/${sessionId}`);
    const capacityRef = firestore.doc(`${academyPath(academyId, "sessionCapacityStates")}/${sessionId}`);
    const [sessionSnapshot, capacitySnapshot, studentSnapshot, target] = await Promise.all([
      transaction.get(sessionRef),
      transaction.get(capacityRef),
      transaction.get(firestore.doc(`${academyPath(academyId, "students")}/${studentId}`)),
      replayTarget(firestore, transaction, academyId, sessionId, ids),
    ]);
    const session = storedSession(sessionSnapshot.data(), academyId, sessionId);
    const student = studentSnapshot.data();
    if (
      !studentSnapshot.exists ||
      !student ||
      student.academyId !== academyId ||
      student.studentId !== studentId ||
      student.active !== true ||
      student.status !== "active"
    ) {
      return fail("ineligible", "Student is not eligible");
    }
    const expectedSite = session.locationId === "town" ? "Town" : "West";
    if (student.trainingCenter !== expectedSite) return fail("ineligible", "Intro venue is not eligible");
    if (!isWithinBookingCutoff(session.startAt, command.now, 60)) {
      return fail("ineligible", "Intro booking cutoff has passed");
    }
    if (target.existing) {
      if (
        target.existing.academyId === academyId &&
        target.existing.sessionId === sessionId &&
        ids.includes(String(target.existing.studentId)) &&
        isConfirmedIntroBooking(target.existing)
      ) {
        return target.existing as IntroBookingRecord;
      }
      if (target.existing.status !== "cancelled") {
        return fail("conflict", "Booking identity is already in use");
      }
    }

    await acceptedCurrentWaiver(firestore, transaction, academyId, ids, command.now);
    await assertNoMembershipHistory(firestore, transaction, academyId, ids);
    await assertNoIntroAttendance(firestore, transaction, academyId, ids);
    const priorIntroBookings = await introBookings(firestore, transaction, academyId, ids);
    const otherSessions = await Promise.all(
      priorIntroBookings
        .filter((booking) => booking.sessionId !== sessionId)
        .map((booking) =>
          transaction.get(
            firestore.doc(`${academyPath(academyId, "sessions")}/${identifier(String(booking.sessionId), "sessionId")}`),
          ),
        ),
    );
    if (
      otherSessions.some((snapshot) => {
        const value = snapshot.data();
        return (
          snapshot.exists &&
          value?.academyId === academyId &&
          value.sessionId === snapshot.id &&
          typeof value.startAt === "string" &&
          Date.parse(value.startAt) > Date.parse(command.now) &&
          sessionAccessMode(value) === "intro"
        );
      })
    ) {
      return fail("ineligible", "A future Intro Class booking already exists");
    }

    const capacityBookings = await bounded(
      transaction,
      firestore.collection(academyPath(academyId, "bookings")).where("sessionId", "==", sessionId),
      "Session capacity",
    );
    const confirmed = new Set<string>();
    for (const snapshot of capacityBookings) {
      const value = snapshot.data();
      if (!value || value.academyId !== academyId || value.sessionId !== sessionId) {
        return fail("tenant", "Booking capacity scope is invalid");
      }
      if (value.status === "confirmed" && typeof value.studentId === "string") {
        confirmed.add(value.studentId);
      }
    }
    if (session.capacity !== null && confirmed.size >= session.capacity) {
      return fail("capacity", "Intro Class capacity is no longer available");
    }

    const bookingId = buildBookingId(sessionId, studentId);
    const booking: IntroBookingRecord = Object.freeze({
      bookingId,
      academyId,
      sessionId,
      studentId,
      membershipId: null,
      source: { kind: "intro" },
      status: "confirmed",
      requestedAt: command.now,
      cancelledAt: null,
      cancellationReason: null,
      schemaVersion: "3",
      createdAt: target.existing?.createdAt as string | undefined ?? command.now,
      createdBy: target.existing?.createdBy as string | undefined ?? actorId,
      updatedAt: command.now,
      updatedBy: actorId,
    });
    if (target.existing) transaction.set(target.reference, booking);
    else transaction.create(target.reference, booking);
    const auditRef = firestore.collection(academyPath(academyId, "auditEvents")).doc();
    appendAuditEventInTransaction(transaction, auditRef, auditDraft(command, booking, session));
    const revision =
      capacitySnapshot.exists && Number.isSafeInteger(capacitySnapshot.data()?.revision)
        ? Number(capacitySnapshot.data()?.revision)
        : 0;
    transaction.set(capacityRef, {
      academyId,
      sessionId,
      revision: revision + 1,
      schemaVersion: "1",
      updatedAt: command.now,
      updatedBy: actorId,
    });
    return booking;
  });
}
