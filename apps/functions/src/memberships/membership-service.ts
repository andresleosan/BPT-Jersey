import { randomUUID } from "node:crypto";

import {
  canTransitionMembership,
  currentMembershipStatuses,
  membershipStatuses,
  parseMembershipRecord,
  type MembershipRecord,
  type MembershipStatus,
} from "@bpt-jersey/domain/memberships/lifecycle";
import {
  parsePlanRecord,
  planIds,
  type PlanId,
  type PlanRecord,
} from "@bpt-jersey/domain/memberships";
import {
  parseFamilyRecord,
  parseFamilyRelationship,
  type FamilyRecord,
  type FamilyRelationship,
} from "@bpt-jersey/domain/families";
import { parseStudentProfile, type StudentProfile } from "@bpt-jersey/domain/profiles";

import {
  appendAuditEventInTransaction,
  type AuditCreateTransaction,
} from "../audit/audit-writer.js";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

export type MembershipDocumentData = Readonly<Record<string, unknown>>;
export type MembershipDocumentReference = Readonly<{ id: string; path: string }>;
export type MembershipDocumentSnapshot = Readonly<{
  id: string;
  exists: boolean;
  data: () => MembershipDocumentData | undefined;
}>;
export type MembershipQuerySnapshot = Readonly<{
  docs: readonly MembershipDocumentSnapshot[];
}>;
export type MembershipQuery = Readonly<{
  path: string;
  field: string;
  value: unknown;
}>;
export type MembershipQueryBuilder = Readonly<{
  path: string;
  field: string;
  value: unknown;
  limit: (count: number) => MembershipQuery;
}>;
export type MembershipCollectionReference = Readonly<{
  doc: (id?: string) => MembershipDocumentReference;
  where: (field: string, operator: "==", value: unknown) => MembershipQueryBuilder;
}>;
export type MembershipTransaction = Readonly<{
  get: (
    target: MembershipDocumentReference | MembershipQuery | MembershipQueryBuilder,
  ) => Promise<MembershipDocumentSnapshot | MembershipQuerySnapshot>;
  create: (ref: MembershipDocumentReference, data: MembershipDocumentData) => MembershipTransaction;
  set: (ref: MembershipDocumentReference, data: MembershipDocumentData) => MembershipTransaction;
}>;
export type MembershipFirestore = Readonly<{
  doc: (path: string) => MembershipDocumentReference;
  collection: (path: string) => MembershipCollectionReference;
  runTransaction: <T>(callback: (transaction: MembershipTransaction) => Promise<T>) => Promise<T>;
}>;

export type MembershipScope = Readonly<{
  academyId: string;
  familyIds?: readonly string[];
  studentIds?: readonly string[];
  membershipIds?: readonly string[];
}>;
export type MembershipAuthorizationScope = MembershipScope;

export type CreateMembershipStoreInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  familyId: string;
  studentId: string;
  planId: PlanId;
  status: "trial" | "active";
  scope: MembershipScope;
}>;

export type TransitionMembershipStoreInput = Readonly<{
  academyId: string;
  actorId: string;
  now: string;
  membershipId: string;
  targetStatus: MembershipStatus;
  scope: MembershipScope;
}>;

export type MembershipStore = Readonly<{
  listMemberships: (scope: MembershipScope) => Promise<readonly MembershipRecord[]>;
  getMembership: (
    scope: MembershipScope,
    membershipId: string,
  ) => Promise<MembershipRecord | undefined>;
  createMembership: (input: CreateMembershipStoreInput) => Promise<MembershipRecord>;
  transitionMembership: (input: TransitionMembershipStoreInput) => Promise<MembershipRecord>;
}>;

export type MembershipStoreDependencies = Readonly<{
  firestore: MembershipFirestore;
  generateMembershipId?: () => string;
}>;

export class MembershipStoreError extends Error {
  public readonly code:
    "invalid" | "tenant" | "duplicate" | "not-found" | "conflict" | "precondition" | "transaction";

  public constructor(
    code:
      | "invalid"
      | "tenant"
      | "duplicate"
      | "not-found"
      | "conflict"
      | "precondition"
      | "transaction",
    message: string,
  ) {
    super(message);
    this.name = "MembershipStoreError";
    this.code = code;
  }
}

const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const MEMBERSHIP_QUERY_LIMIT = 100;

