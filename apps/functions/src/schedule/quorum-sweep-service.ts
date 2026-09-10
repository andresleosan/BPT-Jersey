import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  decideQuorumSweep,
  quorumCancellationReason,
  type BookingRecord,
  type QuorumSweepDecision,
  type SessionRecord,
} from "@bpt-jersey/domain/schedule";

import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import type {
  BookingDocumentData,
  BookingDocumentSnapshot,
  BookingFirestore,
  BookingTransaction,
} from "./booking-transaction-service.js";

/**
 * T110: cancels a session that never reached its minimum and releases the bookings it held.
 *
 * BRIEF decision 3 asks for an idempotent task: a session needs at least `minParticipants` confirmed
 * bookings one hour before it starts, owner and head coach may raise that minimum, and if it is not
 * reached the session is cancelled and the members who had booked are told in-app. Idempotency is
 * structural rather than bookkept: the sweep only writes when the session is still `scheduled`, so a
 * second run finds it cancelled for this reason and reports that without touching anything. The
 * cancellation, every booking release and the audit event commit in one transaction.
 *
 * The notice itself is derived, not queued: the cancelled session with its canonical reason is what
 * `listClientReminders` turns into an in-app reminder for each member who had booked.
 */
export type QuorumSweepError = "not-found" | "tenant" | "invalid" | "conflict";

export class SessionQuorumSweepError extends Error {
  public constructor(
    public readonly code: QuorumSweepError,
    message: string,
  ) {
    super(message);
    this.name = "SessionQuorumSweepError";
  }
}

export type SessionQuorumSweepResult = QuorumSweepDecision &
  Readonly<{
    sessionId: string;
    /** Bookings moved to `cancelled` by this run; zero on every non-writing outcome. */
    releasedBookings: number;
  }>;

export type QuorumSweepService = Readonly<{
  reconcileSessionQuorum: (
    input: Readonly<{ academyId: string; sessionId: string; actorId: string; now?: string }>,
  ) => Promise<SessionQuorumSweepResult>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const maxBookingsPerSession = 500;

function fail(code: QuorumSweepError, message: string): never {
  throw new SessionQuorumSweepError(code, message);
}

function segment(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail("invalid", `${label} is invalid`);
  }
  return value;
}

function validDateTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function path(academyId: string, collection: string, id: string): string {
  return `academies/${academyId}/${collection}/${id}`;
}

function storedSession(
  snapshot: BookingDocumentSnapshot,
  academyId: string,
  sessionId: string,
): SessionRecord {
  const value = snapshot.exists ? snapshot.data() : undefined;
  if (value === undefined) fail("not-found", "Session is unavailable");
  if (
    snapshot.id !== sessionId ||
    value.sessionId !== sessionId ||
    value.academyId !== academyId ||
    !validDateTime(value.startAt)
  ) {
    fail("tenant", "Session tenant binding is invalid");
  }
  return value as unknown as SessionRecord;
}

function confirmedBookings(
  snapshots: readonly BookingDocumentSnapshot[],
  academyId: string,
  sessionId: string,
): readonly Readonly<{ reference: string; booking: BookingRecord }>[] {
  if (snapshots.length > maxBookingsPerSession) {
    fail("conflict", "Session holds more bookings than one sweep may release");
  }
  const confirmed: Readonly<{ reference: string; booking: BookingRecord }>[] = [];
  for (const snapshot of snapshots) {
    const value = snapshot.exists ? snapshot.data() : undefined;
    if (value === undefined) continue;
    if (value.academyId !== academyId || value.sessionId !== sessionId) {
      fail("tenant", "Booking tenant binding is invalid");
    }
    if (value.status !== "confirmed") continue;
    confirmed.push(
      Object.freeze({
        reference: path(academyId, "bookings", snapshot.id),
        booking: value as unknown as BookingRecord,
      }),
    );
  }
  return Object.freeze(confirmed);
}

