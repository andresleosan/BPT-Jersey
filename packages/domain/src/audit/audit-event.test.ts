import { describe, expect, it } from "vitest";

import { auditActions, parseAuditEventDraft } from "./audit-event";

const common = {
  academyId: "academy-1",
  actorId: "admin-1",
  targetRef: "academies/academy-1/users/user-1",
  purpose: "administrative role management",
  correlationId: "correlation-1",
} as const;

const lessonPlanApproved = {
  ...common,
  action: "lesson.plan.approved",
  actorId: "head-coach-1",
  targetRef: "academies/academy-1/lessonPlans/plan-1",
  purpose: "lesson plan approval",
  correlationId: "lesson-plan:academy-1:plan-1:2026-08-31T11:00:00.000Z",
  planId: "plan-1",
  libraryId: "library-1",
  libraryVersion: 1,
  approvedAt: "2026-08-31T11:00:00.000Z",
} as const;
const memberImport = {
  ...common,
  action: "member.import.confirmed",
  targetRef: "academies/academy-1/members",
  purpose: "confirmed member PDF import",
  imported: 2,
  updated: 1,
  conflicts: 0,
  sourceHash: "a".repeat(64),
  reportKeys: ["total"],
} as const;

const regyfitImport = {
  ...common,
  actorId: "system-regyfit-importer",
  action: "regyfit.access.imported",
  targetRef: "academies/academy-1/regyfitAccessRecords",
  purpose: "approved Regyfit access import",
  importRunId: "synthetic-run-1",
  moduleKey: "alunos-acessos",
  sourceRoute: "/admin2/modulos/alunos/acessos_alunos.php",
  recordCount: 10,
  contentSha256: "b".repeat(64),
} as const;

const retentionProduction = {
  ...common,
  actorId: "system-retention-producer",
  action: "retention.alerts.generated",
  targetRef: "academies/academy-1/retentionAlerts",
  purpose: "daily retention alert production",
  correlationId: "retention-alerts:academy-1:2026-08-31",
  runDate: "2026-08-31",
  policyVersion: "1",
  evaluatedStudents: 12,
  alertCount: 3,
  inactivityDays: 14,
  lookbackDays: 30,
  noShowThreshold: 2,
  membershipExpiryDays: 14,
  sourceHash: "d".repeat(64),
} as const;

const reportExport = {
  ...common,
  action: "report.export.prepared",
  targetRef: "academies/academy-1/exports/report-export-1",
  purpose: "pilot_operations_review",
  correlationId: "report-export:report-export-1",
  scope: "operational_and_progress_aggregates",
  classification: "Confidential",
  recipient: "actor:owner-1",
  expiresAt: "2026-08-31T23:10:00.000Z",
  contentSha256: "c".repeat(64),
  byteLength: 2048,
} as const;

const membershipCreated = {
  ...common,
  action: "membership.created",
  targetRef: "academies/academy-1/memberships/membership-1",
  purpose: "created membership",
  correlationId: "membership-correlation-1",
} as const;

const memberCreated = {
  ...common,
  action: "member.created",
  targetRef: "academies/academy-1/students/student-1",
  purpose: "member-record-maintenance",
  correlationId: `write-${"a".repeat(64)}`,
} as const;

const memberUpdated = {
  ...memberCreated,
  action: "member.updated",
  correlationId: `write-${"d".repeat(64)}`,
} as const;

const familyCreated = {
  ...common,
  action: "family.created",
  targetRef: "academies/academy-1/families/family-1",
  purpose: "family-record-maintenance",
  correlationId: `family-write-${"b".repeat(64)}`,
} as const;

const familyStudentAdded = {
  ...common,
  action: "family.student.added",
  targetRef: "academies/academy-1/students/student-1",
  purpose: "family-record-maintenance",
  correlationId: `family-write-${"c".repeat(64)}`,
} as const;

const membershipStatusChanged = {
  ...common,
  action: "membership.status.changed",
  targetRef: "academies/academy-1/memberships/membership-1",
  purpose: "changed membership status",
  correlationId: "membership-correlation-2",
} as const;

const invoiceCreated = {
  ...common,
  action: "invoice.created",
  targetRef: "academies/academy-1/invoices/invoice-1",
  purpose: "manual invoice created",
  correlationId: "invoice-created-1",
  amountMinor: 1000,
  currency: "GBP",
} as const;

