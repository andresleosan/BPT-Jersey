import { describe, expect, expectTypeOf, it } from "vitest";

import {
  accessDenialReasons,
  accessOperations,
  accessScopes,
  ageBands,
  auditActions,
  classLevels,
  dataClassifications,
  daysOfWeek,
  disciplines,
  domainErrorCodes,
  domainModules,
  err,
  evaluateAccess,
  levelDefinitionKinds,
  levelRequirementInheritanceModes,
  locationIds,
  ok,
  parseAuditEventDraft,
  parseCreateClassInput,
  parseCreateSessionInput,
  parseLevelCatalogProjection,
  parseLevelCatalogSource,
  parseListSessionsQuery,
  parseRecurrenceRule,
  parseStaffAvailabilityWindow,
  parseStaffProfile,
  parseStaffRoleAssignment,
  parseUserClaims,
  sessionStatuses,
  staffAssignmentTargetTypes,
  staffRoles,
  staffStatuses,
  userRoles,
} from "./index";
import type {
  AcademyId,
  AssessmentId,
  AttendanceId,
  AuditEventId,
  BookingId,
  ClassId,
  CorrelationId,
  DocumentId,
  EntityId,
  FamilyId,
  InvoiceId,
  LeadId,
  MembershipId,
  MessageId,
  PaymentId,
  ProgramId,
  RecognitionId,
  SessionId,
  StaffId,
  StudentId,
  SystemActorId,
  UserId,
  UtcDateTime,
} from "./index";
import type { ActorContext, UserClaims, UserRole } from "./index";
import type { Page, PageCursor, PageRequest } from "./index";

