import { evaluateFinancialAccess } from "@bpt-jersey/domain/finance/access";
import {
  evaluatePlanAccess,
  parsePlanRecord,
  type ParticipantType,
  type PlanRecord,
} from "@bpt-jersey/domain/memberships";
import {
  parseMembershipRecord,
  type MembershipRecord,
} from "@bpt-jersey/domain/memberships/lifecycle";
import {
  deriveParticipantType,
  parseStudentProfile,
  type StudentProfile,
} from "@bpt-jersey/domain/profiles";
import {
  buildBookingId,
  buildBookingIdCandidates,
  isWithinBookingCutoff,
  type BookingRecord,
  type CancelBookingInput,
  type ProgramRecord,
  type RequestBookingInput,
  type SessionRecord,
} from "@bpt-jersey/domain/schedule";
import {
  buildWaitlistIdCandidates,
  parseWaitlistEntryRecord,
} from "@bpt-jersey/domain/schedule/advanced-booking";

import {
  readFinancialAccountInTransaction,
  type FinanceFirestore,
  type FinanceTransaction,
} from "../finance/finance-service.js";

type BookingErrorCode =
  "capacity" | "conflict" | "financial" | "ineligible" | "invalid" | "not-found" | "tenant";

export class BookingTransactionError extends Error {
  public constructor(
    public readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BookingTransactionError";
  }
}

export type BookingDocumentData = Readonly<Record<string, unknown>>;
export type BookingDocumentReference = Readonly<{ id: string; path?: string }>;
export type BookingDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => BookingDocumentData | undefined;
}>;
export type BookingQuerySnapshot = Readonly<{ docs: readonly BookingDocumentSnapshot[] }>;
export type BookingQuery = Readonly<{
  where: (field: string, operator: "==" | ">=" | "<", value: unknown) => BookingQuery;
  limit: (count: number) => BookingQuery;
}>;
export type BookingTransaction = Readonly<{
  get: {
    (reference: BookingDocumentReference): Promise<BookingDocumentSnapshot>;
    (query: BookingQuery): Promise<BookingQuerySnapshot>;
  };
  create: (reference: BookingDocumentReference, data: BookingDocumentData) => unknown;
  set: (reference: BookingDocumentReference, data: BookingDocumentData) => unknown;
}>;
export type BookingFirestore = Readonly<{
  doc: (path: string) => BookingDocumentReference;
  collection: (path: string) => BookingQuery;
  runTransaction: <T>(update: (transaction: BookingTransaction) => Promise<T>) => Promise<T>;
}>;

export type ConfirmBookingInTransactionInput = Readonly<{
  firestore: BookingFirestore;
  transaction: BookingTransaction;
  academyId: string;
  request: RequestBookingInput;
  actorId: string;
  now: string;
  reservationWaitlistId?: string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const waitlistDocumentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const maxSessionCapacity = 300;
const weeklySessionLimit = 100;
const queryLimit = maxSessionCapacity;

function invalid(code: BookingErrorCode, message: string): never {
  throw new BookingTransactionError(code, message);
}

function segment(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    return invalid("invalid", label + " is invalid");
  }
  return value;
}

function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (match === null) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function path(academyId: string, name: string): string {
  return "academies/" + academyId + "/" + name;
}

function data(snapshot: BookingDocumentSnapshot, resource: string): BookingDocumentData {
  if (!snapshot.exists) return invalid("not-found", resource + " not found");
  return snapshot.data() ?? invalid("invalid", "Stored " + resource + " is invalid");
}

function session(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  sessionId: string,
): SessionRecord {
  const value = data(snapshot, "session");
  if (snapshot.id !== sessionId || value.sessionId !== sessionId || value.academyId !== academyId) {
    return invalid("tenant", "Session scope is invalid");
  }
  if (
    value.status !== "scheduled" ||
    (value.locationId !== "town" && value.locationId !== "west") ||
    typeof value.programId !== "string" ||
    !identifierPattern.test(value.programId) ||
    !Number.isSafeInteger(value.capacity) ||
    (value.capacity as number) < 1 ||
    (value.capacity as number) > maxSessionCapacity ||
    !validDate(value.startAt) ||
    !validDate(value.endAt) ||
    Date.parse(value.endAt as string) <= Date.parse(value.startAt as string)
  ) {
    return invalid("ineligible", "Session is not eligible for booking");
  }
  return value as SessionRecord;
}

