import { describe, expect, it } from "vitest";

import type { AcademyId, FamilyId, SessionId, StudentId, UserId } from "../identifiers";
import type { UserActorContext, UserRole } from "../actor-context";
import {
  evaluateAccess,
  type AccessEvaluationInput,
  type AccessFacts,
  type AccessRequirement,
  type AccessResource,
} from "./access-policy";

const academyId = "academy-1" as AcademyId;
const otherAcademyId = "academy-2" as AcademyId;
const ownerId = "owner-1" as UserId;
const guardianId = "guardian-1" as UserId;
const adultStudentId = "adult-1" as UserId;
const coachId = "coach-1" as UserId;
const familyId = "family-1" as FamilyId;
const studentId = "student-1" as StudentId;
const sessionId = "session-1" as SessionId;

function actor(role: UserRole = "owner", userId: UserId = ownerId): UserActorContext {
  return { kind: "user", academyId, userId, role };
}

function requirement(overrides: Partial<AccessRequirement> = {}): AccessRequirement {
  return {
    operation: "read",
    classification: "Internal",
    allowedRoles: ["owner"],
    scope: "academy",
    purpose: "academy operations",
    ...overrides,
  };
}

function resource(overrides: Partial<AccessResource> = {}): AccessResource {
  return {
    resourceId: "resource-1",
    academyId,
    classification: "Internal",
    ...overrides,
  };
}

function input(overrides: Partial<AccessEvaluationInput> = {}): AccessEvaluationInput {
  return {
    actor: actor(),
    requirement: requirement(),
    resource: resource(),
    facts: { actorActive: true },
    nowMs: 200,
    ...overrides,
  };
}

