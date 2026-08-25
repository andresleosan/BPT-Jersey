import { randomUUID } from "node:crypto";

import { parseFamilyRelationship } from "@bpt-jersey/domain/families";
import { parseStudentProfile, type StudentProfile } from "@bpt-jersey/domain/profiles";
import {
  parseHealthProfile,
  parseHealthProfileChangeRequest,
  type HealthProfile,
  type HealthProfileAdminProjection,
  type HealthProfileChangeRequest,
  type HealthProfileChangeRequestInput,
  type HealthProfileRedactedProjection,
  type HealthProfileSaveInput,
  type HealthProfileStaffProjection,
} from "@bpt-jersey/domain/health";
import { toHealthProfileProjection } from "@bpt-jersey/domain/health";

export type HealthDocumentData = Readonly<Record<string, unknown>>;
export type HealthDocumentReference = Readonly<{ id: string; path: string }>;
export type HealthDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => HealthDocumentData | undefined;
}>;
export type HealthQuerySnapshot = Readonly<{ docs: readonly HealthDocumentSnapshot[] }>;
export type HealthQuery = Readonly<{ path: string; field: string; value: unknown; limit: number }>;
export type HealthCollectionReference = Readonly<{
  doc: (id?: string) => HealthDocumentReference;
  where: (
    field: string,
    operator: "==",
    value: unknown,
  ) => Readonly<{ limit: (count: number) => HealthQuery }>;
}>;
export type HealthTransaction = Readonly<{
  get: (
    target: HealthDocumentReference | HealthQuery,
  ) => Promise<HealthDocumentSnapshot | HealthQuerySnapshot>;
  create: (ref: HealthDocumentReference, data: HealthDocumentData) => HealthTransaction;
  set: (ref: HealthDocumentReference, data: HealthDocumentData) => HealthTransaction;
}>;
export type HealthFirestore = Readonly<{
  doc: (path: string) => HealthDocumentReference;
  collection: (path: string) => HealthCollectionReference;
  runTransaction: <T>(callback: (transaction: HealthTransaction) => Promise<T>) => Promise<T>;
}>;

export type HealthActorRole = "owner" | "administrator" | "headCoach" | "coach" | "guardian";
export type HealthAssignmentChecker = (
  input: Readonly<{ academyId: string; actorId: string; studentId: string }>,
) => Promise<boolean>;
export type HealthStoreDependencies = Readonly<{
  firestore: HealthFirestore;
  hasCurrentStudentAssignment?: HealthAssignmentChecker;
  generateRequestId?: () => string;
}>;
export type HealthStore = Readonly<{
  getHealthProfile: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      role: HealthActorRole;
      studentId: string;
    }>,
  ) => Promise<
    | HealthProfileAdminProjection
    | HealthProfileStaffProjection
    | HealthProfileRedactedProjection
    | undefined
  >;
  saveHealthProfile: (
    input: Readonly<{ academyId: string; actorId: string; now: string } & HealthProfileSaveInput>,
  ) => Promise<HealthProfileAdminProjection>;
  deactivateHealthProfile: (
    input: Readonly<{ academyId: string; actorId: string; studentId: string }>,
  ) => Promise<HealthProfileAdminProjection>;
  createChangeRequest: (
    input: Readonly<{ academyId: string; actorId: string } & HealthProfileChangeRequestInput>,
  ) => Promise<HealthProfileChangeRequest>;
  cancelChangeRequest: (
    input: Readonly<{ academyId: string; actorId: string; requestId: string }>,
  ) => Promise<HealthProfileChangeRequest>;
  reviewChangeRequest: (
    input: Readonly<{
      academyId: string;
      actorId: string;
      requestId: string;
      decision: "approve" | "reject";
    }>,
  ) => Promise<HealthProfileChangeRequest>;
}>;

export class HealthStoreError extends Error {
  public readonly code:
    "invalid" | "tenant" | "forbidden" | "not-found" | "conflict" | "precondition";
  public constructor(code: HealthStoreError["code"], message: string) {
    super(message);
    this.name = "HealthStoreError";
    this.code = code;
  }
}

