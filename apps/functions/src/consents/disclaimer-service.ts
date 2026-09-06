import { createHash } from "node:crypto";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  appliesToParticipant,
  canonicalizeDisclaimerContent,
  deriveOutstandingDisclaimers,
  disclaimerAcceptanceId,
  disclaimerId as buildDisclaimerId,
  parseDisclaimer,
  parseDisclaimerAcceptance,
  type Disclaimer,
  type DisclaimerAcceptance,
  type DisclaimerAcceptanceInput,
  type DisclaimerPublicationInput,
  type OutstandingDisclaimer,
  type ParticipantType,
} from "@bpt-jersey/domain/consents/disclaimers";
import { parseFamilyRelationship } from "@bpt-jersey/domain/families";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";

/**
 * T117: the store behind manageable disclaimers.
 *
 * Publishing a new version of a key supersedes the previous one in the same transaction, which is
 * what makes an acceptance version-bound rather than key-bound: the old acceptance stays as history
 * and the participant is asked again. Accepting carries the hash the participant was shown, so a
 * text that changed between rendering and pressing accept is refused instead of silently recorded
 * against wording nobody read.
 *
 * No disclaimer text lives in this repository. Office publishes it; the legal wording itself is
 * still blocked by T011.
 */
export type DisclaimerErrorCode =
  "invalid" | "not-found" | "tenant" | "conflict" | "denied" | "stale";

export class DisclaimerError extends Error {
  public constructor(
    public readonly code: DisclaimerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DisclaimerError";
  }
}

export type DisclaimerDocumentData = Readonly<Record<string, unknown>>;
export type DisclaimerDocumentReference = Readonly<{
  id: string;
  path?: string;
  get: () => Promise<DisclaimerDocumentSnapshot>;
}>;
export type DisclaimerDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => DisclaimerDocumentData | undefined;
}>;
export type DisclaimerQuery = Readonly<{
  where: (field: string, operator: "==", value: unknown) => DisclaimerQuery;
  limit: (count: number) => DisclaimerQuery;
  get: () => Promise<Readonly<{ docs: readonly DisclaimerDocumentSnapshot[] }>>;
}>;
export type DisclaimerTransaction = Readonly<{
  get: {
    (reference: DisclaimerDocumentReference): Promise<DisclaimerDocumentSnapshot>;
    (query: DisclaimerQuery): Promise<Readonly<{ docs: readonly DisclaimerDocumentSnapshot[] }>>;
  };
  create: (reference: DisclaimerDocumentReference, data: DisclaimerDocumentData) => unknown;
  set: (reference: DisclaimerDocumentReference, data: DisclaimerDocumentData) => unknown;
}>;
export type DisclaimerFirestore = Readonly<{
  doc: (path: string) => DisclaimerDocumentReference;
  collection: (path: string) => DisclaimerQuery;
  runTransaction: <T>(update: (transaction: DisclaimerTransaction) => Promise<T>) => Promise<T>;
}>;

export type DisclaimerClientRole = "guardian" | "adultStudent";

export type DisclaimerAdoption = Readonly<{
  disclaimer: Disclaimer;
  /** How many live acceptances this exact version holds. Never who. */
  acceptedCount: number;
}>;

export type DisclaimerService = Readonly<{
  publishDisclaimer: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      input: DisclaimerPublicationInput;
      now?: string;
    }>,
  ) => Promise<Disclaimer>;
  withdrawDisclaimer: (
    input: Readonly<{ academyId: string; actorId: string; disclaimerId: string; now?: string }>,
  ) => Promise<Disclaimer>;
  listDisclaimers: (
    input: Readonly<{ academyId: string }>,
  ) => Promise<readonly DisclaimerAdoption[]>;
  getOutstandingDisclaimers: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      role: DisclaimerClientRole;
      studentId: string;
      now?: string;
    }>,
  ) => Promise<readonly OutstandingDisclaimer[]>;
  acceptDisclaimer: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      role: DisclaimerClientRole;
      input: DisclaimerAcceptanceInput;
      now?: string;
    }>,
  ) => Promise<DisclaimerAcceptance>;
  withdrawAcceptance: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      role: DisclaimerClientRole;
      acceptanceId: string;
      now?: string;
    }>,
  ) => Promise<DisclaimerAcceptance>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const maxDisclaimers = 200;
