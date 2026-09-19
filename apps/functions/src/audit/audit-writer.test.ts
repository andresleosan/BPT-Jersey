import { describe, expect, it, vi } from "vitest";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

import { appendAuditEventInTransaction, matchesAuditEventReplay } from "./audit-writer.js";

const adminDraft = {
  academyId: "academy-1",
  actorId: "owner-1",
  action: "admin.role.granted",
  targetRef: "academies/academy-1/users/user-1",
  purpose: "administrative role management",
  correlationId: "correlation-1",
} as unknown as AuditEventDraft;

const regyfitDraft = {
  academyId: "academy-1",
  actorId: "system-regyfit-importer",
  action: "regyfit.access.imported",
  targetRef: "academies/academy-1/regyfitAccessRecords",
  purpose: "approved Regyfit access import",
  correlationId: "regyfit-access:synthetic-run-1",
  importRunId: "synthetic-run-1",
  moduleKey: "alunos-acessos",
  sourceRoute: "/admin2/modulos/alunos/acessos_alunos.php",
  recordCount: 10,
  contentSha256: "a".repeat(64),
} as unknown as AuditEventDraft;

const membershipCreatedDraft = {
  academyId: "academy-1",
  actorId: "owner-1",
  action: "membership.created",
  targetRef: "academies/academy-1/memberships/membership-1",
  purpose: "created membership",
  correlationId: "membership-created-1",
} as unknown as AuditEventDraft;

const membershipStatusChangedDraft = {
  academyId: "academy-1",
  actorId: "owner-1",
  action: "membership.status.changed",
  targetRef: "academies/academy-1/memberships/membership-1",
  purpose: "changed membership status",
  correlationId: "membership-status-changed-1",
} as unknown as AuditEventDraft;

const paymentRecordedDraft = {
  academyId: "academy-1",
  actorId: "owner-1",
  action: "payment.recorded",
  targetRef: "academies/academy-1/payments/payment-1",
  purpose: "manual payment recorded",
  correlationId: "payment-recorded-1",
  amountMinor: 1000,
  currency: "GBP",
  method: "cash",
} as unknown as AuditEventDraft;

const restrictedLookupDraft = {
  academyId: "academy-1",
  actorId: "owner-1",
  action: "member.identity.lookup",
  targetRef: "academies/academy-1/studentRestrictedReadLimits/owner-1",
  purpose: "member-identity-lookup",
  correlationId: "restricted-audit-1",
  result: "no-match",
} as unknown as AuditEventDraft;

const regyfitRevealDraft = {
  academyId: "academy-1",
  actorId: "owner-1",
  action: "regyfit.record.field.read",
  targetRef: "academies/academy-1/studentRestrictedReadLimits/owner-1",
  purpose: "regyfit-record-review",
  correlationId: "restricted-audit-reveal-1",
  result: "not-found",
} as unknown as AuditEventDraft;
function checkedInDraft(overrides: Readonly<Record<string, unknown>> = {}): AuditEventDraft {
  return {
    academyId: "academy-1",
    actorId: "coach-1",
    action: "attendance.checked_in",
    targetRef: "academies/academy-1/attendance/attendance-1",
    purpose: "schedule-attendance-operation",
    correlationId: "attendance-1",
    class: {
      studentId: "student-1",
      memberId: null,
      studentName: null,
      sessionId: "session-1",
      sessionStartAt: "2026-09-18T18:00:00.000Z",
      programId: "adult-fundamentals",
      locationId: "town",
    },
    actorIp: null,
    actorRole: "coach",
    actorGroup: "staff",
    actorName: null,
    source: "bpt",
    ...overrides,
  } as unknown as AuditEventDraft;
}