describe("access policy", () => {
  it("allows an active same-academy actor when the academy policy grants the role", () => {
    const currentActor = actor();
    const result = evaluateAccess(input({ actor: currentActor }));

    expect(result).toEqual({
      ok: true,
      value: {
        actor: currentActor,
        resourceId: "resource-1",
        operation: "read",
        classification: "Internal",
        scope: "academy",
        purpose: "academy operations",
      },
    });
    expect(Object.isFrozen(result.ok ? result.value : undefined)).toBe(true);
  });

  it("allows self scope only for the authenticated adult identity", () => {
    const currentActor = actor("adultStudent", adultStudentId);
    const result = evaluateAccess(
      input({
        actor: currentActor,
        requirement: requirement({ allowedRoles: ["adultStudent"], scope: "self" }),
        resource: resource({ subjectUserId: adultStudentId }),
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { actor: currentActor, scope: "self", resourceId: "resource-1" },
    });
  });

  it("allows family scope only through a current matching relationship and operation", () => {
    const currentActor = actor("guardian", guardianId);
    const facts: AccessFacts = {
      actorActive: true,
      familyRelationship: {
        status: "active",
        academyId,
        adultUserId: guardianId,
        familyId,
        studentId,
        operations: ["read"],
        validFromMs: 100,
        validToMs: 300,
      },
    };
    const result = evaluateAccess(
      input({
        actor: currentActor,
        requirement: requirement({
          allowedRoles: ["guardian"],
          classification: "Restricted",
          scope: "family",
          purpose: "family profile access",
        }),
        resource: resource({
          resourceId: studentId,
          classification: "Restricted",
          familyId,
          studentId,
        }),
        facts,
      }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        actor: currentActor,
        resourceId: "student-1",
        operation: "read",
        classification: "Restricted",
        scope: "family",
        purpose: "family profile access",
      },
    });
  });

  it("allows assignment scope only for current matching staff work", () => {
    const currentActor = actor("coach", coachId);
    const result = evaluateAccess(
      input({
        actor: currentActor,
        requirement: requirement({ allowedRoles: ["coach"], scope: "assignment" }),
        resource: resource({ studentId, sessionId }),
        facts: {
          actorActive: true,
          assignment: {
            status: "active",
            academyId,
            staffUserId: coachId,
            studentId,
            sessionId,
            operations: ["read"],
            validFromMs: 100,
            validToMs: null,
          },
        },
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { actor: currentActor, scope: "assignment", operation: "read" },
    });
  });

  it("allows approval scope only for current evidence covering the resource and operation", () => {
    const result = evaluateAccess(
      input({
        requirement: requirement({ operation: "approve", scope: "approval" }),
        facts: {
          actorActive: true,
          approval: {
            status: "approved",
            academyId,
            resourceId: "resource-1",
            operation: "approve",
            validFromMs: 100,
            validToMs: 300,
          },
        },
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { resourceId: "resource-1", operation: "approve", scope: "approval" },
    });
  });

  it("denies every missing common authorization invariant with a stable internal reason", () => {
    const baseline = input();
    const cases: readonly [AccessEvaluationInput, string][] = [
      [{ ...baseline, nowMs: Number.NaN }, "INVALID_CONTEXT"],
      [{ ...baseline, resource: { ...baseline.resource, resourceId: " " } }, "INVALID_CONTEXT"],
      [
        { ...baseline, resource: { ...baseline.resource, academyId: otherAcademyId } },
        "TENANT_MISMATCH",
      ],
      [{ ...baseline, facts: { actorActive: false } }, "ACTOR_INACTIVE"],
      [
        {
          ...baseline,
          facts: { actorActive: "true" as unknown as boolean },
        },
        "ACTOR_INACTIVE",
      ],
      [{ ...baseline, requirement: { ...baseline.requirement, purpose: " " } }, "PURPOSE_REQUIRED"],
      [
        { ...baseline, requirement: { ...baseline.requirement, allowedRoles: ["guardian"] } },
        "ROLE_DENIED",
      ],
      [
        { ...baseline, resource: { ...baseline.resource, classification: "Restricted" } },
        "CLASSIFICATION_MISMATCH",
      ],
    ];

    for (const [candidate, expectedReason] of cases) {
      expect(evaluateAccess(candidate)).toEqual({ ok: false, error: expectedReason });
    }
  });

  it("denies self, family, assignment, and approval evidence that is stale or mismatched", () => {
    const guardianActor = actor("guardian", guardianId);
    const coachActor = actor("coach", coachId);
    const familyRequirement = requirement({ allowedRoles: ["guardian"], scope: "family" });
    const assignmentRequirement = requirement({ allowedRoles: ["coach"], scope: "assignment" });
    const familyResource = resource({ familyId, studentId });
    const assignmentResource = resource({ studentId, sessionId });
    const familyEvidence = {
      status: "active" as const,
      academyId,
      adultUserId: guardianId,
      familyId,
      studentId,
      operations: ["read"] as const,
      validFromMs: 100,
      validToMs: 300,
    };
    const assignmentEvidence = {
      status: "active" as const,
      academyId,
      staffUserId: coachId,
      studentId,
      sessionId,
      operations: ["read"] as const,
      validFromMs: 100,
      validToMs: 300,
    };
    const cases: readonly [AccessEvaluationInput, string][] = [
      [
        input({
          actor: actor("adultStudent", adultStudentId),
          requirement: requirement({ allowedRoles: ["adultStudent"], scope: "self" }),
          resource: resource({ subjectUserId: guardianId }),
        }),
        "SELF_SCOPE_DENIED",
      ],
      [
        input({
          actor: guardianActor,
          requirement: familyRequirement,
          resource: familyResource,
          facts: { actorActive: true, familyRelationship: { ...familyEvidence, validToMs: 200 } },
        }),
        "FAMILY_SCOPE_DENIED",
      ],
      [
        input({
          actor: guardianActor,
          requirement: familyRequirement,
          resource: familyResource,
          facts: {
            actorActive: true,
            familyRelationship: { ...familyEvidence, operations: ["update"] },
          },
        }),
        "FAMILY_SCOPE_DENIED",
      ],
      [
        input({
          actor: guardianActor,
          requirement: familyRequirement,
          resource: familyResource,
          facts: {
            actorActive: true,
            familyRelationship: { ...familyEvidence, validFromMs: Number.NaN },
          },
        }),
        "FAMILY_SCOPE_DENIED",
      ],
      [
        input({
          actor: coachActor,
          requirement: assignmentRequirement,
          resource: assignmentResource,
          facts: {
            actorActive: true,
            assignment: { ...assignmentEvidence, staffUserId: ownerId },
          },
        }),
        "ASSIGNMENT_SCOPE_DENIED",
      ],
      [
        input({
          actor: coachActor,
          requirement: assignmentRequirement,
          resource: resource(),
          facts: { actorActive: true, assignment: assignmentEvidence },
        }),
        "ASSIGNMENT_SCOPE_DENIED",
      ],
      [
        input({
          requirement: requirement({ operation: "approve", scope: "approval" }),
          facts: {
            actorActive: true,
            approval: {
              status: "pending",
              academyId,
              resourceId: "resource-1",
              operation: "approve",
              validFromMs: 100,
              validToMs: 300,
            },
          },
        }),
        "APPROVAL_SCOPE_DENIED",
      ],
      [
        input({
          requirement: requirement({ operation: "approve", scope: "approval" }),
          facts: {
            actorActive: true,
            approval: {
              status: "approved",
              academyId,
              resourceId: "other-resource",
              operation: "approve",
              validFromMs: 100,
              validToMs: 300,
            },
          },
        }),
        "APPROVAL_SCOPE_DENIED",
      ],
    ];

    for (const [candidate, expectedReason] of cases) {
      expect(evaluateAccess(candidate)).toEqual({ ok: false, error: expectedReason });
    }
  });

  it("denies family, assignment, and approval evidence from another academy", () => {
    const guardianActor = actor("guardian", guardianId);
    const coachActor = actor("coach", coachId);
    const cases: readonly [AccessEvaluationInput, string][] = [
      [
        input({
          actor: guardianActor,
          requirement: requirement({ allowedRoles: ["guardian"], scope: "family" }),
          resource: resource({ familyId, studentId }),
          facts: {
            actorActive: true,
            familyRelationship: {
              status: "active",
              academyId: otherAcademyId,
              adultUserId: guardianId,
              familyId,
              studentId,
              operations: ["read"],
              validFromMs: 100,
              validToMs: 300,
            },
          },
        }),
        "FAMILY_SCOPE_DENIED",
      ],
      [
        input({
          actor: coachActor,
          requirement: requirement({ allowedRoles: ["coach"], scope: "assignment" }),
          resource: resource({ studentId, sessionId }),
          facts: {
            actorActive: true,
            assignment: {
              status: "active",
              academyId: otherAcademyId,
              staffUserId: coachId,
              studentId,
              sessionId,
              operations: ["read"],
              validFromMs: 100,
              validToMs: 300,
            },
          },
        }),
        "ASSIGNMENT_SCOPE_DENIED",
      ],
      [
        input({
          requirement: requirement({ operation: "approve", scope: "approval" }),
          facts: {
            actorActive: true,
            approval: {
              status: "approved",
              academyId: otherAcademyId,
              resourceId: "resource-1",
              operation: "approve",
              validFromMs: 100,
              validToMs: 300,
            },
          },
        }),
        "APPROVAL_SCOPE_DENIED",
      ],
    ];

    for (const [candidate, expectedReason] of cases) {
      expect(evaluateAccess(candidate)).toEqual({ ok: false, error: expectedReason });
    }
  });

  it("does not mutate authorization inputs while producing an immutable grant", () => {
    const candidate = input();
    const before = structuredClone(candidate);

    const result = evaluateAccess(candidate);

    expect(candidate).toEqual(before);
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(result.ok ? result.value : undefined)).toBe(true);
  });
});
