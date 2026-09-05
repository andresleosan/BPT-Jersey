import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  buildNoShowPenaltyId,
  decideNoShowPenalty,
  noShowPenaltyAmountMinor,
  noShowPenaltyCurrency,
  resolvedPenaltyStatus,
  type NoShowPenaltyRecord,
  type NoShowPenaltySkipReason,
  type ResolveNoShowPenaltyInput,
} from "@bpt-jersey/domain/penalties";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";

/**
 * T111: the queue behind BRIEF decision 2. A Town no-show earns a penalty PROPOSAL of GBP 15, never
 * a charge: office resolves each one by charging it through the manual billing cycle of T095 or
 * waiving it with a reason, and both decisions are audited. An approved medical leave never earns a
 * proposal.
 */
export type PenaltyErrorCode = "invalid" | "not-found" | "tenant" | "conflict";

export class NoShowPenaltyError extends Error {
  public constructor(
    public readonly code: PenaltyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NoShowPenaltyError";
  }
}

export type PenaltyDocumentData = Readonly<Record<string, unknown>>;
export type PenaltyDocumentReference = Readonly<{ id: string; path?: string }>;
export type PenaltyDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => PenaltyDocumentData | undefined;
}>;
export type PenaltyQuery = Readonly<{
  where: (field: string, operator: "==", value: unknown) => PenaltyQuery;
  limit: (count: number) => PenaltyQuery;
  get: () => Promise<Readonly<{ docs: readonly PenaltyDocumentSnapshot[] }>>;
}>;
export type PenaltyTransaction = Readonly<{
  get: {
    (reference: PenaltyDocumentReference): Promise<PenaltyDocumentSnapshot>;
    (query: PenaltyQuery): Promise<Readonly<{ docs: readonly PenaltyDocumentSnapshot[] }>>;
  };
  create: (reference: PenaltyDocumentReference, data: PenaltyDocumentData) => unknown;
  set: (reference: PenaltyDocumentReference, data: PenaltyDocumentData) => unknown;
}>;
export type PenaltyFirestore = Readonly<{
  doc: (path: string) => PenaltyDocumentReference;
  collection: (path: string) => PenaltyQuery;
  runTransaction: <T>(update: (transaction: PenaltyTransaction) => Promise<T>) => Promise<T>;
}>;

export type ProposeNoShowPenaltiesResult = Readonly<{
  sessionId: string;
  proposed: readonly NoShowPenaltyRecord[];
  /** Absences deliberately left without a penalty, with the reason for each. */
  skipped: readonly Readonly<{ studentId: string; skipReason: NoShowPenaltySkipReason }>[];
  /** Absences that already had a proposal from an earlier run. */
  alreadyProposed: number;
}>;

export type NoShowPenaltyService = Readonly<{
  proposeNoShowPenalties: (
    input: Readonly<{ academyId: string; sessionId: string; actorId: string; now?: string }>,
  ) => Promise<ProposeNoShowPenaltiesResult>;
  listNoShowPenalties: (
    input: Readonly<{ academyId: string; status?: string }>,
  ) => Promise<readonly NoShowPenaltyRecord[]>;
  resolveNoShowPenalty: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      resolution: ResolveNoShowPenaltyInput;
      now?: string;
    }>,
  ) => Promise<NoShowPenaltyRecord>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const maxAttendancePerSession = 500;
const maxMedicalLeavesPerStudent = 100;
const maxPenaltyQueue = 500;