const safePath = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const MAX_RECORDS = 100;
function segment(value: string, label: string): string {
  if (!safePath.test(value)) throw new HealthStoreError("invalid", "Invalid " + label);
  return value;
}
function nowValue(value: string): string {
  if (!iso.test(value) || Number.isNaN(Date.parse(value)))
    throw new HealthStoreError("invalid", "Invalid timestamp");
  return value;
}
function healthPath(academyId: string, studentId: string): string {
  return (
    "academies/" +
    segment(academyId, "academy") +
    "/healthProfiles/" +
    segment(studentId, "student")
  );
}
function requestPath(academyId: string, requestId: string): string {
  return (
    "academies/" +
    segment(academyId, "academy") +
    "/healthProfileChangeRequests/" +
    segment(requestId, "request")
  );
}
function requestCollection(academyId: string): string {
  return "academies/" + segment(academyId, "academy") + "/healthProfileChangeRequests";
}
function studentPath(academyId: string, studentId: string): string {
  return (
    "academies/" + segment(academyId, "academy") + "/students/" + segment(studentId, "student")
  );
}
function relationshipsCollection(academyId: string): string {
  return "academies/" + segment(academyId, "academy") + "/relationships";
}
function asDocument(value: HealthDocumentSnapshot | HealthQuerySnapshot): HealthDocumentSnapshot {
  if ("docs" in value) throw new HealthStoreError("invalid", "Expected document snapshot");
  return value;
}
function asQuery(value: HealthDocumentSnapshot | HealthQuerySnapshot): HealthQuerySnapshot {
  if (!("docs" in value)) throw new HealthStoreError("invalid", "Expected query snapshot");
  return value;
}
function storedStudent(
  snapshot: HealthDocumentSnapshot,
  academyId: string,
  studentId: string,
): StudentProfile {
  if (!snapshot.exists) throw new HealthStoreError("precondition", "Student is not available");
  const parsed = parseStudentProfile(snapshot.data());
  if (
    !parsed.ok ||
    parsed.value.academyId !== academyId ||
    parsed.value.studentId !== studentId ||
    parsed.value.participantType !== "minor" ||
    parsed.value.active !== true
  )
    throw new HealthStoreError("precondition", "Student is not eligible");
  return parsed.value;
}
function storedProfile(
  snapshot: HealthDocumentSnapshot,
  academyId: string,
  studentId: string,
): HealthProfile {
  if (!snapshot.exists) throw new HealthStoreError("not-found", "Health profile is not available");
  const parsed = parseHealthProfile(snapshot.data());
  if (!parsed.ok || parsed.value.academyId !== academyId || parsed.value.studentId !== studentId)
    throw new HealthStoreError("tenant", "Health profile scope is not permitted");
  return parsed.value;
}
function storedRequest(
  snapshot: HealthDocumentSnapshot,
  academyId: string,
): HealthProfileChangeRequest {
  if (!snapshot.exists) throw new HealthStoreError("not-found", "Health request is not available");
  const parsed = parseHealthProfileChangeRequest(snapshot.data());
  if (!parsed.ok || parsed.value.academyId !== academyId)
    throw new HealthStoreError("tenant", "Health request scope is not permitted");
  return parsed.value;
}
function activeGuardianRelationship(
  snapshot: HealthDocumentSnapshot,
  academyId: string,
  studentId: string,
  actorId: string,
  now: string,
): boolean {
  if (!snapshot.exists) return false;
  const parsed = parseFamilyRelationship(snapshot.data());
  if (!parsed.ok) return false;
  return (
    parsed.value.academyId === academyId &&
    parsed.value.studentId === studentId &&
    parsed.value.adultUserId === actorId &&
    parsed.value.active &&
    parsed.value.status === "active" &&
    parsed.value.validFrom <= now &&
    (parsed.value.validTo === undefined || parsed.value.validTo > now)
  );
}
async function assertGuardian(
  transaction: HealthTransaction,
  firestore: HealthFirestore,
  academyId: string,
  actorId: string,
  studentId: string,
  now: string,
): Promise<void> {
  const query = firestore
    .collection(relationshipsCollection(academyId))
    .where("studentId", "==", studentId)
    .limit(MAX_RECORDS);
  const relationships = asQuery(await transaction.get(query));
  if (
    !relationships.docs.some((snapshot) =>
      activeGuardianRelationship(snapshot, academyId, studentId, actorId, now),
    )
  )
    throw new HealthStoreError("forbidden", "Guardian relationship is not permitted");
}
async function assertStudent(
  transaction: HealthTransaction,
  firestore: HealthFirestore,
  academyId: string,
  studentId: string,
): Promise<StudentProfile> {
  return storedStudent(
    asDocument(await transaction.get(firestore.doc(studentPath(academyId, studentId)))),
    academyId,
    studentId,
  );
}
function adminProjection(
  profile: HealthProfile,
  pending: HealthProfileChangeRequest | null,
): HealthProfileAdminProjection {
  return Object.freeze({ ...profile, pendingChangeRequest: pending });
}
async function pendingRequest(
  transaction: HealthTransaction,
  firestore: HealthFirestore,
  academyId: string,
  studentId: string,
): Promise<HealthProfileChangeRequest | null> {
  const results = asQuery(
    await transaction.get(
      firestore
        .collection(requestCollection(academyId))
        .where("studentId", "==", studentId)
        .limit(MAX_RECORDS),
    ),
  );
  const pending = results.docs
    .map((snapshot) => storedRequest(snapshot, academyId))
    .filter((request) => request.studentId === studentId && request.status === "pending");
  if (pending.length > 1)
    throw new HealthStoreError("conflict", "Multiple pending health requests");
  return pending[0] ?? null;
}
function buildProfile(
  input: Readonly<{ academyId: string; actorId: string; now: string } & HealthProfileSaveInput>,
  current?: HealthProfile,
): HealthProfile {
  const base = {
    healthProfileId: input.studentId,
    academyId: input.academyId,
    studentId: input.studentId,
    minimumOperationalSupport: input.minimumOperationalSupport,
    conditionSummary: input.conditionSummary,
    staffReferenceLabel: input.staffReferenceLabel,
    reviewState: input.expiresAt !== null && input.expiresAt <= input.now ? "expired" : "current",
    expiresAt: input.expiresAt,
    status: current?.status ?? "active",
    schemaVersion: "1" as const,
    createdAt: current?.createdAt ?? input.now,
    createdBy: current?.createdBy ?? input.actorId,
    updatedAt: input.now,
    updatedBy: input.actorId,
  };
  const parsed = parseHealthProfile(base);
  if (!parsed.ok) throw new HealthStoreError("invalid", "Health profile contract rejected");
  return parsed.value;
}
function buildRequest(
  input: Readonly<
    {
      academyId: string;
      actorId: string;
      now: string;
      requestId: string;
    } & HealthProfileChangeRequestInput
  >,
): HealthProfileChangeRequest {
  const raw = {
    requestId: input.requestId,
    academyId: input.academyId,
    healthProfileId: input.studentId,
    studentId: input.studentId,
    requestedBy: input.actorId,
    proposedMinimumOperationalSupport: input.proposedMinimumOperationalSupport,
    proposedConditionSummary: input.proposedConditionSummary,
    proposedExpiresAt: input.proposedExpiresAt,
    status: "pending" as const,
    createdAt: input.now,
    createdBy: input.actorId,
    updatedAt: input.now,
    updatedBy: input.actorId,
    reviewedAt: null,
    reviewedBy: null,
    schemaVersion: "1" as const,
  };
  const parsed = parseHealthProfileChangeRequest(raw);
  if (!parsed.ok) throw new HealthStoreError("invalid", "Health request contract rejected");
  return parsed.value;
}