const invoiceVoided = {
  ...invoiceCreated,
  action: "invoice.voided",
  purpose: "manual invoice voided",
  correlationId: "invoice-voided-1",
} as const;

const paymentRecorded = {
  ...common,
  action: "payment.recorded",
  targetRef: "academies/academy-1/payments/payment-1",
  purpose: "manual payment recorded",
  correlationId: "payment-recorded-1",
  amountMinor: 1000,
  currency: "GBP",
  method: "cash",
} as const;

const familyAchievementsGenerated = {
  ...common,
  actorId: "system-family-achievements",
  action: "family.achievements.generated",
  targetRef: "academies/academy-1/familyAchievementSnapshots/family-1",
  purpose: "family achievement snapshot generation",
  correlationId: "family-achievements:academy-1:family-1:2026-08-31T12:00:00.000Z",
  familyId: "family-1",
  snapshotId: "family-achievements-v1__academy-1__family-1__2026-08-31T12:00:00.000Z",
  memberCount: 2,
  candidateCount: 3,
  generatedAt: "2026-08-31T12:00:00.000Z",
} as const;

const restrictedMemberReadDrafts = [
  {
    ...common,
    action: "member.detail.read",
    targetRef: "academies/academy-1/studentRestrictedReadLimits/admin-1",
    purpose: "member-record-maintenance",
    correlationId: "restricted-audit-detail-1",
    result: "completed",
  },
  {
    ...common,
    action: "member.identity.lookup",
    targetRef: "academies/academy-1/studentRestrictedReadLimits/admin-1",
    purpose: "member-identity-lookup",
    correlationId: "restricted-audit-lookup-1",
    result: "no-match",
  },
] as const;
describe("audit event draft contract", () => {
  it("accepts both minimal administrative role actions", () => {
    for (const action of ["admin.role.granted", "admin.role.revoked"] as const) {
      const result = parseAuditEventDraft({ ...common, action });

      expect(result).toEqual({ ok: true, value: { ...common, action } });
      expect(Object.isFrozen(result.ok ? result.value : undefined)).toBe(true);
    }
  });

  it("accepts and freezes exact member import metadata", () => {
    const result = parseAuditEventDraft(memberImport);

    expect(result).toEqual({ ok: true, value: memberImport });
    expect(Object.isFrozen(result.ok ? result.value : undefined)).toBe(true);
    expect(
      Object.isFrozen(
        result.ok && result.value.action === "member.import.confirmed"
          ? result.value.reportKeys
          : undefined,
      ),
    ).toBe(true);
  });

  it("accepts exact metadata-only Regyfit import evidence", () => {
    expect(parseAuditEventDraft(regyfitImport)).toEqual({ ok: true, value: regyfitImport });
  });

  it("accepts exact metadata-only restricted member read evidence", () => {
    for (const draft of restrictedMemberReadDrafts) {
      expect(auditActions).toContain(draft.action);
      expect(parseAuditEventDraft(draft)).toEqual({ ok: true, value: draft });
    }
  });

  it("rejects non-minimal or incorrectly scoped restricted member read evidence", () => {
    const [detail, lookup] = restrictedMemberReadDrafts;
    for (const candidate of [
      { ...detail, targetRef: "academies/academy-1/students/student-1" },
      { ...detail, purpose: "member-identity-lookup" },
      { ...detail, result: "no-match" },
      { ...lookup, result: "not-found" },
      { ...lookup, correlationId: "BPT 00000001" },
      { ...lookup, value: "BPT 00000001" },
      { ...lookup, digest: "a".repeat(64) },
      { ...lookup, keyId: "private-key-1" },
      { ...lookup, membershipNumber: "BPT 00000001" },
    ]) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("accepts exact family achievement snapshot evidence and rejects unsafe variants", () => {
    expect(parseAuditEventDraft(familyAchievementsGenerated)).toEqual({
      ok: true,
      value: familyAchievementsGenerated,
    });
    for (const candidate of [
      { ...familyAchievementsGenerated, familyId: "family/other" },
      {
        ...familyAchievementsGenerated,
        targetRef: "academies/academy-2/familyAchievementSnapshots/family-1",
      },
      { ...familyAchievementsGenerated, memberCount: 201 },
      { ...familyAchievementsGenerated, candidateCount: -1 },
      { ...familyAchievementsGenerated, generatedAt: "tomorrow" },
      { ...familyAchievementsGenerated, email: "private@example.test" },
    ]) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });
  it("accepts exact retention production evidence and rejects unsafe variants", () => {
    expect(auditActions).toContain("retention.alerts.generated");
    expect(parseAuditEventDraft(retentionProduction)).toEqual({
      ok: true,
      value: retentionProduction,
    });

    for (const candidate of [
      { ...retentionProduction, actorId: "admin-1" },
      { ...retentionProduction, targetRef: "academies/academy-1/students" },
      { ...retentionProduction, runDate: "2026-02-30" },
      { ...retentionProduction, policyVersion: "latest" },
      { ...retentionProduction, evaluatedStudents: 201 },
      { ...retentionProduction, alertCount: 201 },
      { ...retentionProduction, inactivityDays: 31 },
      { ...retentionProduction, sourceHash: "D".repeat(64) },
      { ...retentionProduction, email: "private@example.test" },
    ]) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("accepts exact aggregate export evidence and rejects unsafe variants", () => {
    expect(parseAuditEventDraft(reportExport)).toEqual({ ok: true, value: reportExport });

    for (const candidate of [
      { ...reportExport, scope: "all_members" },
      { ...reportExport, classification: "Public" },
      { ...reportExport, recipient: "external@example.test" },
      { ...reportExport, recipient: "actor:" },
      { ...reportExport, recipient: "actor:owner/other" },
      { ...reportExport, expiresAt: "tomorrow" },
      { ...reportExport, contentSha256: "C".repeat(64) },
      { ...reportExport, byteLength: 64 * 1024 + 1 },
      { ...reportExport, email: "person@example.test" },
    ]) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("accepts both membership actions with only common fields", () => {
    for (const event of [membershipCreated, membershipStatusChanged]) {
      const result = parseAuditEventDraft(event);

      expect(result).toEqual({ ok: true, value: event });
      expect(Object.isFrozen(result.ok ? result.value : undefined)).toBe(true);
    }
  });

  it("accepts only tightly scoped metadata for canonical member creation and update", () => {
    for (const event of [memberCreated, memberUpdated]) {
      expect(auditActions).toContain(event.action);
      expect(parseAuditEventDraft(event)).toEqual({ ok: true, value: event });
    }

    for (const candidate of [
      { ...memberCreated, targetRef: "academies/academy-1/members/member-1" },
      { ...memberCreated, targetRef: "academies/academy-1/students/student/other" },
      { ...memberCreated, purpose: "bulk export" },
      { ...memberCreated, correlationId: "request-1" },
      { ...memberCreated, email: "private@example.test" },
      { ...memberUpdated, targetRef: "academies/academy-1/users/user-1" },
    ]) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("accepts only closed metadata for family and minor creation", () => {
    for (const event of [familyCreated, familyStudentAdded]) {
      expect(auditActions).toContain(event.action);
      expect(parseAuditEventDraft(event)).toEqual({ ok: true, value: event });
      expect(parseAuditEventDraft({ ...event, fullName: "Private Minor" }).ok).toBe(false);
      expect(parseAuditEventDraft({ ...event, dateOfBirth: "2015-08-19" }).ok).toBe(false);
      expect(parseAuditEventDraft({ ...event, correlationId: "request-1" }).ok).toBe(false);
    }
    expect(
      parseAuditEventDraft({
        ...familyCreated,
        targetRef: "academies/academy-1/students/student-1",
      }).ok,
    ).toBe(false);
    expect(
      parseAuditEventDraft({
        ...familyStudentAdded,
        targetRef: "academies/academy-1/families/family-1",
      }).ok,
    ).toBe(false);
  });

  it("accepts exact waitlist offer lifecycle actions without PII or finance payloads", () => {
    for (const action of [
      "waitlist.offer.issued",
      "waitlist.offer.accepted",
      "waitlist.offer.declined",
      "waitlist.offer.expired",
    ] as const) {
      const event = {
        ...common,
        action,
        targetRef: "academies/academy-1/waitlistEntries/waitlist-1",
        purpose: "waitlist offer lifecycle",
        correlationId: "waitlist-offer-1",
      };

      expect(auditActions).toContain(action);
      expect(parseAuditEventDraft(event)).toEqual({ ok: true, value: event });
      expect(parseAuditEventDraft({ ...event, studentName: "Synthetic Student" }).ok).toBe(false);
      expect(parseAuditEventDraft({ ...event, paygDebtMinor: 1000 }).ok).toBe(false);
    }
  });

  it("accepts exact finance audit variants and rejects financial extras", () => {
    for (const event of [
      invoiceCreated,
      invoiceVoided,
      { ...invoiceCreated, action: "invoice.status.changed" },
    ]) {
      expect(parseAuditEventDraft(event).ok).toBe(true);
    }
    expect(parseAuditEventDraft(paymentRecorded).ok).toBe(true);
    expect(parseAuditEventDraft({ ...invoiceCreated, provider: "stripe" }).ok).toBe(false);
    expect(parseAuditEventDraft({ ...paymentRecorded, cardNumber: "4111111111111111" }).ok).toBe(
      false,
    );
    expect(parseAuditEventDraft({ ...invoiceCreated, amountMinor: 10.5 }).ok).toBe(false);
  });

  it("rejects invalid membership common fields and tenant-scoped targets", () => {
    const cases = [
      { ...membershipCreated, action: "membership.unknown" },
      { ...membershipCreated, academyId: " " },
      { ...membershipCreated, actorId: " " },
      { ...membershipCreated, targetRef: "academies/academy-2/memberships/membership-1" },
      { ...membershipCreated, purpose: " " },
      { ...membershipCreated, correlationId: " " },
    ];

    for (const candidate of cases) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("rejects extra fields and hostile accessors for membership actions", () => {
    const withExtraField = { ...membershipCreated, planId: "adult" };
    const withAccessor = { ...membershipStatusChanged };
    Object.defineProperty(withAccessor, "purpose", {
      enumerable: true,
      get: () => "hostile purpose",
    });
    const withSymbol = { ...membershipCreated };
    Object.defineProperty(withSymbol, Symbol("secret"), { enumerable: true, value: "hidden" });
    const withPrototype = Object.assign(
      Object.create({ inherited: true }),
      membershipStatusChanged,
    );

    for (const candidate of [withExtraField, withAccessor, withSymbol, withPrototype]) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("rejects throwing accessors without evaluating action or common fields", () => {
    const actionAccessor = { ...membershipCreated };
    let actionReads = 0;
    Object.defineProperty(actionAccessor, "action", {
      enumerable: true,
      get: () => {
        actionReads += 1;
        throw new Error("action getter evaluated");
      },
    });

    expect(() => parseAuditEventDraft(actionAccessor)).not.toThrow();
    expect(parseAuditEventDraft(actionAccessor).ok).toBe(false);
    expect(actionReads).toBe(0);

    for (const field of [
      "academyId",
      "actorId",
      "targetRef",
      "purpose",
      "correlationId",
    ] as const) {
      const commonAccessor = { ...membershipStatusChanged };
      let reads = 0;
      Object.defineProperty(commonAccessor, field, {
        enumerable: true,
        get: () => {
          reads += 1;
          throw new Error(`${field} getter evaluated`);
        },
      });

      expect(() => parseAuditEventDraft(commonAccessor)).not.toThrow();
      expect(parseAuditEventDraft(commonAccessor).ok).toBe(false);
      expect(reads).toBe(0);
    }
  });

  it("rejects malformed common fields and cross-tenant targets", () => {
    const customPrototype = Object.assign(Object.create({ inherited: true }), {
      ...common,
      action: "admin.role.granted",
    });
    const cases = [
      null,
      [],
      customPrototype,
      { ...common, action: "admin.role.granted", academyId: " " },
      { ...common, action: "admin.role.granted", actorId: " " },
      { ...common, action: "admin.role.granted", purpose: " " },
      { ...common, action: "admin.role.granted", correlationId: " " },
      {
        ...common,
        action: "admin.role.granted",
        targetRef: "academies/academy-2/users/user-1",
      },
      { ...common, action: "unknown.action" },
    ];

    for (const candidate of cases) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("rejects extra, hidden, symbolic, and server-owned fields", () => {
    const hidden = { ...common, action: "admin.role.granted" };
    Object.defineProperty(hidden, "email", { value: "hidden@example.test", enumerable: false });
    const symbolic = { ...common, action: "admin.role.granted" };
    Object.defineProperty(symbolic, Symbol("secret"), { value: "hidden", enumerable: true });
    const cases = [
      { ...common, action: "admin.role.granted", email: "person@example.test" },
      { ...common, action: "admin.role.granted", rawRecord: { ip: "198.51.100.10" } },
      { ...common, action: "admin.role.granted", auditEventId: "client-event" },
      { ...common, action: "admin.role.granted", occurredAt: "2026-08-19T00:00:00Z" },
      { ...common, action: "admin.role.granted", result: "completed" },
      { ...common, action: "admin.role.granted", schemaVersion: 1 },
      hidden,
      symbolic,
    ];

    for (const candidate of cases) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("rejects mixed or malformed member import metadata", () => {
    const cases = [
      { ...memberImport, imported: -1 },
      { ...memberImport, updated: 1.5 },
      { ...memberImport, conflicts: Number.NaN },
      { ...memberImport, sourceHash: "A".repeat(64) },
      { ...memberImport, sourceHash: "a".repeat(63) },
      { ...memberImport, reportKeys: [] },
      { ...memberImport, reportKeys: ["total", "total"] },
      { ...memberImport, reportKeys: ["unknown"] },
      { ...memberImport, recordCount: 3 },
    ];

    for (const candidate of cases) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("rejects mixed or unsafe Regyfit metadata", () => {
    const cases = [
      { ...regyfitImport, importRunId: " " },
      { ...regyfitImport, importRunId: "run/unsafe" },
      { ...regyfitImport, moduleKey: "alunos/acessos" },
      { ...regyfitImport, sourceRoute: "https://example.test/admin" },
      { ...regyfitImport, sourceRoute: "/admin/path?token=value" },
      { ...regyfitImport, sourceRoute: "/admin/path#fragment" },
      { ...regyfitImport, sourceRoute: "/admin/../secret" },
      { ...regyfitImport, sourceRoute: "/admin//path" },
      { ...regyfitImport, recordCount: -1 },
      { ...regyfitImport, contentSha256: "g".repeat(64) },
      { ...regyfitImport, imported: 10 },
    ];

    for (const candidate of cases) {
      expect(parseAuditEventDraft(candidate).ok).toBe(false);
    }
  });

  it("returns a detached value without mutating the input", () => {
    const input = { ...memberImport, reportKeys: [...memberImport.reportKeys] };
    const before = structuredClone(input);

    const result = parseAuditEventDraft(input);

    expect(input).toEqual(before);
    expect(result).toEqual({ ok: true, value: memberImport });
    expect(result.ok ? result.value : undefined).not.toBe(input);
  });
});

it("accepts staff lifecycle actions without payload or PII", () => {
  for (const action of [
    "staff.created",
    "staff.updated",
    "staff.status.changed",
    "staff.availability.replaced",
    "staff.assignments.replaced",
  ] as const) {
    expect(parseAuditEventDraft({ ...common, action }).ok).toBe(true);
    expect(parseAuditEventDraft({ ...common, action, email: "person@example.test" }).ok).toBe(
      false,
    );
  }
});

it("accepts exact lesson plan approval evidence and rejects unsafe variants", () => {
  expect(parseAuditEventDraft(lessonPlanApproved)).toEqual({
    ok: true,
    value: lessonPlanApproved,
  });

  for (const candidate of [
    { ...lessonPlanApproved, planId: "plan/unsafe" },
    { ...lessonPlanApproved, libraryVersion: 0 },
    { ...lessonPlanApproved, approvedAt: "tomorrow" },
    { ...lessonPlanApproved, targetRef: "academies/academy-2/lessonPlans/plan-1" },
    { ...lessonPlanApproved, email: "person@example.test" },
  ]) {
    expect(parseAuditEventDraft(candidate).ok).toBe(false);
  }
});
it("accepts waiver and consent lifecycle actions without payload or PII", () => {
  for (const action of [
    "waiver.version.published",
    "waiver.version.withdrawn",
    "consent.accepted",
    "consent.revoked",
    "consent.evidence.downloaded",
  ] as const) {
    expect(parseAuditEventDraft({ ...common, action }).ok).toBe(true);
    expect(parseAuditEventDraft({ ...common, action, typedName: "Synthetic Signer" }).ok).toBe(
      false,
    );
  }
});