function modernEvent(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    ...regyfitDraft,
    auditEventId: "regyfit-access-synthetic-run-1",
    occurredAt: { seconds: 1, nanoseconds: 0 },
    result: "completed",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("audit writer", () => {
  it("materializes exactly one create with server-owned fields", () => {
    const create = vi.fn();
    const ref = { id: "audit-1" };

    appendAuditEventInTransaction({ create }, ref, adminDraft);

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(ref, {
      ...adminDraft,
      auditEventId: "audit-1",
      occurredAt: expect.anything(),
      result: "completed",
      schemaVersion: 1,
    });
  });

  it("writes both membership actions with common and server-owned fields", () => {
    for (const draft of [membershipCreatedDraft, membershipStatusChangedDraft]) {
      const create = vi.fn();
      const ref = { id: "audit-membership-1" };

      appendAuditEventInTransaction({ create }, ref, draft);

      expect(create).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledWith(ref, {
        ...draft,
        auditEventId: ref.id,
        occurredAt: expect.anything(),
        result: "completed",
        schemaVersion: 1,
      });
    }
  });

  it("writes finance actions with restricted financial metadata", () => {
    const create = vi.fn();
    const ref = { id: "audit-payment-1" };

    appendAuditEventInTransaction({ create }, ref, paymentRecordedDraft);

    expect(create).toHaveBeenCalledWith(ref, {
      ...paymentRecordedDraft,
      auditEventId: ref.id,
      occurredAt: expect.anything(),
      result: "completed",
      schemaVersion: 1,
    });
  });

  it("preserves the closed result when creating restricted member read evidence", () => {
    const create = vi.fn();
    const ref = { id: "restricted-audit-1" };

    appendAuditEventInTransaction({ create }, ref, restrictedLookupDraft);

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(ref, {
      ...restrictedLookupDraft,
      auditEventId: ref.id,
      occurredAt: expect.anything(),
      schemaVersion: 1,
    });
  });

  it("preserves the closed result when creating Regyfit record field reveal evidence", () => {
    const create = vi.fn();
    const ref = { id: "restricted-audit-reveal-1" };

    appendAuditEventInTransaction({ create }, ref, regyfitRevealDraft);

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(ref, {
      ...regyfitRevealDraft,
      auditEventId: ref.id,
      occurredAt: expect.anything(),
      schemaVersion: 1,
    });
  });

  it("rejects an invalid draft before create", () => {
    const create = vi.fn();

    expect(() =>
      appendAuditEventInTransaction({ create }, { id: "audit-1" }, {
        ...adminDraft,
        email: "person@example.test",
      } as unknown as AuditEventDraft),
    ).toThrow(expect.objectContaining({ code: "invalid-argument" }));
    expect(create).not.toHaveBeenCalled();
  });

  it("matches an exact current event while ignoring the timestamp value", () => {
    expect(
      matchesAuditEventReplay(modernEvent(), "regyfit-access-synthetic-run-1", regyfitDraft),
    ).toBe(true);
  });

  it("matches a restricted member read event only with its exact closed result", () => {
    const stored = {
      ...restrictedLookupDraft,
      auditEventId: "restricted-audit-1",
      occurredAt: { seconds: 1, nanoseconds: 0 },
      schemaVersion: 1,
    };

    expect(matchesAuditEventReplay(stored, "restricted-audit-1", restrictedLookupDraft)).toBe(true);
    expect(
      matchesAuditEventReplay(
        { ...stored, result: "completed" },
        "restricted-audit-1",
        restrictedLookupDraft,
      ),
    ).toBe(false);
  });

  it("allows exact legacy data only when explicitly requested", () => {
    const legacy = modernEvent() as Record<string, unknown>;
    delete legacy.auditEventId;
    delete legacy.occurredAt;

    expect(matchesAuditEventReplay(legacy, "regyfit-access-synthetic-run-1", regyfitDraft)).toBe(
      false,
    );
    expect(
      matchesAuditEventReplay(legacy, "regyfit-access-synthetic-run-1", regyfitDraft, {
        allowLegacyMissingGeneratedFields: true,
      }),
    ).toBe(true);
  });

  it("rejects mismatched, incomplete, or extended replay data", () => {
    for (const stored of [
      modernEvent({ recordCount: 9 }),
      modernEvent({ email: "person@example.test" }),
      modernEvent({ auditEventId: "wrong-id" }),
      { ...modernEvent(), occurredAt: undefined },
    ]) {
      expect(
        matchesAuditEventReplay(stored, "regyfit-access-synthetic-run-1", regyfitDraft, {
          allowLegacyMissingGeneratedFields: true,
        }),
      ).toBe(false);
    }
  });

  it("replays a check-in audited before the class block existed", () => {
    const legacyStored = {
      academyId: "academy-1",
      actorId: "coach-1",
      action: "attendance.checked_in",
      targetRef: "academies/academy-1/attendance/attendance-1",
      purpose: "schedule-attendance-operation",
      correlationId: "attendance-1",
      auditEventId: "attendance-check-in-attendance-1",
      occurredAt: { seconds: 1, nanoseconds: 0 },
      result: "completed",
      schemaVersion: 1,
    };

    expect(
      matchesAuditEventReplay(legacyStored, "attendance-check-in-attendance-1", checkedInDraft()),
    ).toBe(true);
    expect(
      matchesAuditEventReplay(
        { ...legacyStored, actorId: "coach-2" },
        "attendance-check-in-attendance-1",
        checkedInDraft(),
      ),
    ).toBe(false);
  });

  it("replays a class row stored before the class block named a member", () => {
    const block = (checkedInDraft() as unknown as { class: Record<string, unknown> }).class;
    // The class block exactly as it was stored before `memberId` existed: every key but that one.
    const legacyBlock = Object.fromEntries(
      Object.entries(block).filter(([key]) => key !== "memberId"),
    );
    const stored = {
      ...(checkedInDraft() as unknown as Record<string, unknown>),
      class: legacyBlock,
      auditEventId: "attendance-check-in-attendance-1",
      occurredAt: { seconds: 1, nanoseconds: 0 },
      result: "completed",
      schemaVersion: 1,
    };

    expect(
      matchesAuditEventReplay(stored, "attendance-check-in-attendance-1", checkedInDraft()),
    ).toBe(true);
    expect(
      matchesAuditEventReplay(
        stored,
        "attendance-check-in-attendance-1",
        checkedInDraft({ class: { ...legacyBlock, memberId: null, studentId: "student-2" } }),
      ),
    ).toBe(false);
  });

  it("replays a class event whose caller reaches it from another address", () => {
    const stored = {
      ...(checkedInDraft({ actorIp: "82.112.144.10" }) as unknown as Record<string, unknown>),
      auditEventId: "attendance-check-in-attendance-1",
      occurredAt: { seconds: 1, nanoseconds: 0 },
      result: "completed",
      schemaVersion: 1,
    };

    expect(
      matchesAuditEventReplay(
        stored,
        "attendance-check-in-attendance-1",
        checkedInDraft({ actorIp: "82.112.144.11" }),
      ),
    ).toBe(true);
    expect(
      matchesAuditEventReplay(
        stored,
        "attendance-check-in-attendance-1",
        checkedInDraft({ actorRole: "administrator", actorGroup: "staff" }),
      ),
    ).toBe(false);
  });

  it("requires no mutation API other than create", () => {
    const transaction = Object.freeze({ create: vi.fn() });

    appendAuditEventInTransaction(transaction, { id: "audit-1" }, adminDraft);

    expect(Reflect.ownKeys(transaction)).toEqual(["create"]);
    expect(transaction.create).toHaveBeenCalledOnce();
  });
});