function pathSegment(value: unknown, label: string): string {
  if (typeof value !== "string" || !safePathSegmentPattern.test(value)) {
    throw new MembershipStoreError("tenant", `Invalid ${label}`);
  }
  return value;
}

function validNow(value: unknown): string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new MembershipStoreError("invalid", "Invalid membership timestamp");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (match === null) throw new MembershipStoreError("invalid", "Invalid membership timestamp");
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  calendar.setUTCHours(0, 0, 0, 0);
  if (
    calendar.getUTCFullYear() !== Number(match[1]) ||
    calendar.getUTCMonth() !== Number(match[2]) - 1 ||
    calendar.getUTCDate() !== Number(match[3])
  ) {
    throw new MembershipStoreError("invalid", "Invalid membership timestamp");
  }
  return value;
}

function validPlanId(value: unknown): PlanId {
  if (typeof value !== "string" || !planIds.includes(value as PlanId)) {
    throw new MembershipStoreError("invalid", "Unknown membership plan");
  }
  return value as PlanId;
}

function validMembershipStatus(value: unknown): MembershipStatus {
  if (typeof value !== "string" || !membershipStatuses.includes(value as MembershipStatus)) {
    throw new MembershipStoreError("invalid", "Unknown membership status");
  }
  return value as MembershipStatus;
}

function membershipsPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/memberships`;
}

function membershipPath(academyId: string, membershipId: string): string {
  return `${membershipsPath(academyId)}/${pathSegment(membershipId, "membership")}`;
}

function familyPath(academyId: string, familyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/families/${pathSegment(familyId, "family")}`;
}

function studentPath(academyId: string, studentId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/students/${pathSegment(studentId, "student")}`;
}

function planPath(academyId: string, planId: PlanId): string {
  return `academies/${pathSegment(academyId, "academy")}/plans/${pathSegment(planId, "plan")}`;
}

function relationshipPath(academyId: string, familyId: string, studentId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/relationships/${pathSegment(
    `${familyId}--${studentId}`,
    "relationship",
  )}`;
}