describe("domain contracts", () => {
  it("keeps entity IDs nominally incompatible", () => {
    expectTypeOf<AcademyId>().toEqualTypeOf<EntityId<"Academy">>();
    expectTypeOf<StudentId>().toEqualTypeOf<EntityId<"Student">>();
    expectTypeOf<AcademyId>().not.toMatchTypeOf<StudentId>();
    expectTypeOf<StudentId>().not.toMatchTypeOf<AcademyId>();
  });

  it("keeps all declared IDs compatible with strings", () => {
    expectTypeOf<AcademyId>().toMatchTypeOf<string>();
    expectTypeOf<UserId>().toMatchTypeOf<string>();
    expectTypeOf<FamilyId>().toMatchTypeOf<string>();
    expectTypeOf<StudentId>().toMatchTypeOf<string>();
    expectTypeOf<StaffId>().toMatchTypeOf<string>();
    expectTypeOf<ProgramId>().toMatchTypeOf<string>();
    expectTypeOf<ClassId>().toMatchTypeOf<string>();
    expectTypeOf<SessionId>().toMatchTypeOf<string>();
    expectTypeOf<BookingId>().toMatchTypeOf<string>();
    expectTypeOf<AttendanceId>().toMatchTypeOf<string>();
    expectTypeOf<MembershipId>().toMatchTypeOf<string>();
    expectTypeOf<PaymentId>().toMatchTypeOf<string>();
    expectTypeOf<InvoiceId>().toMatchTypeOf<string>();
    expectTypeOf<AssessmentId>().toMatchTypeOf<string>();
    expectTypeOf<RecognitionId>().toMatchTypeOf<string>();
    expectTypeOf<LeadId>().toMatchTypeOf<string>();
    expectTypeOf<MessageId>().toMatchTypeOf<string>();
    expectTypeOf<DocumentId>().toMatchTypeOf<string>();
    expectTypeOf<AuditEventId>().toMatchTypeOf<string>();
    expectTypeOf<SystemActorId>().toMatchTypeOf<string>();
    expectTypeOf<CorrelationId>().toMatchTypeOf<string>();
  });

  it("keeps branded timestamps and cursors string-compatible", () => {
    expectTypeOf<UtcDateTime>().toMatchTypeOf<string>();
    expectTypeOf<PageCursor>().toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<UtcDateTime>();
    expectTypeOf<string>().not.toMatchTypeOf<PageCursor>();
  });

  it("defines readonly page and request contracts", () => {
    expectTypeOf<PageRequest>().toEqualTypeOf<{
      readonly cursor?: PageCursor;
      readonly limit: number;
    }>();
    expectTypeOf<Page<string>>().toEqualTypeOf<{
      readonly items: readonly string[];
      readonly nextCursor?: PageCursor;
    }>();
  });

  it("supports a basic page value", () => {
    const cursor = "cursor-2" as PageCursor;
    const page: Page<string> = {
      items: ["student-1"],
      nextCursor: cursor,
    };
    const request: PageRequest = { cursor, limit: 20 };

    expect(page).toEqual({ items: ["student-1"], nextCursor: "cursor-2" });
    expect(request).toEqual({ cursor: "cursor-2", limit: 20 });
  });

  it("keeps roles frozen and actor contexts discriminated", () => {
    expect(userRoles).toEqual([
      "owner",
      "administrator",
      "headCoach",
      "coach",
      "guardian",
      "adultStudent",
    ]);
    expect(Object.isFrozen(userRoles)).toBe(true);
    expectTypeOf<UserRole>().toEqualTypeOf<(typeof userRoles)[number]>();
    expectTypeOf<UserClaims>().toEqualTypeOf<{
      readonly academyId: AcademyId;
      readonly role: UserRole;
    }>();

    const actor: ActorContext = { kind: "anonymous" };
    if (actor.kind === "anonymous") {
      expect(actor.kind).toBe("anonymous");
    }
  });

  it("exposes the runtime contract values from the public entrypoint", () => {
    expect(domainModules).toHaveLength(14);
    expect(userRoles).toHaveLength(6);
    expect(parseUserClaims({ academyId: "academy-demo", role: "guardian" })).toEqual({
      ok: true,
      value: { academyId: "academy-demo", role: "guardian" },
    });
    expect(domainErrorCodes).toHaveLength(9);
    expect(ok("value")).toEqual({ ok: true, value: "value" });
    expect(err({ code: "CONFLICT" })).toEqual({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });

  it("exposes immutable access-policy contracts from the public entrypoint", () => {
    expect(accessOperations).toEqual(["read", "create", "update", "approve", "export", "delete"]);
    expect(dataClassifications).toEqual(["Public", "Internal", "Confidential", "Restricted"]);
    expect(accessScopes).toEqual(["academy", "self", "family", "assignment", "approval"]);
    expect(accessDenialReasons).toHaveLength(10);
    expect(Object.isFrozen(accessOperations)).toBe(true);
    expect(Object.isFrozen(dataClassifications)).toBe(true);
    expect(Object.isFrozen(accessScopes)).toBe(true);
    expect(Object.isFrozen(accessDenialReasons)).toBe(true);
    expect(evaluateAccess).toBeTypeOf("function");
  });

  it("exposes immutable audit contracts from the public entrypoint", () => {
    expect(auditActions).toEqual([
      "admin.role.granted",
      "admin.role.revoked",
      "member.import.confirmed",
      "regyfit.access.imported",
      "retention.alerts.generated",
      "report.export.prepared",
      "family.achievements.generated",
      "lesson.plan.approved",
      "membership.created",
      "membership.status.changed",
      "invoice.created",
      "invoice.voided",
      "payment.recorded",
      "invoice.status.changed",
      "staff.created",
      "staff.updated",
      "staff.status.changed",
      "staff.availability.replaced",
      "staff.assignments.replaced",
      "waiver.version.published",
      "waiver.version.withdrawn",
      "consent.accepted",
      "consent.revoked",
      "consent.evidence.downloaded",
      "waitlist.offer.issued",
      "waitlist.offer.accepted",
      "waitlist.offer.declined",
      "waitlist.offer.expired",
    ]);
    expect(Object.isFrozen(auditActions)).toBe(true);
    expect(parseAuditEventDraft).toBeTypeOf("function");
  });

  it("exposes immutable staff contract values from the public entrypoint", () => {
    expect(staffRoles).toEqual(["headCoach", "coach"]);
    expect(staffStatuses).toEqual(["active", "inactive"]);
    expect(staffAssignmentTargetTypes).toEqual(["location", "program", "class"]);
    expect(Object.isFrozen(staffRoles)).toBe(true);
    expect(Object.isFrozen(staffStatuses)).toBe(true);
    expect(Object.isFrozen(staffAssignmentTargetTypes)).toBe(true);
    expect(parseStaffProfile).toBeTypeOf("function");
    expect(parseStaffRoleAssignment).toBeTypeOf("function");
    expect(parseStaffAvailabilityWindow).toBeTypeOf("function");
  });

  it("exposes immutable levels contract values from the public entrypoint", () => {
    expect(levelDefinitionKinds).toEqual(["belt", "stripe"]);
    expect(levelRequirementInheritanceModes).toEqual(["inherit", "replace", "none"]);
    expect(Object.isFrozen(levelDefinitionKinds)).toBe(true);
    expect(Object.isFrozen(levelRequirementInheritanceModes)).toBe(true);
    expect(parseLevelCatalogSource).toBeTypeOf("function");
    expect(parseLevelCatalogProjection).toBeTypeOf("function");
  });

  it("exposes immutable schedule contract values from the public entrypoint", () => {
    expect(locationIds).toEqual(["town", "west"]);
    expect(ageBands).toEqual(["kids", "teens", "adult", "all"]);
    expect(disciplines).toEqual(["bjj", "mma", "self-defence", "open-mat"]);
    expect(classLevels).toEqual(["all-levels", "fundamentals", "advanced"]);
    expect(sessionStatuses).toEqual(["scheduled", "active", "cancelled", "completed"]);
    expect(daysOfWeek).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(Object.isFrozen(locationIds)).toBe(true);
    expect(Object.isFrozen(ageBands)).toBe(true);
    expect(Object.isFrozen(disciplines)).toBe(true);
    expect(Object.isFrozen(classLevels)).toBe(true);
    expect(Object.isFrozen(sessionStatuses)).toBe(true);
    expect(Object.isFrozen(daysOfWeek)).toBe(true);
    expect(parseCreateClassInput).toBeTypeOf("function");
    expect(parseCreateSessionInput).toBeTypeOf("function");
    expect(parseListSessionsQuery).toBeTypeOf("function");
    expect(parseRecurrenceRule).toBeTypeOf("function");
  });
});

function verifyReadonlyContracts(request: PageRequest, page: Page<string>): void {
  // @ts-expect-error PageRequest properties are readonly.
  request.limit = 10;
  // @ts-expect-error PageRequest properties are readonly.
  request.cursor = "cursor-3" as PageCursor;
  // @ts-expect-error Page properties are readonly.
  page.items = [];
  // @ts-expect-error Page properties are readonly.
  page.nextCursor = "cursor-3" as PageCursor;
  // @ts-expect-error Page items are readonly.
  page.items.push("student-2");
}

void verifyReadonlyContracts;
