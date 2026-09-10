import { createHash } from "node:crypto";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  buildWaitlistId,
  buildWaitlistIdCandidates,
  compareDateTimes,
  parseWaitlistEntryRecord,
  type JoinWaitlistInput,
  type WaitlistEntryRecord,
  type WaitlistOfferResponse,
} from "@bpt-jersey/domain/schedule/advanced-booking";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import {
  confirmBookingInTransaction,
  readConfirmedBookingReplayInTransaction,
  validateBookingOfferInTransaction,
  type BookingFirestore,
  type BookingTransaction,
} from "./booking-transaction-service.js";

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
  issueNextWaitlistOffer: (input: {
    academyId: string;
    sessionId: string;
    actorId: string;
    now?: string;
  }) => Promise<WaitlistEntryRecord>;
  respondToWaitlistOffer: (input: {
    academyId: string;
    sessionId: string;
    studentId: string;
    response: WaitlistOfferResponse;
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
const waitlistDocumentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const maxSessionCapacity = 300;
const waitlistRecordLimit = 500;
const listLimit = waitlistRecordLimit + 1;

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

function waitlistDocumentId(value: unknown): string {
  if (typeof value !== "string" || !waitlistDocumentIdPattern.test(value)) {
    throw new WaitlistStoreError("invalid", "waitlistId is invalid");
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
  const expectedIds = buildWaitlistIdCandidates(entry.sessionId, entry.studentId);
  if (
    !expectedIds.includes(entry.waitlistId) ||
    (documentId !== undefined && documentId !== entry.waitlistId)
  ) {
    throw new WaitlistStoreError("conflict", "Waitlist identity mismatch");
  }
  return entry;
}

function sameLogicalEntry(left: WaitlistEntryRecord, right: WaitlistEntryRecord): boolean {
  return (
    JSON.stringify({ ...left, waitlistId: "" }) === JSON.stringify({ ...right, waitlistId: "" })
  );
}

function deduplicateEntries(
  values: readonly WaitlistEntryRecord[],
): readonly WaitlistEntryRecord[] {
  const byIdentity = new Map<string, WaitlistEntryRecord>();
  for (const entry of values) {
    const key = entry.sessionId + "\u0000" + entry.studentId;
    const existing = byIdentity.get(key);
    if (existing !== undefined && !sameLogicalEntry(existing, entry)) {
      throw new WaitlistStoreError("conflict", "Waitlist versions diverge");
    }
    if (
      existing === undefined ||
      entry.waitlistId === buildWaitlistId(entry.sessionId, entry.studentId)
    ) {
      byIdentity.set(key, entry);
    }
  }
  return Object.freeze([...byIdentity.values()]);
}

function sessionCapacity(
  value: unknown,
  academyId: string,
  sessionId: string,
  now: string,
): { capacity: number; startAt: string } {
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
    (session.capacity as number) > maxSessionCapacity ||
    !validDate(session.startAt) ||
    Date.parse(session.startAt) <= Date.parse(now)
  ) {
    throw new WaitlistStoreError("ineligible", "Session is not eligible for waitlist");
  }
  return { capacity: session.capacity as number, startAt: session.startAt };
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
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}>;
type DocReference = Readonly<{ id: string; path?: string }>;
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
  create: (reference: DocReference, data: Readonly<Record<string, unknown>>) => unknown;
  set: (reference: DocReference, data: Readonly<Record<string, unknown>>) => unknown;
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

function entries(
  snapshot: QuerySnapshot,
  academyId: string,
  maximum = waitlistRecordLimit,
  rejectPhysicalDuplicates = false,
): readonly WaitlistEntryRecord[] {
  const parsed = snapshot.docs.map((item) => parseStoredWaitlist(item.data(), academyId, item.id));
  if (rejectPhysicalDuplicates) {
    const identities = new Set<string>();
    for (const entry of parsed) {
      const identity = entry.sessionId + "\u0000" + entry.studentId;
      if (identities.has(identity)) {
        throw new WaitlistStoreError("conflict", "Duplicate physical waitlist entries");
      }
      identities.add(identity);
    }
  }
  if (snapshot.docs.length > maximum) {
    throw new WaitlistStoreError("ineligible", "Waitlist record limit exceeded");
  }
  return deduplicateEntries(parsed);
}

function lockRevision(snapshot: DocSnapshot, academyId: string, sessionId: string): number {
  if (!snapshot.exists) return 0;
  const value = snapshot.data();
  if (
    value === undefined ||
    value.academyId !== academyId ||
    value.sessionId !== sessionId ||
    value.schemaVersion !== "1" ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  ) {
    throw new WaitlistStoreError("invalid", "Waitlist lock is invalid");
  }
  return value.revision as number;
}

function positionState(
  snapshot: DocSnapshot,
  academyId: string,
  sessionId: string,
): { revision: number; lastPosition: number | null } {
  if (!snapshot.exists) return { revision: 0, lastPosition: null };
  const value = snapshot.data();
  if (
    value === undefined ||
    value.academyId !== academyId ||
    value.sessionId !== sessionId ||
    value.schemaVersion !== "1" ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    (value.lastPosition !== undefined &&
      (!Number.isSafeInteger(value.lastPosition) ||
        (value.lastPosition as number) < 0 ||
        (value.lastPosition as number) > 10_000))
  ) {
    throw new WaitlistStoreError("invalid", "Waitlist position state is invalid");
  }
  return {
    revision: value.revision as number,
    lastPosition: value.lastPosition === undefined ? null : (value.lastPosition as number),
  };
}

function writePositionState(
  transaction: Transaction,
  reference: DocReference,
  academyId: string,
  sessionId: string,
  revision: number,
  lastPosition: number,
  actorId: string,
  now: string,
): void {
  transaction.set(reference, {
    academyId,
    sessionId,
    lastPosition,
    revision: revision + 1,
    schemaVersion: "1",
    updatedAt: now,
    updatedBy: actorId,
  });
}

function writeCapacityState(
  transaction: Transaction,
  reference: DocReference,
  academyId: string,
  sessionId: string,
  revision: number,
  actorId: string,
  now: string,
): void {
  transaction.set(reference, {
    academyId,
    sessionId,
    revision: revision + 1,
    schemaVersion: "1",
    updatedAt: now,
    updatedBy: actorId,
  });
}

async function waitlistTarget(input: {
  firestore: GenericWaitlistFirestore;
  transaction: Transaction;
  academyId: string;
  sessionId: string;
  studentId: string;
}): Promise<{ reference: DocReference; entry: WaitlistEntryRecord | undefined }> {
  const ids = buildWaitlistIdCandidates(input.sessionId, input.studentId);
  const references = ids.map((id) =>
    input.firestore.doc(collection(input.academyId, "waitlistEntries") + "/" + id),
  );
  const snapshots = await Promise.all(
    references.map((reference) => input.transaction.get(reference)),
  );
  const found = snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => parseStoredWaitlist(snapshot.data(), input.academyId, snapshot.id));
  for (const entry of found) {
    if (entry.sessionId !== input.sessionId || entry.studentId !== input.studentId) {
      throw new WaitlistStoreError("conflict", "Waitlist identity collision");
    }
  }
  if (found.length === 2) {
    throw new WaitlistStoreError("conflict", "Duplicate physical waitlist entries");
  }
  const index = snapshots[0]!.exists ? 0 : snapshots[1]!.exists ? 1 : 0;
  return { reference: references[index]!, entry: found[0] };
}

function parseTransition(value: Record<string, unknown>): WaitlistEntryRecord {
  const parsed = parseWaitlistEntryRecord(value);
  if (!parsed.ok) throw new WaitlistStoreError("invalid", "Waitlist transition is invalid");
  return parsed.value;
}

function expireEntry(
  entry: WaitlistEntryRecord,
  actorId: string,
  now: string,
): WaitlistEntryRecord {
  return parseTransition({
    ...entry,
    status: "expired",
    acceptedAt: null,
    cancelledAt: null,
    updatedAt: now,
    updatedBy: actorId,
  });
}

function offerDeadline(startAt: string, now: string): string {
  const nowEpoch = Date.parse(now);
  const expiresAt = Math.min(nowEpoch + 30 * 60 * 1000, Date.parse(startAt) - 60 * 60 * 1000);
  if (expiresAt <= nowEpoch) {
    throw new WaitlistStoreError("ineligible", "The waitlist offer window is closed");
  }
  return new Date(expiresAt).toISOString();
}

function offerEntry(
  entry: WaitlistEntryRecord,
  actorId: string,
  now: string,
  expiresAt: string,
): WaitlistEntryRecord {
  return parseTransition({
    ...entry,
    status: "offered",
    offeredAt: now,
    offerExpiresAt: expiresAt,
    acceptedAt: null,
    cancelledAt: null,
    updatedAt: now,
    updatedBy: actorId,
  });
}

function acceptEntry(
  entry: WaitlistEntryRecord,
  actorId: string,
  now: string,
): WaitlistEntryRecord {
  return parseTransition({
    ...entry,
    status: "accepted",
    acceptedAt: now,
    cancelledAt: null,
    updatedAt: now,
    updatedBy: actorId,
  });
}

function declineEntry(
  entry: WaitlistEntryRecord,
  actorId: string,
  now: string,
): WaitlistEntryRecord {
  return parseTransition({
    ...entry,
    status: "cancelled",
    acceptedAt: null,
    cancelledAt: now,
    updatedAt: now,
    updatedBy: actorId,
  });
}

type WaitlistAuditAction =
  | "waitlist.offer.issued"
  | "waitlist.offer.accepted"
  | "waitlist.offer.declined"
  | "waitlist.offer.expired";

function appendWaitlistAudit(
  firestore: GenericWaitlistFirestore,
  transaction: Transaction,
  entry: WaitlistEntryRecord,
  actorId: string,
  action: WaitlistAuditAction,
): void {
  const digest = createHash("sha256")
    .update(action + "\u0000" + entry.academyId + "\u0000" + entry.waitlistId)
    .digest("hex");
  const actionName = action.slice("waitlist.offer.".length);
  const reference = firestore.doc(
    collection(entry.academyId, "auditEvents") + "/waitlist-offer-" + actionName + "-" + digest,
  );
  appendAuditEventInTransaction(transaction, reference, {
    academyId: entry.academyId,
    actorId,
    action,
    targetRef: collection(entry.academyId, "waitlistEntries") + "/" + entry.waitlistId,
    purpose: "waitlist offer " + actionName,
    correlationId: "waitlist-offer:" + digest,
  } as unknown as AuditEventDraft);
}

async function materializeExpiredOffer(input: {
  firestore: GenericWaitlistFirestore;
  academyId: string;
  sessionId: string;
  studentId: string;
  now: string;
}): Promise<WaitlistEntryRecord> {
  const capacityRef = input.firestore.doc(
    collection(input.academyId, "sessionCapacityStates") + "/" + input.sessionId,
  );
  return input.firestore.runTransaction(async (transaction) => {
    const target = await waitlistTarget({
      firestore: input.firestore,
      transaction,
      academyId: input.academyId,
      sessionId: input.sessionId,
      studentId: input.studentId,
    });
    if (target.entry === undefined) {
      throw new WaitlistStoreError("not-found", "Waitlist entry not found");
    }
    const current = target.entry;
    if (
      current.status !== "offered" ||
      current.offerExpiresAt === null ||
      Date.parse(current.offerExpiresAt) > Date.parse(input.now)
    ) {
      return current;
    }
    const capacityDoc = await transaction.get(capacityRef);
    const capacityRevision = lockRevision(capacityDoc, input.academyId, input.sessionId);
    const expired = expireEntry(current, "system", input.now);
    transaction.set(target.reference, expired);
    writeCapacityState(
      transaction,
      capacityRef,
      input.academyId,
      input.sessionId,
      capacityRevision,
      "system",
      input.now,
    );
    appendWaitlistAudit(input.firestore, transaction, expired, "system", "waitlist.offer.expired");
    return expired;
  });
}

function mapBookingError(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (code === "not-found") {
      throw new WaitlistStoreError("not-found", "Waitlist dependency was not found");
    }
    if (code === "tenant") {
      throw new WaitlistStoreError("tenant", "Waitlist dependency scope is invalid");
    }
    if (code === "invalid") {
      throw new WaitlistStoreError("invalid", "Waitlist dependency is invalid");
    }
    throw new WaitlistStoreError("ineligible", "Waitlist offer is not eligible");
  }
  throw error;
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
      const waitlistId = waitlistDocumentId(buildWaitlistId(sessionId, studentId));
      const sessionRef = firestore.doc(collection(academyId, "sessions") + "/" + sessionId);
      const membershipRef = firestore.doc(
        collection(academyId, "memberships") + "/" + membershipId,
      );
      const positionRef = firestore.doc(
        collection(academyId, "waitlistPositionStates") + "/" + sessionId,
      );
      const bookingsQuery = query(
        firestore,
        academyId,
        "bookings",
        "sessionId",
        sessionId,
        maxSessionCapacity + 1,
      ).where("status", "==", "confirmed");
      const offersQuery = query(
        firestore,
        academyId,
        "waitlistEntries",
        "sessionId",
        sessionId,
        2,
      ).where("status", "==", "offered");
      const entriesQuery = query(
        firestore,
        academyId,
        "waitlistEntries",
        "sessionId",
        sessionId,
        listLimit,
      );

      return firestore.runTransaction(async (transaction) => {
        const [sessionDoc, membershipDoc, positionDoc, bookings, offers, target] =
          await Promise.all([
            transaction.get(sessionRef),
            transaction.get(membershipRef),
            transaction.get(positionRef),
            transaction.get(bookingsQuery),
            transaction.get(offersQuery),
            waitlistTarget({ firestore, transaction, academyId, sessionId, studentId }),
          ]);
        if (!sessionDoc.exists) throw new WaitlistStoreError("not-found", "Session not found");
        if (!membershipDoc.exists)
          throw new WaitlistStoreError("not-found", "Membership not found");

        if (target.entry !== undefined) {
          const current = target.entry;
          if (current.membershipId !== membershipId) {
            throw new WaitlistStoreError("conflict", "Waitlist membership mismatch");
          }
          if (current.status === "waiting") return current;
          throw new WaitlistStoreError("ineligible", "Waitlist entry cannot be reopened");
        }

        const storedSession = sessionCapacity(sessionDoc.data(), academyId, sessionId, now);
        assertMembership(membershipDoc.data(), academyId, membershipId, studentId, now);
        if (bookings.docs.length > maxSessionCapacity) {
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
        const confirmed = parsedBookings.filter((item) => item.status === "confirmed").length;
        const activeOffers = entries(offers, academyId, 1, true).filter(
          (item) =>
            item.status === "offered" &&
            item.offerExpiresAt !== null &&
            Date.parse(item.offerExpiresAt) > Date.parse(now),
        );
        if (activeOffers.length > 1) {
          throw new WaitlistStoreError("conflict", "Multiple active waitlist offers");
        }
        if (confirmed + activeOffers.length < storedSession.capacity) {
          throw new WaitlistStoreError("ineligible", "Session still has available capacity");
        }
        const state = positionState(positionDoc, academyId, sessionId);
        let maximumPosition = state.lastPosition;
        if (maximumPosition === null) {
          const waitlist = await transaction.get(entriesQuery);
          const historical = entries(waitlist, academyId);
          maximumPosition = historical.reduce(
            (maximum, item) => Math.max(maximum, item.position),
            0,
          );
        }
        if (maximumPosition >= 10_000) {
          throw new WaitlistStoreError("ineligible", "Waitlist capacity reached");
        }
        const position = maximumPosition + 1;

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
        transaction.create(target.reference, parsed.value);
        writePositionState(
          transaction,
          positionRef,
          academyId,
          sessionId,
          state.revision,
          position,
          actorId,
          now,
        );
        return parsed.value;
      });
    },

    async cancelWaitlist(input) {
      const academyId = segment(input.academyId, "academyId");
      const actorId = segment(input.actorId, "actorId");
      const sessionId = segment(input.sessionId, "sessionId");
      const studentId = segment(input.studentId, "studentId");
      const now = nowValue(input.now);
      return firestore.runTransaction(async (transaction) => {
        const target = await waitlistTarget({
          firestore,
          transaction,
          academyId,
          sessionId,
          studentId,
        });
        if (target.entry === undefined) {
          throw new WaitlistStoreError("not-found", "Waitlist entry not found");
        }
        const current = target.entry;
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
        transaction.set(target.reference, parsed.value);
        return parsed.value;
      });
    },

    async issueNextWaitlistOffer(input) {
      const academyId = segment(input.academyId, "academyId");
      const actorId = segment(input.actorId, "actorId");
      const sessionId = segment(input.sessionId, "sessionId");
      const now = nowValue(input.now);
      const sessionRef = firestore.doc(collection(academyId, "sessions") + "/" + sessionId);
      const capacityRef = firestore.doc(
        collection(academyId, "sessionCapacityStates") + "/" + sessionId,
      );
      const offeredQuery = query(
        firestore,
        academyId,
        "waitlistEntries",
        "sessionId",
        sessionId,
        2,
      ).where("status", "==", "offered");
      const waitingQuery = query(
        firestore,
        academyId,
        "waitlistEntries",
        "sessionId",
        sessionId,
        listLimit,
      ).where("status", "==", "waiting");

      const outcome: Readonly<
        | { kind: "offered"; entry: WaitlistEntryRecord }
        | { kind: "expired"; entry: WaitlistEntryRecord }
      > = await firestore.runTransaction(async (transaction) => {
        const [sessionDoc, capacityDoc, offeredDocs, waitingDocs] = await Promise.all([
          transaction.get(sessionRef),
          transaction.get(capacityRef),
          transaction.get(offeredQuery),
          transaction.get(waitingQuery),
        ]);
        if (!sessionDoc.exists) {
          throw new WaitlistStoreError("not-found", "Session not found");
        }
        const storedSession = sessionCapacity(sessionDoc.data(), academyId, sessionId, now);
        const currentOffers = entries(offeredDocs, academyId, 1, true);
        const currentOffer = currentOffers[0];
        const currentOfferTarget =
          currentOffer === undefined
            ? undefined
            : await waitlistTarget({
                firestore,
                transaction,
                academyId,
                sessionId,
                studentId: currentOffer.studentId,
              });
        if (currentOffer !== undefined && currentOfferTarget?.entry === undefined) {
          throw new WaitlistStoreError("conflict", "Waitlist offer target is inconsistent");
        }
        if (
          currentOffer !== undefined &&
          currentOffer.offerExpiresAt !== null &&
          Date.parse(currentOffer.offerExpiresAt) > Date.parse(now)
        ) {
          return { kind: "offered" as const, entry: currentOffer };
        }

        const waiting = [...entries(waitingDocs, academyId, waitlistRecordLimit, true)].sort(
          (left, right) =>
            left.position - right.position ||
            compareDateTimes(left.requestedAt, right.requestedAt) ||
            left.waitlistId.localeCompare(right.waitlistId),
        );
        const candidate = waiting[0];
        const candidateTarget =
          candidate === undefined
            ? undefined
            : await waitlistTarget({
                firestore,
                transaction,
                academyId,
                sessionId,
                studentId: candidate.studentId,
              });
        if (candidate !== undefined && candidateTarget?.entry === undefined) {
          throw new WaitlistStoreError("conflict", "Waitlist candidate target is inconsistent");
        }
        const capacityRevision = lockRevision(capacityDoc, academyId, sessionId);
        if (candidate === undefined) {
          if (currentOffer === undefined) {
            throw new WaitlistStoreError("not-found", "No waiting entry is available");
          }
          const expired = expireEntry(currentOffer, actorId, now);
          transaction.set(currentOfferTarget!.reference, expired);
          writeCapacityState(
            transaction,
            capacityRef,
            academyId,
            sessionId,
            capacityRevision,
            actorId,
            now,
          );
          appendWaitlistAudit(firestore, transaction, expired, actorId, "waitlist.offer.expired");
          return { kind: "expired" as const, entry: expired };
        }

        const expiresAt = offerDeadline(storedSession.startAt, now);
        try {
          await validateBookingOfferInTransaction({
            firestore: firestore as unknown as BookingFirestore,
            transaction: transaction as unknown as BookingTransaction,
            academyId,
            request: {
              sessionId,
              studentId: candidate.studentId,
              membershipId: candidate.membershipId,
            },
            actorId,
            now,
          });
        } catch (error) {
          mapBookingError(error);
        }

        if (currentOffer !== undefined) {
          const expired = expireEntry(currentOffer, actorId, now);
          transaction.set(currentOfferTarget!.reference, expired);
          appendWaitlistAudit(firestore, transaction, expired, actorId, "waitlist.offer.expired");
        }
        const offered = offerEntry(candidate, actorId, now, expiresAt);
        transaction.set(candidateTarget!.reference, offered);
        writeCapacityState(
          transaction,
          capacityRef,
          academyId,
          sessionId,
          capacityRevision,
          actorId,
          now,
        );
        appendWaitlistAudit(firestore, transaction, offered, actorId, "waitlist.offer.issued");
        return { kind: "offered" as const, entry: offered };
      });

      if (outcome.kind === "expired") {
        throw new WaitlistStoreError("not-found", "No waiting entry is available");
      }
      return outcome.entry;
    },

    async respondToWaitlistOffer(input) {
      const academyId = segment(input.academyId, "academyId");
      const actorId = segment(input.actorId, "actorId");
      const sessionId = segment(input.sessionId, "sessionId");
      const studentId = segment(input.studentId, "studentId");
      const now = nowValue(input.now);
      const capacityRef = firestore.doc(
        collection(academyId, "sessionCapacityStates") + "/" + sessionId,
      );
      const outcome: Readonly<
        | { kind: "responded"; entry: WaitlistEntryRecord }
        | { kind: "expired"; entry: WaitlistEntryRecord }
      > = await firestore.runTransaction(async (transaction) => {
        const target = await waitlistTarget({
          firestore,
          transaction,
          academyId,
          sessionId,
          studentId,
        });
        if (target.entry === undefined) {
          throw new WaitlistStoreError("not-found", "Waitlist entry not found");
        }
        const current = target.entry;
        if (current.status === "accepted" && input.response === "accept") {
          try {
            await readConfirmedBookingReplayInTransaction({
              firestore: firestore as unknown as BookingFirestore,
              transaction: transaction as unknown as BookingTransaction,
              academyId,
              request: {
                sessionId,
                studentId,
                membershipId: current.membershipId,
              },
            });
          } catch (error) {
            mapBookingError(error);
          }
          return { kind: "responded" as const, entry: current };
        }
        if (
          current.status === "cancelled" &&
          current.offeredAt !== null &&
          input.response === "decline"
        ) {
          return { kind: "responded" as const, entry: current };
        }
        if (current.status !== "offered" || current.offerExpiresAt === null) {
          throw new WaitlistStoreError("ineligible", "Waitlist offer cannot be answered");
        }

        if (Date.parse(current.offerExpiresAt) <= Date.parse(now)) {
          const capacityDoc = await transaction.get(capacityRef);
          const capacityRevision = lockRevision(capacityDoc, academyId, sessionId);
          const expired = expireEntry(current, actorId, now);
          transaction.set(target.reference, expired);
          writeCapacityState(
            transaction,
            capacityRef,
            academyId,
            sessionId,
            capacityRevision,
            actorId,
            now,
          );
          appendWaitlistAudit(firestore, transaction, expired, actorId, "waitlist.offer.expired");
          return { kind: "expired" as const, entry: expired };
        }

        if (input.response === "decline") {
          const capacityDoc = await transaction.get(capacityRef);
          const capacityRevision = lockRevision(capacityDoc, academyId, sessionId);
          const declined = declineEntry(current, actorId, now);
          transaction.set(target.reference, declined);
          writeCapacityState(
            transaction,
            capacityRef,
            academyId,
            sessionId,
            capacityRevision,
            actorId,
            now,
          );
          appendWaitlistAudit(firestore, transaction, declined, actorId, "waitlist.offer.declined");
          return { kind: "responded" as const, entry: declined };
        }

        try {
          await confirmBookingInTransaction({
            firestore: firestore as unknown as BookingFirestore,
            transaction: transaction as unknown as BookingTransaction,
            academyId,
            request: {
              sessionId,
              studentId,
              membershipId: current.membershipId,
            },
            actorId,
            now,
            reservationWaitlistId: current.waitlistId,
          });
        } catch (error) {
          mapBookingError(error);
        }
        const accepted = acceptEntry(current, actorId, now);
        transaction.set(target.reference, accepted);
        appendWaitlistAudit(firestore, transaction, accepted, actorId, "waitlist.offer.accepted");
        return { kind: "responded" as const, entry: accepted };
      });

      if (outcome.kind === "expired") {
        throw new WaitlistStoreError("ineligible", "Waitlist offer has expired");
      }
      return outcome.entry;
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
      const observedAt = new Date().toISOString();
      const current = await Promise.all(
        entries(snapshot, academyId).map((entry) =>
          entry.status === "offered" &&
          entry.offerExpiresAt !== null &&
          Date.parse(entry.offerExpiresAt) <= Date.parse(observedAt)
            ? materializeExpiredOffer({
                firestore,
                academyId,
                sessionId: entry.sessionId,
                studentId: entry.studentId,
                now: observedAt,
              })
            : Promise.resolve(entry),
        ),
      );
      return Object.freeze(
        [...current].sort(
          (left, right) =>
            left.position - right.position ||
            compareDateTimes(left.requestedAt, right.requestedAt) ||
            left.waitlistId.localeCompare(right.waitlistId),
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
      const observedAt = new Date().toISOString();
      const current = await Promise.all(
        entries(snapshot, academyId).map((entry) =>
          entry.status === "offered" &&
          entry.offerExpiresAt !== null &&
          Date.parse(entry.offerExpiresAt) <= Date.parse(observedAt)
            ? materializeExpiredOffer({
                firestore,
                academyId,
                sessionId: entry.sessionId,
                studentId: entry.studentId,
                now: observedAt,
              })
            : Promise.resolve(entry),
        ),
      );
      return Object.freeze(
        [...current].sort(
          (left, right) =>
            compareDateTimes(right.requestedAt, left.requestedAt) ||
            left.waitlistId.localeCompare(right.waitlistId),
        ),
      );
    },
  });
}