export function createHealthStore(dependencies: HealthStoreDependencies): HealthStore {
  const generateRequestId = dependencies.generateRequestId ?? randomUUID;
  const hasAssignment = dependencies.hasCurrentStudentAssignment ?? (async () => false);
  return Object.freeze({
    async getHealthProfile(input) {
      const academyId = segment(input.academyId, "academy");
      const actorId = segment(input.actorId, "actor");
      const studentId = segment(input.studentId, "student");
      const timestamp = new Date().toISOString();
      return dependencies.firestore.runTransaction(async (transaction) => {
        if (input.role === "guardian") {
          await assertGuardian(
            transaction,
            dependencies.firestore,
            academyId,
            actorId,
            studentId,
            timestamp,
          );
        } else if (input.role === "headCoach" || input.role === "coach") {
          if (!(await hasAssignment({ academyId, actorId, studentId }))) {
            throw new HealthStoreError("forbidden", "Current assignment is required");
          }
        } else if (input.role !== "owner" && input.role !== "administrator") {
          throw new HealthStoreError("forbidden", "Health profile access is not permitted");
        }
        const profileSnapshot = asDocument(
          await transaction.get(dependencies.firestore.doc(healthPath(academyId, studentId))),
        );
        if (!profileSnapshot.exists) return undefined;
        const profile = storedProfile(profileSnapshot, academyId, studentId);
        if (input.role === "owner" || input.role === "administrator") {
          return adminProjection(
            profile,
            await pendingRequest(transaction, dependencies.firestore, academyId, studentId),
          );
        }
        if (input.role === "guardian") return toHealthProfileProjection(profile, "guardian");
        return toHealthProfileProjection(profile, "staff");
      });
    },
    async saveHealthProfile(input) {
      const academyId = segment(input.academyId, "academy");
      segment(input.actorId, "actor");
      const studentId = segment(input.studentId, "student");
      nowValue(input.now);
      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertStudent(transaction, dependencies.firestore, academyId, studentId);
        const reference = dependencies.firestore.doc(healthPath(academyId, studentId));
        const snapshot = asDocument(await transaction.get(reference));
        const current = snapshot.exists ? storedProfile(snapshot, academyId, studentId) : undefined;
        const profile = buildProfile(input, current);
        const pending = await pendingRequest(
          transaction,
          dependencies.firestore,
          academyId,
          studentId,
        );
        transaction.set(reference, profile);
        return adminProjection(profile, pending);
      });
    },
    async deactivateHealthProfile(input) {
      const academyId = segment(input.academyId, "academy");
      const actorId = segment(input.actorId, "actor");
      const studentId = segment(input.studentId, "student");
      const timestamp = new Date().toISOString();
      return dependencies.firestore.runTransaction(async (transaction) => {
        const reference = dependencies.firestore.doc(healthPath(academyId, studentId));
        const current = storedProfile(
          asDocument(await transaction.get(reference)),
          academyId,
          studentId,
        );
        const next = {
          ...current,
          status: "inactive" as const,
          updatedAt: timestamp,
          updatedBy: actorId,
        };
        const parsed = parseHealthProfile(next);
        if (!parsed.ok) throw new HealthStoreError("invalid", "Health profile contract rejected");
        transaction.set(reference, parsed.value);
        return adminProjection(
          parsed.value,
          await pendingRequest(transaction, dependencies.firestore, academyId, studentId),
        );
      });
    },
    async createChangeRequest(input) {
      const academyId = segment(input.academyId, "academy");
      const actorId = segment(input.actorId, "actor");
      const studentId = segment(input.studentId, "student");
      const timestamp = new Date().toISOString();
      const requestId = segment(generateRequestId(), "request");
      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertGuardian(
          transaction,
          dependencies.firestore,
          academyId,
          actorId,
          studentId,
          timestamp,
        );
        const profile = storedProfile(
          asDocument(
            await transaction.get(dependencies.firestore.doc(healthPath(academyId, studentId))),
          ),
          academyId,
          studentId,
        );
        if (profile.status !== "active")
          throw new HealthStoreError("precondition", "Health profile is inactive");
        if (await pendingRequest(transaction, dependencies.firestore, academyId, studentId))
          throw new HealthStoreError("conflict", "A health request is already pending");
        const request = buildRequest({ ...input, academyId, actorId, now: timestamp, requestId });
        transaction.create(dependencies.firestore.doc(requestPath(academyId, requestId)), request);
        return request;
      });
    },
    async cancelChangeRequest(input) {
      const academyId = segment(input.academyId, "academy");
      const actorId = segment(input.actorId, "actor");
      const requestId = segment(input.requestId, "request");
      const timestamp = new Date().toISOString();
      return dependencies.firestore.runTransaction(async (transaction) => {
        const reference = dependencies.firestore.doc(requestPath(academyId, requestId));
        const request = storedRequest(asDocument(await transaction.get(reference)), academyId);
        if (request.requestedBy !== actorId || request.status !== "pending")
          throw new HealthStoreError("forbidden", "Health request cancellation is not permitted");
        const next = {
          ...request,
          status: "cancelled" as const,
          updatedAt: timestamp,
          updatedBy: actorId,
        };
        const parsed = parseHealthProfileChangeRequest(next);
        if (!parsed.ok) throw new HealthStoreError("invalid", "Health request contract rejected");
        transaction.set(reference, parsed.value);
        return parsed.value;
      });
    },
    async reviewChangeRequest(input) {
      const academyId = segment(input.academyId, "academy");
      const actorId = segment(input.actorId, "actor");
      const requestId = segment(input.requestId, "request");
      const timestamp = nowValue(new Date().toISOString());
      return dependencies.firestore.runTransaction(async (transaction) => {
        const requestReference = dependencies.firestore.doc(requestPath(academyId, requestId));
        const request = storedRequest(
          asDocument(await transaction.get(requestReference)),
          academyId,
        );
        if (request.status !== "pending")
          throw new HealthStoreError("conflict", "Health request is not pending");
        const profileReference = dependencies.firestore.doc(
          healthPath(academyId, request.studentId),
        );
        const profile = storedProfile(
          asDocument(await transaction.get(profileReference)),
          academyId,
          request.studentId,
        );
        const nextRequest = {
          ...request,
          status: input.decision === "approve" ? ("approved" as const) : ("rejected" as const),
          reviewedAt: timestamp,
          reviewedBy: actorId,
          updatedAt: timestamp,
          updatedBy: actorId,
        };
        const parsedRequest = parseHealthProfileChangeRequest(nextRequest);
        if (!parsedRequest.ok)
          throw new HealthStoreError("invalid", "Health request contract rejected");
        if (input.decision === "approve") {
          const nextProfile = buildProfile(
            {
              academyId,
              actorId,
              now: timestamp,
              studentId: request.studentId,
              minimumOperationalSupport: request.proposedMinimumOperationalSupport,
              conditionSummary: request.proposedConditionSummary,
              staffReferenceLabel: profile.staffReferenceLabel,
              expiresAt: request.proposedExpiresAt,
            },
            profile,
          );
          transaction.set(profileReference, nextProfile);
        }
        transaction.set(requestReference, parsedRequest.value);
        return parsedRequest.value;
      });
    },
  });
}
