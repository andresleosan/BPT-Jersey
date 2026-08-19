import { describe, expect, expectTypeOf, it } from "vitest";

import {
  accessDenialReasons,
  accessOperations,
  accessScopes,
  dataClassifications,
  domainErrorCodes,
  domainModules,
  err,
  evaluateAccess,
  ok,
  parseUserClaims,
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