function historicalSession(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  sessionId: string,
): Pick<SessionRecord, "startAt" | "status"> {
  const value = data(snapshot, "session");
  if (snapshot.id !== sessionId || value.sessionId !== sessionId || value.academyId !== academyId) {
    return invalid("tenant", "Session scope is invalid");
  }
  if (
    !["scheduled", "active", "cancelled", "completed"].includes(value.status as string) ||
    !validDate(value.startAt)
  ) {
    return invalid("invalid", "Stored session is invalid");
  }
  return value as Pick<SessionRecord, "startAt" | "status">;
}

function program(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  programId: string,
): ProgramRecord {
  const value = data(snapshot, "program");
  if (snapshot.id !== programId || value.programId !== programId || value.academyId !== academyId) {
    return invalid("tenant", "Program scope is invalid");
  }
  if (
    value.active !== true ||
    !["kids", "teens", "adult", "all"].includes(value.ageBand as string) ||
    !["bjj", "mma", "self-defence", "open-mat"].includes(value.discipline as string)
  ) {
    return invalid("ineligible", "Program is not eligible for booking");
  }
  return value as ProgramRecord;
}

function membership(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  membershipId: string,
  studentId: string,
  now: string,
): MembershipRecord {
  const parsed = parseMembershipRecord(data(snapshot, "membership"));
  if (!parsed.ok) return invalid("invalid", "Stored membership is invalid");
  const value = parsed.value;
  if (
    snapshot.id !== membershipId ||
    value.membershipId !== membershipId ||
    value.academyId !== academyId
  ) {
    return invalid("tenant", "Membership scope is invalid");
  }
  if (
    value.studentId !== studentId ||
    (value.status !== "active" && value.status !== "trial") ||
    Date.parse(value.startsAt) > Date.parse(now) ||
    (value.endsAt !== null && Date.parse(value.endsAt) <= Date.parse(now))
  ) {
    return invalid("ineligible", "Membership is not eligible for booking");
  }
  return value;
}

function plan(snapshot: BookingDocumentSnapshot, academyId: string, planId: string): PlanRecord {
  const parsed = parsePlanRecord(data(snapshot, "plan"));
  if (!parsed.ok) return invalid("invalid", "Stored plan is invalid");
  if (
    snapshot.id !== planId ||
    parsed.value.planId !== planId ||
    parsed.value.academyId !== academyId
  ) {
    return invalid("tenant", "Plan scope is invalid");
  }
  return parsed.value;
}

function student(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  studentId: string,
): StudentProfile {
  const parsed = parseStudentProfile(data(snapshot, "student"));
  if (!parsed.ok) return invalid("invalid", "Stored student is invalid");
  if (
    snapshot.id !== studentId ||
    parsed.value.studentId !== studentId ||
    parsed.value.academyId !== academyId
  ) {
    return invalid("tenant", "Student scope is invalid");
  }
  if (parsed.value.active !== true || parsed.value.status !== "active") {
    return invalid("ineligible", "Student is not eligible for booking");
  }
  return parsed.value;
}

function booking(snapshot: BookingDocumentSnapshot, academyId: string): BookingRecord {
  const value = data(snapshot, "booking");
  if (
    value.bookingId !== snapshot.id ||
    value.academyId !== academyId ||
    typeof value.sessionId !== "string" ||
    !identifierPattern.test(value.sessionId) ||
    typeof value.studentId !== "string" ||
    !identifierPattern.test(value.studentId) ||
    typeof value.membershipId !== "string" ||
    !identifierPattern.test(value.membershipId) ||
    !["requested", "confirmed", "cancelled"].includes(value.status as string) ||
    !validDate(value.requestedAt) ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt)
  ) {
    return invalid("invalid", "Stored booking is invalid");
  }
  return value as BookingRecord;
}

function localParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Jersey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const read = (name: string): string =>
    parts.find((part) => part.type === name)?.value ??
    invalid("invalid", "Session timezone is invalid");
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    weekday: read("weekday"),
  };
}

function weekStart(iso: string): string {
  const local = localParts(iso);
  const offset = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(local.weekday);
  if (offset < 0) return invalid("invalid", "Session weekday is invalid");
  return new Date(Date.UTC(local.year, local.month - 1, local.day - offset))
    .toISOString()
    .slice(0, 10);
}

function localDate(iso: string): string {
  const value = localParts(iso);
  return [value.year, value.month, value.day]
    .map((part, index) => part.toString().padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function audience(
  profile: StudentProfile,
  value: ProgramRecord,
  sessionStartAt: string,
): ParticipantType {
  const sessionDate = localDate(sessionStartAt);
  const lifecycleType = deriveParticipantType(profile.dateOfBirth, sessionDate);
  let actual: ParticipantType = "adult";
  if (lifecycleType === "minor") {
    const birth = profile.dateOfBirth.split("-").map(Number);
    const current = sessionDate.split("-").map(Number);
    let age = current[0]! - birth[0]!;
    if (current[1]! < birth[1]! || (current[1] === birth[1] && current[2]! < birth[2]!)) {
      age -= 1;
    }
    actual = age >= 12 ? "teens" : "kids";
  }
  if (value.ageBand !== "all" && value.ageBand !== actual) {
    return invalid("ineligible", "Student age band is not eligible for this session");
  }
  return actual;
}

function query(
  firestore: BookingFirestore,
  academyId: string,
  name: string,
  field: string,
  value: string,
  limit = queryLimit + 1,
): BookingQuery {
  return firestore.collection(path(academyId, name)).where(field, "==", value).limit(limit);
}

function revision(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  key: string,
  field: "sessionId" | "quotaId",
): number {
  if (!snapshot.exists) return 0;
  const value = data(snapshot, "booking lock");
  if (
    snapshot.id !== key ||
    value.academyId !== academyId ||
    value[field] !== key ||
    value.schemaVersion !== "1" ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  ) {
    return invalid("invalid", "Booking lock is invalid");
  }
  return value.revision as number;
}

function quotaId(studentId: string, week: string): string {
  return "v2:" + studentId.length + ":" + studentId + ":" + week.length + ":" + week;
}

async function weeklyUsage(input: {
  firestore: BookingFirestore;
  transaction: BookingTransaction;
  academyId: string;
  studentId: string;
  week: string;
  currentIds: readonly string[];
}): Promise<number> {
  const weekStartUtc = Date.parse(input.week + "T00:00:00Z");
  if (Number.isNaN(weekStartUtc)) return invalid("invalid", "Booking week is invalid");
  const lowerBound = new Date(weekStartUtc - 2 * 60 * 60 * 1000).toISOString();
  const upperBound = new Date(
    weekStartUtc + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000,
  ).toISOString();
  const sessions = await input.transaction.get(
    input.firestore
      .collection(path(input.academyId, "sessions"))
      .where("startAt", ">=", lowerBound)
      .where("startAt", "<", upperBound)
      .limit(weeklySessionLimit + 1),
  );
  if (sessions.docs.length > weeklySessionLimit) {
    return invalid("invalid", "Weekly session query limit exceeded");
  }
  let used = 0;
  for (const sessionSnapshot of sessions.docs) {
    const historical = historicalSession(sessionSnapshot, input.academyId, sessionSnapshot.id);
    if (historical.status === "cancelled" || weekStart(historical.startAt) !== input.week) {
      continue;
    }
    const ids = buildBookingIdCandidates(sessionSnapshot.id, input.studentId);
    const bookingSnapshots = await Promise.all(
      ids.map((id) =>
        input.transaction.get(input.firestore.doc(path(input.academyId, "bookings") + "/" + id)),
      ),
    );
    const found = bookingSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => booking(snapshot, input.academyId));
    for (const existing of found) {
      if (existing.sessionId !== sessionSnapshot.id || existing.studentId !== input.studentId) {
        return invalid("conflict", "Booking identity collision");
      }
    }
    if (found.length === 2) {
      return invalid("conflict", "Duplicate physical booking versions");
    }
    const existing = found[0];
    if (
      existing !== undefined &&
      existing.sessionId === sessionSnapshot.id &&
      existing.studentId === input.studentId &&
      existing.status === "confirmed" &&
      !input.currentIds.includes(existing.bookingId)
    ) {
      used += 1;
    }
  }
  return used;
}

async function occupancy(input: {
  firestore: BookingFirestore;
  transaction: BookingTransaction;
  academyId: string;
  sessionId: string;
  studentId: string;
  membershipId: string;
  now: string;
  currentIds: readonly string[];
  reservationWaitlistId?: string;
}): Promise<{ confirmed: number; reserved: number }> {
  const snapshot = await input.transaction.get(
    query(input.firestore, input.academyId, "bookings", "sessionId", input.sessionId).where(
      "status",
      "==",
      "confirmed",
    ),
  );
  if (snapshot.docs.length > queryLimit) {
    return invalid("invalid", "Session booking query limit exceeded");
  }
  const students = new Set<string>();
  for (const document of snapshot.docs) {
    const item = booking(document, input.academyId);
    if (
      item.sessionId !== input.sessionId ||
      item.status !== "confirmed" ||
      input.currentIds.includes(item.bookingId)
    ) {
      continue;
    }
    if (students.has(item.studentId)) return invalid("conflict", "Duplicate confirmed booking");
    students.add(item.studentId);
  }
  const waitlist = await input.transaction.get(
    query(
      input.firestore,
      input.academyId,
      "waitlistEntries",
      "sessionId",
      input.sessionId,
      2,
    ).where("status", "==", "offered"),
  );
  if (waitlist.docs.length > 1) {
    return invalid("conflict", "Multiple offered waitlist records");
  }
  const activeOfferIds: string[] = [];
  for (const document of waitlist.docs) {
    const parsed = parseWaitlistEntryRecord(document.data());
    if (!parsed.ok) return invalid("invalid", "Stored waitlist is invalid");
    const entry = parsed.value;
    if (
      document.id !== entry.waitlistId ||
      !buildWaitlistIdCandidates(entry.sessionId, entry.studentId).includes(document.id)
    ) {
      return invalid("conflict", "Waitlist document identity mismatch");
    }
    if (entry.academyId !== input.academyId || entry.sessionId !== input.sessionId) {
      return invalid("tenant", "Waitlist scope is invalid");
    }
    if (
      entry.waitlistId === input.reservationWaitlistId &&
      (entry.studentId !== input.studentId || entry.membershipId !== input.membershipId)
    ) {
      return invalid("conflict", "Waitlist reservation payload mismatch");
    }
    if (
      entry.status === "offered" &&
      entry.offerExpiresAt !== null &&
      Date.parse(entry.offerExpiresAt) > Date.parse(input.now)
    ) {
      activeOfferIds.push(entry.waitlistId);
    }
  }
  if (activeOfferIds.length > 1) {
    return invalid("conflict", "Multiple active waitlist offers");
  }
  if (
    input.reservationWaitlistId !== undefined &&
    !activeOfferIds.includes(input.reservationWaitlistId)
  ) {
    return invalid("conflict", "Waitlist reservation is not active");
  }
  const reserved = activeOfferIds.filter((id) => id !== input.reservationWaitlistId).length;
  return { confirmed: students.size, reserved };
}

async function bookingTarget(input: {
  firestore: BookingFirestore;
  transaction: BookingTransaction;
  academyId: string;
  sessionId: string;
  studentId: string;
}) {
  const ids = buildBookingIdCandidates(input.sessionId, input.studentId);
  const references = ids.map((id) =>
    input.firestore.doc(path(input.academyId, "bookings") + "/" + id),
  );
  const snapshots = await Promise.all(
    references.map((reference) => input.transaction.get(reference)),
  );
  const found = snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => booking(snapshot, input.academyId));
  for (const item of found) {
    if (item.sessionId !== input.sessionId || item.studentId !== input.studentId) {
      return invalid("conflict", "Booking identity collision");
    }
  }
  if (found.length === 2) {
    return invalid("conflict", "Duplicate physical booking versions");
  }
  const index = snapshots[0]!.exists ? 0 : snapshots[1]!.exists ? 1 : 0;
  return { reference: references[index]!, existing: found[0], ids };
}

