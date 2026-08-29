import {
  buildWaitlistId,
  parseWaitlistEntryRecord,
  type JoinWaitlistInput,
  type WaitlistEntryRecord,
} from "@bpt-jersey/domain/schedule/advanced-booking";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";

type ErrorCode = "conflict" | "ineligible" | "invalid" | "not-found" | "tenant";
export class WaitlistStoreError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WaitlistStoreError";
  }
}

export type WaitlistStore = Readonly<{
  joinWaitlist: (input: {
    academyId: string;
    request: JoinWaitlistInput;
    actorId: string;
    now?: string;
  }) => Promise<WaitlistEntryRecord>;
  cancelWaitlist: (input: {
    academyId: string;
    sessionId: string;
    studentId: string;
    actorId: string;
    now?: string;
  }) => Promise<WaitlistEntryRecord>;
  listSessionWaitlist: (
    academyId: string,
    sessionId: string,
  ) => Promise<readonly WaitlistEntryRecord[]>;
  listStudentWaitlist: (
    academyId: string,
    studentId: string,
  ) => Promise<readonly WaitlistEntryRecord[]>;
}>;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const queryLimit = 500;
const listLimit = 200;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value) || Number.isNaN(Date.parse(value))) {
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

function segment(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new WaitlistStoreError("invalid", label + " is invalid");
  }
  return value;
}

function nowValue(value?: string): string {
  const now = value ?? new Date().toISOString();
  if (!validDate(now)) throw new WaitlistStoreError("invalid", "now is invalid");
  return now;
}

function collection(academyId: string, name: string): string {
  return "academies/" + academyId + "/" + name;
}

export function parseStoredWaitlist(
  value: unknown,
  academyId: string,
  documentId?: string,
): WaitlistEntryRecord {
  const parsed = parseWaitlistEntryRecord(value);
  if (!parsed.ok) throw new WaitlistStoreError("invalid", "Stored waitlist entry is invalid");
  const entry = parsed.value;
  if (entry.academyId !== academyId) {
    throw new WaitlistStoreError("tenant", "Waitlist tenant mismatch");
  }
  const expectedId = buildWaitlistId(entry.sessionId, entry.studentId);
  if (entry.waitlistId !== expectedId || (documentId !== undefined && documentId !== expectedId)) {
    throw new WaitlistStoreError("conflict", "Waitlist identity mismatch");
  }
  return entry;
}

function sessionCapacity(
  value: unknown,
  academyId: string,
  sessionId: string,
  now: string,
): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WaitlistStoreError("invalid", "Stored session is invalid");
  }
  const session = value as Record<string, unknown>;
  if (
    session.academyId !== academyId ||
    session.sessionId !== sessionId ||
    session.status !== "scheduled" ||
    !Number.isInteger(session.capacity) ||
    (session.capacity as number) < 1 ||
    (session.capacity as number) > 200 ||
    !validDate(session.startAt) ||
    Date.parse(session.startAt) <= Date.parse(now)
  ) {
    throw new WaitlistStoreError("ineligible", "Session is not eligible for waitlist");
  }
  return session.capacity as number;
}

function assertMembership(
  value: unknown,
  academyId: string,
  membershipId: string,
  studentId: string,
  now: string,
): void {
  const parsed = parseMembershipRecord(value);
  if (!parsed.ok) throw new WaitlistStoreError("invalid", "Stored membership is invalid");
  const membership = parsed.value;
  if (membership.academyId !== academyId) {
    throw new WaitlistStoreError("tenant", "Membership tenant mismatch");
  }
  if (
    membership.membershipId !== membershipId ||
    membership.studentId !== studentId ||
    (membership.status !== "active" && membership.status !== "trial") ||
    !validDate(membership.startsAt) ||
    (membership.endsAt !== null && !validDate(membership.endsAt)) ||
    Date.parse(membership.startsAt) > Date.parse(now) ||
    (membership.endsAt !== null && Date.parse(membership.endsAt) <= Date.parse(now))
  ) {
    throw new WaitlistStoreError("ineligible", "Membership is not eligible for waitlist");
  }
}