function fail(code: PenaltyErrorCode, message: string): never {
  throw new NoShowPenaltyError(code, message);
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

function auditDraft(
  academyId: string,
  actorId: string,
  action: "penalty.no_show.proposed" | "penalty.no_show.resolved",
  penaltyId: string,
): AuditEventDraft {
  return {
    academyId,
    actorId,
    action,
    targetRef: path(academyId, "noShowPenalties", penaltyId),
    purpose: "schedule-no-show-penalty",
    correlationId: penaltyId,
  } as AuditEventDraft;
}

function storedPenalty(
  snapshot: PenaltyDocumentSnapshot,
  academyId: string,
  penaltyId: string,
): NoShowPenaltyRecord {
  const value = snapshot.exists ? snapshot.data() : undefined;
  if (value === undefined) fail("not-found", "Penalty is unavailable");
  if (
    snapshot.id !== penaltyId ||
    value.penaltyId !== penaltyId ||
    value.academyId !== academyId ||
    typeof value.status !== "string"
  ) {
    fail("tenant", "Penalty tenant binding is invalid");
  }
  return value as unknown as NoShowPenaltyRecord;
}

export function createNoShowPenaltyService(options: {
  firestore: PenaltyFirestore;
  now?: () => string;
}): NoShowPenaltyService {
  const currentTime = (override?: string): string => {
    const value = override ?? options.now?.() ?? new Date().toISOString();
    if (!validDateTime(value)) fail("invalid", "Penalty time is invalid");
    return value;
  };

  return {
    async proposeNoShowPenalties(input) {
      const academyId = segment(input.academyId, "academyId");
      const sessionId = segment(input.sessionId, "sessionId");
      const actorId = segment(input.actorId, "actorId");
      const now = currentTime(input.now);

      const sessionSnapshot = await options.firestore
        .collection(`academies/${academyId}/sessions`)
        .where("sessionId", "==", sessionId)
        .limit(2)
        .get();
      const sessionValue = sessionSnapshot.docs[0]?.data();
      if (sessionSnapshot.docs.length !== 1 || sessionValue === undefined) {
        fail("not-found", "Session is unavailable");
      }
      if (sessionValue.academyId !== academyId || !validDateTime(sessionValue.startAt)) {
        fail("tenant", "Session tenant binding is invalid");
      }
      const locationId = String(sessionValue.locationId ?? "");
      const sessionStartAt = sessionValue.startAt as string;

      const attendance = await options.firestore
        .collection(`academies/${academyId}/attendance`)
        .where("sessionId", "==", sessionId)
        .limit(maxAttendancePerSession + 1)
        .get();
      if (attendance.docs.length > maxAttendancePerSession) {
        fail("conflict", "Session holds more attendance records than one run may review");
      }

      const proposed: NoShowPenaltyRecord[] = [];
      const skipped: Readonly<{ studentId: string; skipReason: NoShowPenaltySkipReason }>[] = [];
      let alreadyProposed = 0;

      for (const document of attendance.docs) {
        const record = document.data();
        if (record === undefined || record.academyId !== academyId) continue;
        // Only the canonical record decides; a correction carries its own state.
        if (typeof record.studentId !== "string" || typeof record.state !== "string") continue;
        const studentId = record.studentId;
        const leaves = await options.firestore
          .collection(`academies/${academyId}/medicalLeaves`)
          .where("studentId", "==", studentId)
          .limit(maxMedicalLeavesPerStudent)
          .get();
        const decision = decideNoShowPenalty({
          locationId,
          attendanceState: record.state,
          sessionStartAt,
          medicalLeaves: leaves.docs
            .map((leave) => leave.data())
            .filter((leave): leave is PenaltyDocumentData => leave !== undefined)
            .map((leave) => ({
              startDate: String(leave.startDate ?? ""),
              endDate: String(leave.endDate ?? ""),
              status: String(leave.status ?? ""),
            })),
        });
        if (!decision.propose) {
          if (decision.skipReason !== "notNoShow") {
            skipped.push(Object.freeze({ studentId, skipReason: decision.skipReason }));
          }
          continue;
        }

        const penaltyId = buildNoShowPenaltyId(sessionId, studentId);
        const penaltyRef = options.firestore.doc(path(academyId, "noShowPenalties", penaltyId));
        const auditRef = options.firestore.doc(
          path(academyId, "auditEvents", `no-show-penalty-proposed-${penaltyId}`),
        );
        const created = await options.firestore.runTransaction(async (transaction) => {
          const existing = await transaction.get(penaltyRef);
          if (existing.exists) return undefined;
          const record: NoShowPenaltyRecord = Object.freeze({
            penaltyId,
            academyId,
            sessionId,
            studentId,
            locationId,
            amountMinor: noShowPenaltyAmountMinor,
            currency: noShowPenaltyCurrency,
            status: "proposed",
            sessionStartAt,
            proposedAt: now,
            proposedBy: actorId,
            resolution: null,
            schemaVersion: "1",
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          });
          transaction.create(penaltyRef, record as unknown as PenaltyDocumentData);
          appendAuditEventInTransaction(
            transaction,
            auditRef,
            auditDraft(academyId, actorId, "penalty.no_show.proposed", penaltyId),
          );
          return record;
        });
        if (created === undefined) alreadyProposed += 1;
        else proposed.push(created);
      }

      return Object.freeze({
        sessionId,
        proposed: Object.freeze(proposed),
        skipped: Object.freeze(skipped),
        alreadyProposed,
      });
    },

    async listNoShowPenalties(input) {
      const academyId = segment(input.academyId, "academyId");
      let queue = options.firestore.collection(`academies/${academyId}/noShowPenalties`);
      if (input.status !== undefined) {
        queue = queue.where("status", "==", input.status);
      }
      const snapshot = await queue.limit(maxPenaltyQueue).get();
      return Object.freeze(
        snapshot.docs
          .map((document) => document.data())
          .filter((value): value is PenaltyDocumentData => value !== undefined)
          .filter((value) => value.academyId === academyId)
          .map((value) => Object.freeze(value as unknown as NoShowPenaltyRecord))
          .sort((left, right) => left.sessionStartAt.localeCompare(right.sessionStartAt)),
      );
    },

    async resolveNoShowPenalty(input) {
      const academyId = segment(input.academyId, "academyId");
      const actorId = segment(input.actorId, "actorId");
      const penaltyId = segment(input.resolution.penaltyId, "penaltyId");
      const now = currentTime(input.now);

      const penaltyRef = options.firestore.doc(path(academyId, "noShowPenalties", penaltyId));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `no-show-penalty-resolved-${penaltyId}`),
      );

      return options.firestore.runTransaction(async (transaction) => {
        const [snapshot, auditSnapshot] = await Promise.all([
          transaction.get(penaltyRef),
          transaction.get(auditRef),
        ]);
        const penalty = storedPenalty(snapshot, academyId, penaltyId);
        // A penalty is resolved once: office may not quietly change a charge into a waiver.
        if (penalty.status !== "proposed" || penalty.resolution !== null || auditSnapshot.exists) {
          fail("conflict", "Penalty is already resolved");
        }

        const resolved: NoShowPenaltyRecord = Object.freeze({
          ...penalty,
          status: resolvedPenaltyStatus(input.resolution.decision),
          resolution: Object.freeze({
            decision: input.resolution.decision,
            reason: input.resolution.reason,
            invoiceId: input.resolution.invoiceId ?? null,
            resolvedAt: now,
            resolvedBy: actorId,
          }),
          updatedAt: now,
          updatedBy: actorId,
        });
        transaction.set(penaltyRef, resolved as unknown as PenaltyDocumentData);
        appendAuditEventInTransaction(
          transaction,
          auditRef,
          auditDraft(academyId, actorId, "penalty.no_show.resolved", penaltyId),
        );
        return resolved;
      });
    },
  };
}