async function executeBookingInTransaction(
  input: ConfirmBookingInTransactionInput,
  mode: "confirm" | "validate-offer",
): Promise<BookingRecord | undefined> {
  const academyId = segment(input.academyId, "academyId");
  const actorId = segment(input.actorId, "actorId");
  const sessionId = segment(input.request.sessionId, "sessionId");
  const studentId = segment(input.request.studentId, "studentId");
  const membershipId = segment(input.request.membershipId, "membershipId");
  if (!validDate(input.now)) return invalid("invalid", "now is invalid");
  let reservationWaitlistId: string | undefined;
  if (input.reservationWaitlistId !== undefined) {
    if (!waitlistDocumentIdPattern.test(input.reservationWaitlistId)) {
      return invalid("invalid", "reservationWaitlistId is invalid");
    }
    if (!buildWaitlistIdCandidates(sessionId, studentId).includes(input.reservationWaitlistId)) {
      return invalid("conflict", "Waitlist reservation identity mismatch");
    }
    reservationWaitlistId = input.reservationWaitlistId;
  }

  const sessionRef = input.firestore.doc(path(academyId, "sessions") + "/" + sessionId);
  const membershipRef = input.firestore.doc(path(academyId, "memberships") + "/" + membershipId);
  const studentRef = input.firestore.doc(path(academyId, "students") + "/" + studentId);
  const capacityRef = input.firestore.doc(
    path(academyId, "sessionCapacityStates") + "/" + sessionId,
  );
  const [sessionSnapshot, membershipSnapshot, studentSnapshot, capacitySnapshot] =
    await Promise.all([
      input.transaction.get(sessionRef),
      input.transaction.get(membershipRef),
      input.transaction.get(studentRef),
      input.transaction.get(capacityRef),
    ]);
  const storedSession = session(sessionSnapshot, academyId, sessionId);
  const storedMembership = membership(
    membershipSnapshot,
    academyId,
    membershipId,
    studentId,
    input.now,
  );
  const storedStudent = student(studentSnapshot, academyId, studentId);
  if (storedMembership.familyId !== storedStudent.familyId) {
    return invalid("conflict", "Membership family does not match student family");
  }
  const capacityRevision = revision(capacitySnapshot, academyId, sessionId, "sessionId");
  if (!isWithinBookingCutoff(storedSession.startAt, input.now, 60)) {
    return invalid("ineligible", "Booking cutoff has passed");
  }

  const target = await bookingTarget({
    firestore: input.firestore,
    transaction: input.transaction,
    academyId,
    sessionId,
    studentId,
  });
  if (target.existing?.status === "confirmed") {
    if (target.existing.membershipId !== membershipId) {
      return invalid("conflict", "Booking membership mismatch");
    }
    if (mode === "validate-offer") {
      return invalid("ineligible", "Student already has a confirmed booking");
    }
    if (reservationWaitlistId !== undefined) {
      return invalid("conflict", "Offered waitlist already has a confirmed booking");
    }
    return target.existing;
  }

  const [planSnapshot, programSnapshot] = await Promise.all([
    input.transaction.get(
      input.firestore.doc(path(academyId, "plans") + "/" + storedMembership.planId),
    ),
    input.transaction.get(
      input.firestore.doc(path(academyId, "programs") + "/" + storedSession.programId),
    ),
  ]);
  const storedPlan = plan(planSnapshot, academyId, storedMembership.planId);
  const storedProgram = program(programSnapshot, academyId, storedSession.programId);
  const week = weekStart(storedSession.startAt);
  const quotaKey = quotaId(studentId, week);
  const quotaRef = input.firestore.doc(path(academyId, "bookingQuotaStates") + "/" + quotaKey);
  const quotaSnapshot = await input.transaction.get(quotaRef);
  const quotaRevision = revision(quotaSnapshot, academyId, quotaKey, "quotaId");

  const [used, occupied, account] = await Promise.all([
    weeklyUsage({
      firestore: input.firestore,
      transaction: input.transaction,
      academyId,
      studentId,
      week,
      currentIds: target.ids,
    }),
    occupancy({
      firestore: input.firestore,
      transaction: input.transaction,
      academyId,
      sessionId,
      studentId,
      membershipId,
      now: input.now,
      currentIds: target.ids,
      ...(reservationWaitlistId === undefined ? {} : { reservationWaitlistId }),
    }),
    readFinancialAccountInTransaction({
      firestore: input.firestore as unknown as FinanceFirestore,
      transaction: input.transaction as unknown as FinanceTransaction,
      scope: {
        academyId,
        familyIds: [storedMembership.familyId],
        studentIds: [studentId],
      },
    }),
  ]);
  if (
    !evaluateFinancialAccess({
      membershipStatus: storedMembership.status,
      paygDebtMinor: account.paygDebtMinor,
    }).allowed
  ) {
    return invalid("financial", "Financial access is not eligible");
  }
  if (
    !evaluatePlanAccess(storedPlan, {
      participantType: audience(storedStudent, storedProgram, storedSession.startAt),
      site: storedSession.locationId === "town" ? "Town" : "West",
      sessionType: storedProgram.discipline === "open-mat" ? "openMat" : "class",
      weeklyClassesUsed: used,
    }).allowed
  ) {
    return invalid("ineligible", "Plan access is not eligible");
  }
  if (occupied.confirmed + occupied.reserved >= storedSession.capacity) {
    return invalid("capacity", "Session capacity reached");
  }
  if (mode === "validate-offer") return undefined;

  const record: BookingRecord = Object.freeze({
    bookingId: target.reference.id || buildBookingId(sessionId, studentId),
    academyId,
    sessionId,
    studentId,
    membershipId,
    status: "confirmed",
    requestedAt: input.now,
    cancelledAt: null,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: target.existing?.createdAt ?? input.now,
    createdBy: target.existing?.createdBy ?? actorId,
    updatedAt: input.now,
    updatedBy: actorId,
  });
  input.transaction.set(target.reference, record);
  input.transaction.set(capacityRef, {
    academyId,
    sessionId,
    revision: capacityRevision + 1,
    schemaVersion: "1",
    updatedAt: input.now,
    updatedBy: actorId,
  });
  input.transaction.set(quotaRef, {
    academyId,
    quotaId: quotaKey,
    studentId,
    weekStart: week,
    revision: quotaRevision + 1,
    schemaVersion: "1",
    updatedAt: input.now,
    updatedBy: actorId,
  });
  return record;
}