const maxAcceptancesPerStudent = 500;
const maxAcceptancesPerDisclaimer = 5_000;
const maxRelationships = 100;

function fail(code: DisclaimerErrorCode, message: string): never {
  throw new DisclaimerError(code, message);
}

function segment(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail("invalid", `${label} is invalid`);
  }
  return value;
}

function path(academyId: string, collection: string, id: string): string {
  return `academies/${academyId}/${collection}/${id}`;
}

type DisclaimerAction =
  | "disclaimer.published"
  | "disclaimer.withdrawn"
  | "disclaimer.accepted"
  | "disclaimer.acceptance.withdrawn";

function auditDraft(
  academyId: string,
  actorId: string,
  action: DisclaimerAction,
  targetCollection: string,
  targetId: string,
): AuditEventDraft {
  return {
    academyId,
    actorId,
    action,
    targetRef: path(academyId, targetCollection, targetId),
    purpose: "disclaimer-management",
    correlationId: targetId,
  } as AuditEventDraft;
}

function contentHashOf(input: DisclaimerPublicationInput): string {
  return createHash("sha256").update(canonicalizeDisclaimerContent(input), "utf8").digest("hex");
}

function storedDisclaimer(
  value: DisclaimerDocumentData | undefined,
  academyId: string,
): Disclaimer {
  if (value === undefined) fail("not-found", "Disclaimer is unavailable");
  const parsed = parseDisclaimer(value);
  if (!parsed.ok) fail("invalid", "Stored disclaimer is malformed");
  if (parsed.value.academyId !== academyId) fail("tenant", "Disclaimer tenant binding is invalid");
  return parsed.value;
}