function auditEventsPath(academyId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/auditEvents`;
}

function isQuerySnapshot(
  value: MembershipDocumentSnapshot | MembershipQuerySnapshot,
): value is MembershipQuerySnapshot {
  return "docs" in value;
}

function documentSnapshot(
  value: MembershipDocumentSnapshot | MembershipQuerySnapshot,
): MembershipDocumentSnapshot {
  if (isQuerySnapshot(value))
    throw new MembershipStoreError("invalid", "Expected document snapshot");
  return value;
}

function querySnapshot(
  value: MembershipDocumentSnapshot | MembershipQuerySnapshot,
): MembershipQuerySnapshot {
  if (!isQuerySnapshot(value)) throw new MembershipStoreError("invalid", "Expected query snapshot");
  return value;
}

function storedFamily(
  snapshot: MembershipDocumentSnapshot,
  expectedFamilyId: string,
): FamilyRecord {
  if (!snapshot.exists) throw new MembershipStoreError("invalid", "Family source is missing");
  if (snapshot.id !== expectedFamilyId)
    throw new MembershipStoreError("invalid", "Family identity is invalid");
  const parsed = parseFamilyRecord(snapshot.data());
  if (!parsed.ok) throw new MembershipStoreError("invalid", "Stored family is invalid");
  if (parsed.value.familyId !== expectedFamilyId)
    throw new MembershipStoreError("invalid", "Family identity is invalid");
  return parsed.value;
}

function storedStudent(
  snapshot: MembershipDocumentSnapshot,
  expectedStudentId: string,
): StudentProfile {
  if (!snapshot.exists) throw new MembershipStoreError("invalid", "Student source is missing");
  if (snapshot.id !== expectedStudentId)
    throw new MembershipStoreError("invalid", "Student identity is invalid");
  const parsed = parseStudentProfile(snapshot.data());
  if (!parsed.ok) throw new MembershipStoreError("invalid", "Stored student is invalid");
  if (parsed.value.studentId !== expectedStudentId)
    throw new MembershipStoreError("invalid", "Student identity is invalid");
  return parsed.value;
}

function storedRelationship(
  snapshot: MembershipDocumentSnapshot,
  expectedRelationshipId: string,
): FamilyRelationship {
  if (!snapshot.exists) throw new MembershipStoreError("invalid", "Relationship source is missing");
  if (snapshot.id !== expectedRelationshipId)
    throw new MembershipStoreError("invalid", "Relationship identity is invalid");
  const parsed = parseFamilyRelationship(snapshot.data());
  if (!parsed.ok) throw new MembershipStoreError("invalid", "Stored relationship is invalid");
  return parsed.value;
}

function storedPlan(snapshot: MembershipDocumentSnapshot, expectedPlanId: PlanId): PlanRecord {
  if (!snapshot.exists)
    throw new MembershipStoreError("precondition", "Membership plan is unavailable");
  if (snapshot.id !== expectedPlanId)
    throw new MembershipStoreError("invalid", "Plan identity is invalid");
  const parsed = parsePlanRecord(snapshot.data());
  if (!parsed.ok) throw new MembershipStoreError("invalid", "Stored plan is invalid");
  if (parsed.value.planId !== expectedPlanId)
    throw new MembershipStoreError("invalid", "Plan identity is invalid");
  return parsed.value;
}

function storedMembership(
  snapshot: MembershipDocumentSnapshot,
  expectedMembershipId?: string,
): MembershipRecord {
  if (!snapshot.exists) throw new MembershipStoreError("not-found", "Membership is unavailable");
  if (expectedMembershipId !== undefined && snapshot.id !== expectedMembershipId) {
    throw new MembershipStoreError("invalid", "Membership identity is invalid");
  }
  const parsed = parseMembershipRecord(snapshot.data());
  if (!parsed.ok) throw new MembershipStoreError("invalid", "Stored membership is invalid");
  if (snapshot.id !== parsed.value.membershipId) {
    throw new MembershipStoreError("invalid", "Membership identity is invalid");
  }
  return parsed.value;
}

function normalizeScope(scope: MembershipScope): MembershipScope {
  const academyId = pathSegment(scope?.academyId, "academy");
  const normalized: {
    academyId: string;
    familyIds?: readonly string[];
    studentIds?: readonly string[];
    membershipIds?: readonly string[];
  } = { academyId };
  for (const field of ["familyIds", "studentIds", "membershipIds"] as const) {
    const values = scope?.[field];
    if (values === undefined) continue;
    if (
      !Array.isArray(values) ||
      values.some((value) => typeof value !== "string" || !safePathSegmentPattern.test(value)) ||
      new Set(values).size !== values.length
    ) {
      throw new MembershipStoreError("invalid", "Membership scope is invalid");
    }
    normalized[field] = Object.freeze([...values]);
  }
  return Object.freeze(normalized);
}

function assertAcademy(scope: MembershipScope, academyId: string): void {
  if (scope.academyId !== academyId) {
    throw new MembershipStoreError("tenant", "Membership tenant mismatch");
  }
}

function isAllowed(
  scope: MembershipScope,
  field: "familyIds" | "studentIds" | "membershipIds",
  id: string,
) {
  const values = scope[field];
  return values === undefined || values.includes(id);
}

function assertAllowed(
  scope: MembershipScope,
  field: "familyIds" | "studentIds" | "membershipIds",
  id: string,
): void {
  if (!isAllowed(scope, field, id)) {
    throw new MembershipStoreError("tenant", "Membership access is not permitted");
  }
}

function activeSource(record: FamilyRecord | StudentProfile | FamilyRelationship): boolean {
  return record.active && record.status === "active";
}

function auditDraft(
  academyId: string,
  actorId: string,
  action: "membership.created" | "membership.status.changed",
  membershipId: string,
  auditId: string,
): AuditEventDraft {
  return {
    academyId,
    actorId,
    action,
    targetRef: membershipPath(academyId, membershipId),
    purpose: action === "membership.created" ? "created membership" : "changed membership status",
    correlationId: `membership:${membershipId}:${auditId}`,
  } as unknown as AuditEventDraft;
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MembershipStoreError) throw error;
    throw new MembershipStoreError("transaction", "Membership store operation failed");
  }
}

export function createMembershipStore(dependencies: MembershipStoreDependencies): MembershipStore {
  const generateMembershipId = dependencies.generateMembershipId ?? randomUUID;

  return Object.freeze({
    async listMemberships(scopeInput) {
      return safely(async () => {
        const scope = normalizeScope(scopeInput);
        const records = await dependencies.firestore.runTransaction(async (transaction) => {
          const snapshot = querySnapshot(
            await transaction.get(
              dependencies.firestore
                .collection(membershipsPath(scope.academyId))
                .where("academyId", "==", scope.academyId)
                .limit(MEMBERSHIP_QUERY_LIMIT),
            ),
          );
          return snapshot.docs
            .map((item) => storedMembership(item))
            .filter(
              (membership) =>
                membership.academyId === scope.academyId &&
                isAllowed(scope, "familyIds", membership.familyId) &&
                isAllowed(scope, "studentIds", membership.studentId) &&
                isAllowed(scope, "membershipIds", membership.membershipId),
            )
            .sort((left, right) => left.membershipId.localeCompare(right.membershipId));
        });
        return Object.freeze([...records]);
      });
    },

    async getMembership(scopeInput, membershipIdInput) {
      return safely(async () => {
        const scope = normalizeScope(scopeInput);
        const membershipId = pathSegment(membershipIdInput, "membership");
        assertAllowed(scope, "membershipIds", membershipId);
        return dependencies.firestore.runTransaction(async (transaction) => {
          const snapshot = documentSnapshot(
            await transaction.get(
              dependencies.firestore.doc(membershipPath(scope.academyId, membershipId)),
            ),
          );
          if (!snapshot.exists) return undefined;
          const membership = storedMembership(snapshot, membershipId);
          if (membership.academyId !== scope.academyId) {
            throw new MembershipStoreError("tenant", "Membership tenant mismatch");
          }
          if (
            !isAllowed(scope, "familyIds", membership.familyId) ||
            !isAllowed(scope, "studentIds", membership.studentId)
          ) {
            return undefined;
          }
          return membership;
        });
      });
    },

    async createMembership(input) {
      return safely(async () => {
        const academyId = pathSegment(input.academyId, "academy");
        const actorId = pathSegment(input.actorId, "actor");
        const familyId = pathSegment(input.familyId, "family");
        const studentId = pathSegment(input.studentId, "student");
        const planId = validPlanId(input.planId);
        const status =
          input.status === "trial" || input.status === "active" ? input.status : undefined;
        if (status === undefined)
          throw new MembershipStoreError("invalid", "Invalid initial status");
        const timestamp = validNow(input.now);
        const scope = normalizeScope(input.scope);
        assertAcademy(scope, academyId);
        assertAllowed(scope, "familyIds", familyId);
        assertAllowed(scope, "studentIds", studentId);

        const membershipId = pathSegment(generateMembershipId(), "membership");
        const membershipReference = dependencies.firestore.doc(
          membershipPath(academyId, membershipId),
        );
        const familyReference = dependencies.firestore.doc(familyPath(academyId, familyId));
        const studentReference = dependencies.firestore.doc(studentPath(academyId, studentId));
        const planReference = dependencies.firestore.doc(planPath(academyId, planId));
        const relationshipReference = dependencies.firestore.doc(
          relationshipPath(academyId, familyId, studentId),
        );
        const auditReference = dependencies.firestore.collection(auditEventsPath(academyId)).doc();

        return dependencies.firestore.runTransaction(async (transaction) => {
          const [
            membershipSnapshot,
            familySnapshot,
            studentSnapshot,
            planSnapshot,
            relationshipSnapshot,
          ] = await Promise.all([
            transaction.get(membershipReference),
            transaction.get(familyReference),
            transaction.get(studentReference),
            transaction.get(planReference),
            transaction.get(relationshipReference),
          ]);
          const currentMemberships = querySnapshot(
            await transaction.get(
              dependencies.firestore
                .collection(membershipsPath(academyId))
                .where("studentId", "==", studentId),
            ),
          );

          if (documentSnapshot(membershipSnapshot).exists) {
            throw new MembershipStoreError("duplicate", "Membership identity is already in use");
          }
          const familyRecord = storedFamily(documentSnapshot(familySnapshot), familyId);
          const studentRecord = storedStudent(documentSnapshot(studentSnapshot), studentId);
          const planRecord = storedPlan(documentSnapshot(planSnapshot), planId);
          const relationshipRecord = storedRelationship(
            documentSnapshot(relationshipSnapshot),
            `${familyId}--${studentId}`,
          );

          if (familyRecord.academyId !== academyId || studentRecord.academyId !== academyId) {
            throw new MembershipStoreError("tenant", "Membership source tenant mismatch");
          }
          if (planRecord.academyId !== academyId || relationshipRecord.academyId !== academyId) {
            throw new MembershipStoreError("tenant", "Membership source tenant mismatch");
          }
          if (studentRecord.familyId !== familyId) {
            throw new MembershipStoreError("conflict", "Student family reference is invalid");
          }
          if (
            relationshipRecord.familyId !== familyId ||
            relationshipRecord.studentId !== studentId ||
            !activeSource(relationshipRecord)
          ) {
            throw new MembershipStoreError("conflict", "Student relationship is not active");
          }
          if (!activeSource(familyRecord) || !activeSource(studentRecord)) {
            throw new MembershipStoreError("precondition", "Membership source is not active");
          }
          if (!planRecord.active) {
            throw new MembershipStoreError("precondition", "Membership plan is inactive");
          }

          for (const snapshot of currentMemberships.docs) {
            const current = storedMembership(snapshot);
            if (current.academyId !== academyId) {
              throw new MembershipStoreError("tenant", "Membership tenant mismatch");
            }
            if (
              current.studentId === studentId &&
              currentMembershipStatuses.includes(current.status as never)
            ) {
              throw new MembershipStoreError(
                "duplicate",
                "Student already has a current membership",
              );
            }
          }

          const created: MembershipRecord = {
            membershipId,
            academyId,
            familyId,
            studentId,
            planId,
            status,
            startsAt: timestamp,
            endsAt: null,
            nextBillingAt: null,
            schemaVersion: "1",
            createdAt: timestamp,
            createdBy: actorId,
            updatedAt: timestamp,
            updatedBy: actorId,
          };
          const parsed = parseMembershipRecord(created);
          if (!parsed.ok)
            throw new MembershipStoreError("invalid", "Membership creation is invalid");

          transaction.create(membershipReference, parsed.value);
          appendAuditEventInTransaction(
            transaction as unknown as AuditCreateTransaction<typeof auditReference>,
            auditReference,
            auditDraft(academyId, actorId, "membership.created", membershipId, auditReference.id),
          );
          return parsed.value;
        });
      });
    },

    async transitionMembership(input) {
      return safely(async () => {
        const academyId = pathSegment(input.academyId, "academy");
        const actorId = pathSegment(input.actorId, "actor");
        const membershipId = pathSegment(input.membershipId, "membership");
        const targetStatus = validMembershipStatus(input.targetStatus);
        const timestamp = validNow(input.now);
        const scope = normalizeScope(input.scope);
        assertAcademy(scope, academyId);
        assertAllowed(scope, "membershipIds", membershipId);

        const membershipReference = dependencies.firestore.doc(
          membershipPath(academyId, membershipId),
        );
        const auditReference = dependencies.firestore.collection(auditEventsPath(academyId)).doc();

        return dependencies.firestore.runTransaction(async (transaction) => {
          const current = storedMembership(
            documentSnapshot(await transaction.get(membershipReference)),
            membershipId,
          );
          if (current.academyId !== academyId) {
            throw new MembershipStoreError("tenant", "Membership tenant mismatch");
          }
          if (
            !isAllowed(scope, "familyIds", current.familyId) ||
            !isAllowed(scope, "studentIds", current.studentId)
          ) {
            throw new MembershipStoreError("tenant", "Membership access is not permitted");
          }
          if (current.status === targetStatus) return current;
          if (!canTransitionMembership(current.status, targetStatus)) {
            throw new MembershipStoreError("precondition", "Membership transition is not allowed");
          }

          if (targetStatus === "active") {
            const planSnapshot = documentSnapshot(
              await transaction.get(
                dependencies.firestore.doc(planPath(academyId, validPlanId(current.planId))),
              ),
            );
            const planRecord = storedPlan(planSnapshot, current.planId);
            if (planRecord.academyId !== academyId) {
              throw new MembershipStoreError("tenant", "Membership plan tenant mismatch");
            }
            if (!planRecord.active) {
              throw new MembershipStoreError("precondition", "Membership plan is inactive");
            }
          }

          const updated: MembershipRecord = {
            ...current,
            status: targetStatus,
            endsAt:
              targetStatus === "cancelled" && current.endsAt === null ? timestamp : current.endsAt,
            updatedAt: timestamp,
            updatedBy: actorId,
          };
          const parsed = parseMembershipRecord(updated);
          if (!parsed.ok)
            throw new MembershipStoreError("invalid", "Membership transition is invalid");

          transaction.set(membershipReference, parsed.value);
          appendAuditEventInTransaction(
            transaction as unknown as AuditCreateTransaction<typeof auditReference>,
            auditReference,
            auditDraft(
              academyId,
              actorId,
              "membership.status.changed",
              membershipId,
              auditReference.id,
            ),
          );
          return parsed.value;
        });
      });
    },
  });
}
