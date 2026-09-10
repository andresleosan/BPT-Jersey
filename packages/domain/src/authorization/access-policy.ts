import type { UserActorContext, UserRole } from "../actor-context";
import type { AcademyId, FamilyId, SessionId, StudentId, UserId } from "../identifiers";
import { err, ok } from "../result";
import type { Result } from "../result";

export const accessOperations = Object.freeze([
  "read",
  "create",
  "update",
  "approve",
  "export",
  "delete",
] as const);
export const dataClassifications = Object.freeze([
  "Public",
  "Internal",
  "Confidential",
  "Restricted",
] as const);
export const accessScopes = Object.freeze([
  "academy",
  "self",
  "family",
  "assignment",
  "approval",
] as const);
export const accessDenialReasons = Object.freeze([
  "INVALID_CONTEXT",
  "TENANT_MISMATCH",
  "ACTOR_INACTIVE",
  "PURPOSE_REQUIRED",
  "ROLE_DENIED",
  "CLASSIFICATION_MISMATCH",
  "SELF_SCOPE_DENIED",
  "FAMILY_SCOPE_DENIED",
  "ASSIGNMENT_SCOPE_DENIED",
  "APPROVAL_SCOPE_DENIED",
] as const);

export type AccessOperation = (typeof accessOperations)[number];
export type DataClassification = (typeof dataClassifications)[number];
export type AccessScope = (typeof accessScopes)[number];
export type AccessDenialReason = (typeof accessDenialReasons)[number];

export type AccessRequirement = Readonly<{
  operation: AccessOperation;
  classification: DataClassification;
  allowedRoles: readonly UserRole[];
  scope: AccessScope;
  purpose: string;
}>;

export type AccessResource = Readonly<{
  resourceId: string;
  academyId: AcademyId;
  classification: DataClassification;
  subjectUserId?: UserId;
  familyId?: FamilyId;
  studentId?: StudentId;
  sessionId?: SessionId;
}>;

export type ValidityWindow = Readonly<{
  validFromMs: number;
  validToMs: number | null;
}>;

export type FamilyAccessEvidence = ValidityWindow &
  Readonly<{
    status: "active" | "inactive";
    academyId: AcademyId;
    adultUserId: UserId;
    familyId: FamilyId;
    studentId: StudentId;
    operations: readonly AccessOperation[];
  }>;

export type AssignmentAccessEvidence = ValidityWindow &
  Readonly<{
    status: "active" | "inactive";
    academyId: AcademyId;
    staffUserId: UserId;
    studentId?: StudentId;
    sessionId?: SessionId;
    operations: readonly AccessOperation[];
  }>;

export type ApprovalAccessEvidence = ValidityWindow &
  Readonly<{
    status: "approved" | "pending" | "rejected";
    academyId: AcademyId;
    resourceId: string;
    operation: AccessOperation;
  }>;

export type AccessFacts = Readonly<{
  actorActive: boolean;
  familyRelationship?: FamilyAccessEvidence;
  assignment?: AssignmentAccessEvidence;
  approval?: ApprovalAccessEvidence;
}>;

export type AccessGrant = Readonly<{
  actor: UserActorContext;
  resourceId: string;
  operation: AccessOperation;
  classification: DataClassification;
  scope: AccessScope;
  purpose: string;
}>;

export type AccessEvaluationInput = Readonly<{
  actor: UserActorContext;
  requirement: AccessRequirement;
  resource: AccessResource;
  facts: AccessFacts;
  nowMs: number;
}>;

function isCurrent(window: ValidityWindow, nowMs: number): boolean {
  return (
    Number.isFinite(window.validFromMs) &&
    (window.validToMs === null || Number.isFinite(window.validToMs)) &&
    window.validFromMs <= nowMs &&
    (window.validToMs === null || nowMs < window.validToMs)
  );
}

function scopeDenialReason(input: AccessEvaluationInput): AccessDenialReason | undefined {
  const { actor, facts, nowMs, requirement, resource } = input;

  switch (requirement.scope) {
    case "academy":
      return undefined;
    case "self":
      return resource.subjectUserId === actor.userId ? undefined : "SELF_SCOPE_DENIED";
    case "family": {
      const relationship = facts.familyRelationship;
      return relationship !== undefined &&
        relationship.status === "active" &&
        relationship.academyId === resource.academyId &&
        resource.familyId !== undefined &&
        resource.studentId !== undefined &&
        relationship.adultUserId === actor.userId &&
        relationship.familyId === resource.familyId &&
        relationship.studentId === resource.studentId &&
        relationship.operations.includes(requirement.operation) &&
        isCurrent(relationship, nowMs)
        ? undefined
        : "FAMILY_SCOPE_DENIED";
    }
    case "assignment": {
      const assignment = facts.assignment;
      const hasTarget = resource.studentId !== undefined || resource.sessionId !== undefined;
      return assignment !== undefined &&
        assignment.status === "active" &&
        assignment.academyId === resource.academyId &&
        hasTarget &&
        assignment.staffUserId === actor.userId &&
        (resource.studentId === undefined || assignment.studentId === resource.studentId) &&
        (resource.sessionId === undefined || assignment.sessionId === resource.sessionId) &&
        assignment.operations.includes(requirement.operation) &&
        isCurrent(assignment, nowMs)
        ? undefined
        : "ASSIGNMENT_SCOPE_DENIED";
    }
    case "approval": {
      const approval = facts.approval;
      return approval !== undefined &&
        approval.status === "approved" &&
        approval.academyId === resource.academyId &&
        approval.resourceId === resource.resourceId &&
        approval.operation === requirement.operation &&
        isCurrent(approval, nowMs)
        ? undefined
        : "APPROVAL_SCOPE_DENIED";
    }
  }
}

export function evaluateAccess(
  input: AccessEvaluationInput,
): Result<AccessGrant, AccessDenialReason> {
  const { actor, facts, nowMs, requirement, resource } = input;
  if (
    !Number.isFinite(nowMs) ||
    typeof resource.resourceId !== "string" ||
    resource.resourceId.trim().length === 0
  ) {
    return err("INVALID_CONTEXT");
  }
  if (actor.academyId !== resource.academyId) {
    return err("TENANT_MISMATCH");
  }
  if (facts.actorActive !== true) {
    return err("ACTOR_INACTIVE");
  }
  if (requirement.purpose.trim().length === 0) {
    return err("PURPOSE_REQUIRED");
  }
  if (!requirement.allowedRoles.includes(actor.role)) {
    return err("ROLE_DENIED");
  }
  if (requirement.classification !== resource.classification) {
    return err("CLASSIFICATION_MISMATCH");
  }

  const scopeDenial = scopeDenialReason(input);
  if (scopeDenial !== undefined) {
    return err(scopeDenial);
  }

  return ok(
    Object.freeze({
      actor,
      resourceId: resource.resourceId,
      operation: requirement.operation,
      classification: requirement.classification,
      scope: requirement.scope,
      purpose: requirement.purpose,
    }),
  );
}