export async function validateBookingOfferInTransaction(
  input: ConfirmBookingInTransactionInput,
): Promise<void> {
  await executeBookingInTransaction(input, "validate-offer");
}

export async function confirmBookingInTransaction(
  input: ConfirmBookingInTransactionInput,
): Promise<BookingRecord> {
  const result = await executeBookingInTransaction(input, "confirm");
  return result ?? invalid("invalid", "Booking confirmation did not produce a record");
}

export async function readConfirmedBookingReplayInTransaction(input: {
  firestore: BookingFirestore;
  transaction: BookingTransaction;
  academyId: string;
  request: RequestBookingInput;
}): Promise<BookingRecord> {
  const academyId = segment(input.academyId, "academyId");
  const sessionId = segment(input.request.sessionId, "sessionId");
  const studentId = segment(input.request.studentId, "studentId");
  const membershipId = segment(input.request.membershipId, "membershipId");
  const target = await bookingTarget({
    firestore: input.firestore,
    transaction: input.transaction,
    academyId,
    sessionId,
    studentId,
  });
  if (target.existing?.status !== "confirmed" || target.existing.membershipId !== membershipId) {
    return invalid("conflict", "Accepted waitlist booking pair is inconsistent");
  }
  return target.existing;
}

async function cancelBookingInTransaction(input: {
  firestore: BookingFirestore;
  transaction: BookingTransaction;
  academyId: string;
  request: CancelBookingInput;
  actorId: string;
  now: string;
  isStaffOverride: boolean;
}): Promise<BookingRecord> {
  const academyId = segment(input.academyId, "academyId");
  const actorId = segment(input.actorId, "actorId");
  const sessionId = segment(input.request.sessionId, "sessionId");
  const studentId = segment(input.request.studentId, "studentId");
  if (!validDate(input.now)) return invalid("invalid", "now is invalid");

  const sessionRef = input.firestore.doc(path(academyId, "sessions") + "/" + sessionId);
  const capacityRef = input.firestore.doc(
    path(academyId, "sessionCapacityStates") + "/" + sessionId,
  );
  const [sessionSnapshot, capacitySnapshot, target] = await Promise.all([
    input.transaction.get(sessionRef),
    input.transaction.get(capacityRef),
    bookingTarget({
      firestore: input.firestore,
      transaction: input.transaction,
      academyId,
      sessionId,
      studentId,
    }),
  ]);
  const storedSession = data(sessionSnapshot, "session");
  if (
    sessionSnapshot.id !== sessionId ||
    storedSession.sessionId !== sessionId ||
    storedSession.academyId !== academyId ||
    !validDate(storedSession.startAt)
  ) {
    return invalid("tenant", "Session scope is invalid");
  }
  const existing = target.existing ?? invalid("not-found", "Booking not found");
  if (existing.status === "cancelled") return existing;
  if (!input.isStaffOverride && !isWithinBookingCutoff(storedSession.startAt, input.now, 60)) {
    return invalid(
      "ineligible",
      "Cannot cancel within 1 hour of session start without staff override",
    );
  }

  const capacityRevision = revision(capacitySnapshot, academyId, sessionId, "sessionId");
  const updated: BookingRecord = Object.freeze({
    ...existing,
    status: "cancelled",
    cancelledAt: input.now,
    cancellationReason: input.request.reason,
    updatedAt: input.now,
    updatedBy: actorId,
  });
  input.transaction.set(target.reference, updated);
  input.transaction.set(capacityRef, {
    academyId,
    sessionId,
    revision: capacityRevision + 1,
    schemaVersion: "1",
    updatedAt: input.now,
    updatedBy: actorId,
  });
  return updated;
}

export function createBookingTransactionService(options: {
  firestore: BookingFirestore;
  now?: () => string;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  return Object.freeze({
    requestBooking(
      academyId: string,
      request: RequestBookingInput,
      actorId: string,
    ): Promise<BookingRecord> {
      const current = now();
      return options.firestore.runTransaction((transaction) =>
        confirmBookingInTransaction({
          firestore: options.firestore,
          transaction,
          academyId,
          request,
          actorId,
          now: current,
        }),
      );
    },
    cancelBooking(
      academyId: string,
      request: CancelBookingInput,
      actorId: string,
      isStaffOverride = false,
    ): Promise<BookingRecord> {
      const current = now();
      return options.firestore.runTransaction((transaction) =>
        cancelBookingInTransaction({
          firestore: options.firestore,
          transaction,
          academyId,
          request,
          actorId,
          now: current,
          isStaffOverride,
        }),
      );
    },
  });
}