function booking(value: unknown, academyId: string, sessionId: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WaitlistStoreError("invalid", "Stored booking is invalid");
  }
  const item = value as Record<string, unknown>;
  if (
    item.academyId !== academyId ||
    item.sessionId !== sessionId ||
    typeof item.studentId !== "string" ||
    !idPattern.test(item.studentId) ||
    (item.status !== "requested" && item.status !== "confirmed" && item.status !== "cancelled")
  ) {
    throw new WaitlistStoreError("invalid", "Stored booking is invalid");
  }
  return { studentId: item.studentId, status: item.status };
}

type DocSnapshot = Readonly<{
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}>;
type DocReference = Readonly<{ id: string }>;
type QuerySnapshot = Readonly<{
  docs: readonly { id: string; data: () => Record<string, unknown> }[];
}>;
type Query = Readonly<{
  where: (field: string, operator: "==", value: unknown) => Query;
  limit: (count: number) => Query;
  get: () => Promise<QuerySnapshot>;
}>;
type Transaction = Readonly<{
  get: {
    (reference: DocReference): Promise<DocSnapshot>;
    (query: Query): Promise<QuerySnapshot>;
  };
  create: (reference: DocReference, data: WaitlistEntryRecord) => void;
  set: (reference: DocReference, data: WaitlistEntryRecord) => void;
}>;
export type GenericWaitlistFirestore = Readonly<{
  doc: (path: string) => DocReference;
  collection: (path: string) => Query;
  runTransaction: <T>(update: (transaction: Transaction) => Promise<T>) => Promise<T>;
}>;

function query(
  firestore: GenericWaitlistFirestore,
  academyId: string,
  name: string,
  field: "sessionId" | "studentId",
  value: string,
  limit: number,
): Query {
  return firestore.collection(collection(academyId, name)).where(field, "==", value).limit(limit);
}

function entries(snapshot: QuerySnapshot, academyId: string): readonly WaitlistEntryRecord[] {
  return snapshot.docs.map((item) => parseStoredWaitlist(item.data(), academyId, item.id));
}