export function createQuorumSweepService(options: {
  firestore: BookingFirestore;
  now?: () => string;
}): QuorumSweepService {
  const currentTime = (override?: string): string => {
    const value = override ?? options.now?.() ?? new Date().toISOString();
    if (!validDateTime(value)) fail("invalid", "Sweep time is invalid");
    return value;
  };

  return {
    async reconcileSessionQuorum(input) {
      const academyId = segment(input.academyId, "academyId");
      const sessionId = segment(input.sessionId, "sessionId");
      const actorId = segment(input.actorId, "actorId");
      const now = currentTime(input.now);

      const sessionRef = options.firestore.doc(path(academyId, "sessions", sessionId));
      const capacityRef = options.firestore.doc(
        path(academyId, "sessionCapacityStates", sessionId),
      );
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `session-quorum-cancelled-${sessionId}`),
      );
      const draft = {
        academyId,
        actorId,
        action: "session.quorum.cancelled",
        targetRef: path(academyId, "sessions", sessionId),
        purpose: "schedule-quorum-sweep",
        correlationId: sessionId,
      } as AuditEventDraft;

      return options.firestore.runTransaction(
        async (transaction: BookingTransaction): Promise<SessionQuorumSweepResult> => {
          const [sessionSnapshot, bookingSnapshots, auditSnapshot, capacitySnapshot] =
            await Promise.all([
              transaction.get(sessionRef),
              transaction.get(
                options.firestore
                  .collection(`academies/${academyId}/bookings`)
                  .where("sessionId", "==", sessionId)
                  .limit(maxBookingsPerSession + 1),
              ),
              transaction.get(auditRef),
              transaction.get(capacityRef),
            ]);

          const session = storedSession(sessionSnapshot, academyId, sessionId);
          const confirmed = confirmedBookings(bookingSnapshots.docs, academyId, sessionId);
          const decision = decideQuorumSweep({
            session: {
              startAt: session.startAt,
              status: session.status,
              minParticipants: session.minParticipants,
              cancellationReason: session.cancellationReason,
            },
            confirmedCount: confirmed.length,
            now,
          });

          if (!decision.cancels) {
            // A repeat of a sweep that already cancelled this session must find its evidence.
            if (
              decision.outcome === "alreadyCancelledForQuorum" &&
              (!auditSnapshot.exists ||
                !matchesAuditEventReplay(auditSnapshot.data(), auditRef.id, draft))
            ) {
              fail("conflict", "Quorum cancellation evidence is invalid");
            }
            return Object.freeze({ ...decision, sessionId, releasedBookings: 0 });
          }
          if (auditSnapshot.exists) {
            fail("conflict", "Quorum cancellation evidence already exists");
          }

          const cancelled: SessionRecord = Object.freeze({
            ...session,
            status: "cancelled",
            cancellationReason: quorumCancellationReason,
            updatedAt: now,
            updatedBy: actorId,
          });
          transaction.set(sessionRef, cancelled as unknown as BookingDocumentData);

          // Members must not stay "confirmed" for a class that is off, and the capacity revision
          // moves so any concurrent booking attempt is rejected instead of silently overwritten.
          for (const entry of confirmed) {
            transaction.set(options.firestore.doc(entry.reference), {
              ...entry.booking,
              status: "cancelled",
              cancelledAt: now,
              cancellationReason: quorumCancellationReason,
              updatedAt: now,
              updatedBy: actorId,
            } as unknown as BookingDocumentData);
          }
          const storedRevision = capacitySnapshot.exists ? capacitySnapshot.data() : undefined;
          const revision =
            typeof storedRevision?.revision === "number" &&
            Number.isSafeInteger(storedRevision.revision)
              ? storedRevision.revision
              : 0;
          transaction.set(capacityRef, {
            academyId,
            sessionId,
            revision: revision + 1,
            schemaVersion: "1",
            updatedAt: now,
            updatedBy: actorId,
          });
          appendAuditEventInTransaction(transaction, auditRef, draft);

          return Object.freeze({
            ...decision,
            sessionId,
            releasedBookings: confirmed.length,
          });
        },
      );
    },
  };
}
