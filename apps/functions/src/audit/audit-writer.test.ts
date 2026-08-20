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

  it("requires no mutation API other than create", () => {
    const transaction = Object.freeze({ create: vi.fn() });

    appendAuditEventInTransaction(transaction, { id: "audit-1" }, adminDraft);

    expect(Reflect.ownKeys(transaction)).toEqual(["create"]);
    expect(transaction.create).toHaveBeenCalledOnce();
  });
});