export function createDisclaimerService(options: {
  firestore: DisclaimerFirestore;
  now?: () => string;
}): DisclaimerService {
  const currentTime = (override?: string): string => {
    const value = override ?? options.now?.() ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(value))) fail("invalid", "Disclaimer time is invalid");
    return value;
  };

  async function readDisclaimers(academyId: string): Promise<readonly Disclaimer[]> {
    const snapshot = await options.firestore
      .collection(`academies/${academyId}/disclaimers`)
      .limit(maxDisclaimers + 1)
      .get();
    if (snapshot.docs.length > maxDisclaimers) {
      fail("conflict", "Too many disclaimers to evaluate in one read");
    }
    return snapshot.docs
      .map((document) => document.data())
      .filter((value): value is DisclaimerDocumentData => value !== undefined)
      .map((value) => parseDisclaimer(value))
      .filter((parsed) => parsed.ok && parsed.value.academyId === academyId)
      .map((parsed) => (parsed as { value: Disclaimer }).value);
  }

  async function readAcceptances(
    academyId: string,
    field: "studentId" | "disclaimerId",
    value: string,
    limit: number,
  ): Promise<readonly DisclaimerAcceptance[]> {
    const snapshot = await options.firestore
      .collection(`academies/${academyId}/disclaimerAcceptances`)
      .where(field, "==", value)
      .limit(limit + 1)
      .get();
    if (snapshot.docs.length > limit) {
      fail("conflict", "Too many acceptances to evaluate in one read");
    }
    return snapshot.docs
      .map((document) => document.data())
      .filter((data): data is DisclaimerDocumentData => data !== undefined)
      .map((data) => parseDisclaimerAcceptance(data))
      .filter((parsed) => parsed.ok && parsed.value.academyId === academyId)
      .map((parsed) => (parsed as { value: DisclaimerAcceptance }).value);
  }

  /**
   * The participant this actor may act for. Identical in spirit to the waiver of T090: an adult acts
   * only for themselves, a guardian only for a minor they hold a live relationship with.
   */
  async function assertAuthority(
    academyId: string,
    actorId: string,
    role: DisclaimerClientRole,
    studentId: string,
    now: string,
  ): Promise<ParticipantType> {
    const snapshot = await options.firestore.doc(path(academyId, "students", studentId)).get();
    const student = snapshot.exists ? snapshot.data() : undefined;
    if (student === undefined) fail("not-found", "Participant is unavailable");
    if (student.academyId !== academyId || student.studentId !== studentId) {
      fail("tenant", "Participant tenant binding is invalid");
    }
    const participantType = student.participantType;
    if (participantType !== "adult" && participantType !== "minor") {
      fail("invalid", "Participant type is unknown");
    }

    if (role === "adultStudent") {
      if (participantType !== "adult" || student.userId !== actorId) {
        fail("denied", "Disclaimer scope is not permitted");
      }
      return "adult";
    }
    if (participantType !== "minor") fail("denied", "Disclaimer scope is not permitted");
    const relationships = await options.firestore
      .collection(`academies/${academyId}/relationships`)
      .where("studentId", "==", studentId)
      .limit(maxRelationships)
      .get();
    const permitted = relationships.docs.some((document) => {
      const parsed = parseFamilyRelationship(document.data());
      return (
        parsed.ok &&
        parsed.value.academyId === academyId &&
        parsed.value.studentId === studentId &&
        parsed.value.adultUserId === actorId &&
        parsed.value.active &&
        parsed.value.status === "active" &&
        parsed.value.validFrom <= now &&
        (parsed.value.validTo === undefined || parsed.value.validTo > now)
      );
    });
    if (!permitted) fail("denied", "Disclaimer scope is not permitted");
    return "minor";
  }

  return {
    async publishDisclaimer(request) {
      const academyId = segment(request.academyId, "academyId");
      const actorId = segment(request.actorId, "actorId");
      const now = currentTime(request.now);
      const contentHash = contentHashOf(request.input);
      const identifier = buildDisclaimerId(request.input.key, request.input.versionLabel);

      const disclaimer: Disclaimer = Object.freeze({
        disclaimerId: identifier,
        academyId,
        key: request.input.key,
        versionLabel: request.input.versionLabel,
        title: request.input.title,
        body: request.input.body,
        audience: request.input.audience,
        required: request.input.required,
        contentHash,
        status: "published" as const,
        effectiveAt: request.input.effectiveAt,
        publishedAt: now,
        publishedBy: actorId,
        supersededBy: null,
        withdrawnAt: null,
        schemaVersion: "1" as const,
      });
      const validated = parseDisclaimer(disclaimer);
      if (!validated.ok) fail("invalid", "Disclaimer is invalid");

      // Read the siblings outside the transaction: the write below re-reads what it changes.
      const existing = await readDisclaimers(academyId);
      const previous = existing.filter(
        (candidate) => candidate.key === disclaimer.key && candidate.status === "published",
      );

      const disclaimerRef = options.firestore.doc(path(academyId, "disclaimers", identifier));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `disclaimer-published-${identifier}`),
      );
      await options.firestore.runTransaction(async (transaction) => {
        const [current, auditSnapshot] = await Promise.all([
          transaction.get(disclaimerRef),
          transaction.get(auditRef),
        ]);
        // Republishing a label is a conflict, never a silent overwrite of text people accepted.
        if (current.exists || auditSnapshot.exists) {
          fail("conflict", "This disclaimer version already exists");
        }
        transaction.create(disclaimerRef, disclaimer as unknown as DisclaimerDocumentData);
        for (const superseded of previous) {
          transaction.set(
            options.firestore.doc(path(academyId, "disclaimers", superseded.disclaimerId)),
            {
              ...superseded,
              status: "superseded",
              supersededBy: identifier,
            } as unknown as DisclaimerDocumentData,
          );
        }
        appendAuditEventInTransaction(
          transaction as never,
          auditRef as never,
          auditDraft(academyId, actorId, "disclaimer.published", "disclaimers", identifier),
        );
      });
      return disclaimer;
    },

    async withdrawDisclaimer(request) {
      const academyId = segment(request.academyId, "academyId");
      const actorId = segment(request.actorId, "actorId");
      const identifier = segment(request.disclaimerId, "disclaimerId");
      const now = currentTime(request.now);

      const disclaimerRef = options.firestore.doc(path(academyId, "disclaimers", identifier));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `disclaimer-withdrawn-${identifier}`),
      );
      return options.firestore.runTransaction(async (transaction) => {
        const [snapshot, auditSnapshot] = await Promise.all([
          transaction.get(disclaimerRef),
          transaction.get(auditRef),
        ]);
        const current = storedDisclaimer(snapshot.exists ? snapshot.data() : undefined, academyId);
        if (current.status === "withdrawn" || auditSnapshot.exists) {
          fail("conflict", "Disclaimer is already withdrawn");
        }
        const next: Disclaimer = Object.freeze({
          ...current,
          status: "withdrawn" as const,
          withdrawnAt: now,
        });
        transaction.set(disclaimerRef, next as unknown as DisclaimerDocumentData);
        appendAuditEventInTransaction(
          transaction as never,
          auditRef as never,
          auditDraft(academyId, actorId, "disclaimer.withdrawn", "disclaimers", identifier),
        );
        return next;
      });
    },

    async listDisclaimers(request) {
      const academyId = segment(request.academyId, "academyId");
      const disclaimers = await readDisclaimers(academyId);
      const adoption = await Promise.all(
        disclaimers.map(async (disclaimer) => {
          const acceptances = await readAcceptances(
            academyId,
            "disclaimerId",
            disclaimer.disclaimerId,
            maxAcceptancesPerDisclaimer,
          );
          return Object.freeze({
            disclaimer,
            acceptedCount: acceptances.filter((entry) => entry.status === "accepted").length,
          });
        }),
      );
      return Object.freeze(
        [...adoption].sort(
          (left, right) =>
            left.disclaimer.key.localeCompare(right.disclaimer.key) ||
            right.disclaimer.publishedAt.localeCompare(left.disclaimer.publishedAt),
        ),
      );
    },

    async getOutstandingDisclaimers(request) {
      const academyId = segment(request.academyId, "academyId");
      const actorId = segment(request.actorId, "actorId");
      const studentId = segment(request.studentId, "studentId");
      const now = currentTime(request.now);
      const participantType = await assertAuthority(
        academyId,
        actorId,
        request.role,
        studentId,
        now,
      );
      const [disclaimers, acceptances] = await Promise.all([
        readDisclaimers(academyId),
        readAcceptances(academyId, "studentId", studentId, maxAcceptancesPerStudent),
      ]);
      return deriveOutstandingDisclaimers({
        disclaimers,
        acceptances,
        studentId,
        participantType,
        now,
      });
    },

    async acceptDisclaimer(request) {
      const academyId = segment(request.academyId, "academyId");
      const actorId = segment(request.actorId, "actorId");
      const studentId = segment(request.input.studentId, "studentId");
      const identifier = segment(request.input.disclaimerId, "disclaimerId");
      const now = currentTime(request.now);
      const participantType = await assertAuthority(
        academyId,
        actorId,
        request.role,
        studentId,
        now,
      );

      const disclaimerSnapshot = await options.firestore
        .doc(path(academyId, "disclaimers", identifier))
        .get();
      const disclaimer = storedDisclaimer(
        disclaimerSnapshot.exists ? disclaimerSnapshot.data() : undefined,
        academyId,
      );
      if (disclaimer.status !== "published") {
        fail("conflict", "This disclaimer is no longer open for acceptance");
      }
      if (!appliesToParticipant(disclaimer, participantType)) {
        fail("denied", "This disclaimer does not apply to this participant");
      }
      // The hash the participant was shown. A mismatch means the text moved under them.
      if (disclaimer.contentHash !== request.input.contentHash) {
        fail("stale", "The disclaimer text changed; it must be read again");
      }

      const acceptanceIdValue = disclaimerAcceptanceId(identifier, studentId);
      const acceptance: DisclaimerAcceptance = Object.freeze({
        acceptanceId: acceptanceIdValue,
        academyId,
        disclaimerId: identifier,
        key: disclaimer.key,
        versionLabel: disclaimer.versionLabel,
        contentHash: disclaimer.contentHash,
        studentId,
        acceptedBy: actorId,
        acceptedAt: now,
        withdrawnAt: null,
        status: "accepted" as const,
        schemaVersion: "1" as const,
      });
      const validated = parseDisclaimerAcceptance(acceptance);
      if (!validated.ok) fail("invalid", "Acceptance is invalid");

      const acceptanceRef = options.firestore.doc(
        path(academyId, "disclaimerAcceptances", acceptanceIdValue),
      );
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `disclaimer-accepted-${acceptanceIdValue}`),
      );
      await options.firestore.runTransaction(async (transaction) => {
        const [current, auditSnapshot] = await Promise.all([
          transaction.get(acceptanceRef),
          transaction.get(auditRef),
        ]);
        if (current.exists && auditSnapshot.exists) {
          const existing = parseDisclaimerAcceptance(current.data());
          // Re-accepting after a withdrawal is a new decision and is allowed to overwrite.
          if (existing.ok && existing.value.status === "accepted") {
            fail("conflict", "This version is already accepted for this participant");
          }
          transaction.set(acceptanceRef, acceptance as unknown as DisclaimerDocumentData);
          return;
        }
        transaction.set(acceptanceRef, acceptance as unknown as DisclaimerDocumentData);
        appendAuditEventInTransaction(
          transaction as never,
          auditRef as never,
          auditDraft(
            academyId,
            actorId,
            "disclaimer.accepted",
            "disclaimerAcceptances",
            acceptanceIdValue,
          ),
        );
      });
      return acceptance;
    },

    async withdrawAcceptance(request) {
      const academyId = segment(request.academyId, "academyId");
      const actorId = segment(request.actorId, "actorId");
      const acceptanceIdValue = segment(request.acceptanceId, "acceptanceId");
      const now = currentTime(request.now);

      const acceptanceRef = options.firestore.doc(
        path(academyId, "disclaimerAcceptances", acceptanceIdValue),
      );
      const snapshot = await acceptanceRef.get();
      const existing = parseDisclaimerAcceptance(snapshot.exists ? snapshot.data() : undefined);
      if (!existing.ok) fail("not-found", "Acceptance is unavailable");
      if (existing.value.academyId !== academyId) {
        fail("tenant", "Acceptance tenant binding is invalid");
      }
      // The same authority that could accept is the authority that can take it back.
      await assertAuthority(academyId, actorId, request.role, existing.value.studentId, now);
      if (existing.value.status === "withdrawn")
        fail("conflict", "Acceptance is already withdrawn");

      const next: DisclaimerAcceptance = Object.freeze({
        ...existing.value,
        status: "withdrawn" as const,
        withdrawnAt: now,
      });
      const auditRef = options.firestore.doc(
        path(
          academyId,
          "auditEvents",
          `disclaimer-acceptance-withdrawn-${acceptanceIdValue}-${now}`,
        ),
      );
      await options.firestore.runTransaction(async (transaction) => {
        transaction.set(acceptanceRef, next as unknown as DisclaimerDocumentData);
        appendAuditEventInTransaction(
          transaction as never,
          auditRef as never,
          auditDraft(
            academyId,
            actorId,
            "disclaimer.acceptance.withdrawn",
            "disclaimerAcceptances",
            acceptanceIdValue,
          ),
        );
      });
      return next;
    },
  };
}