export function createFirestoreWaitlistStore({
  firestore,
}: {
  firestore: GenericWaitlistFirestore;
}): WaitlistStore {
  return Object.freeze({
    async joinWaitlist(input) {
      const academyId = segment(input.academyId, "academyId");
      const actorId = segment(input.actorId, "actorId");
      const sessionId = segment(input.request.sessionId, "sessionId");
      const studentId = segment(input.request.studentId, "studentId");
      const membershipId = segment(input.request.membershipId, "membershipId");
      const now = nowValue(input.now);
      const waitlistId = segment(buildWaitlistId(sessionId, studentId), "waitlistId");
      const sessionRef = firestore.doc(collection(academyId, "sessions") + "/" + sessionId);
      const membershipRef = firestore.doc(
        collection(academyId, "memberships") + "/" + membershipId,
      );
      const waitlistRef = firestore.doc(
        collection(academyId, "waitlistEntries") + "/" + waitlistId,
      );
      const bookingsQuery = query(firestore, academyId, "bookings", "sessionId", sessionId, 201);
      const entriesQuery = query(
        firestore,
        academyId,
        "waitlistEntries",
        "sessionId",
        sessionId,
        queryLimit,
      );

      return firestore.runTransaction(async (transaction) => {
        const [sessionDoc, membershipDoc, currentDoc, bookings, waitlist] = await Promise.all([
          transaction.get(sessionRef),
          transaction.get(membershipRef),
          transaction.get(waitlistRef),
          transaction.get(bookingsQuery),
          transaction.get(entriesQuery),
        ]);
        if (!sessionDoc.exists) throw new WaitlistStoreError("not-found", "Session not found");
        if (!membershipDoc.exists)
          throw new WaitlistStoreError("not-found", "Membership not found");

        if (currentDoc.exists) {
          const current = parseStoredWaitlist(currentDoc.data(), academyId, waitlistId);
          if (current.membershipId !== membershipId) {
            throw new WaitlistStoreError("conflict", "Waitlist membership mismatch");
          }
          if (current.status === "waiting") return current;
          throw new WaitlistStoreError("ineligible", "Waitlist entry cannot be reopened");
        }

        const capacity = sessionCapacity(sessionDoc.data(), academyId, sessionId, now);
        assertMembership(membershipDoc.data(), academyId, membershipId, studentId, now);
        if (bookings.docs.length > 200) {
          throw new WaitlistStoreError("invalid", "Booking query limit exceeded");
        }
        const parsedBookings = bookings.docs.map((item) =>
          booking(item.data(), academyId, sessionId),
        );
        if (
          parsedBookings.some((item) => item.studentId === studentId && item.status === "confirmed")
        ) {
          throw new WaitlistStoreError("ineligible", "Student already has a confirmed booking");
        }
        if (parsedBookings.filter((item) => item.status === "confirmed").length < capacity) {
          throw new WaitlistStoreError("ineligible", "Session still has available capacity");
        }
        if (waitlist.docs.length >= queryLimit) {
          throw new WaitlistStoreError("ineligible", "Waitlist capacity reached");
        }
        const active = entries(waitlist, academyId).filter((item) => item.status === "waiting");
        const position = active.reduce((maximum, item) => Math.max(maximum, item.position), 0) + 1;

        const parsed = parseWaitlistEntryRecord({
          waitlistId,
          academyId,
          sessionId,
          studentId,
          membershipId,
          position,
          status: "waiting",
          requestedAt: now,
          offeredAt: null,
          offerExpiresAt: null,
          acceptedAt: null,
          cancelledAt: null,
          schemaVersion: "1",
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!parsed.ok) throw new WaitlistStoreError("invalid", "Waitlist entry is invalid");
        transaction.create(waitlistRef, parsed.value);
        return parsed.value;
      });
    },

    async cancelWaitlist(input) {
      const academyId = segment(input.academyId, "academyId");
      const actorId = segment(input.actorId, "actorId");
      const sessionId = segment(input.sessionId, "sessionId");
      const studentId = segment(input.studentId, "studentId");
      const now = nowValue(input.now);
      const waitlistId = segment(buildWaitlistId(sessionId, studentId), "waitlistId");
      const reference = firestore.doc(collection(academyId, "waitlistEntries") + "/" + waitlistId);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) throw new WaitlistStoreError("not-found", "Waitlist entry not found");
        const current = parseStoredWaitlist(snapshot.data(), academyId, waitlistId);
        if (current.status === "cancelled") return current;
        if (current.status !== "waiting") {
          throw new WaitlistStoreError("ineligible", "Waitlist entry cannot be cancelled");
        }
        const parsed = parseWaitlistEntryRecord({
          ...current,
          status: "cancelled",
          cancelledAt: now,
          updatedAt: now,
          updatedBy: actorId,
        });
        if (!parsed.ok) throw new WaitlistStoreError("invalid", "Waitlist cancellation is invalid");
        transaction.set(reference, parsed.value);
        return parsed.value;
      });
    },

    async listSessionWaitlist(academyIdInput, sessionIdInput) {
      const academyId = segment(academyIdInput, "academyId");
      const sessionId = segment(sessionIdInput, "sessionId");
      const snapshot = await query(
        firestore,
        academyId,
        "waitlistEntries",
        "sessionId",
        sessionId,
        listLimit,
      ).get();
      return Object.freeze(
        [...entries(snapshot, academyId)].sort(
          (left, right) =>
            left.position - right.position || left.requestedAt.localeCompare(right.requestedAt),
        ),
      );
    },

    async listStudentWaitlist(academyIdInput, studentIdInput) {
      const academyId = segment(academyIdInput, "academyId");
      const studentId = segment(studentIdInput, "studentId");
      const snapshot = await query(
        firestore,
        academyId,
        "waitlistEntries",
        "studentId",
        studentId,
        listLimit,
      ).get();
      return Object.freeze(
        [...entries(snapshot, academyId)].sort(
          (left, right) =>
            right.requestedAt.localeCompare(left.requestedAt) ||
            left.waitlistId.localeCompare(right.waitlistId),
        ),
      );
    },
  });
}
