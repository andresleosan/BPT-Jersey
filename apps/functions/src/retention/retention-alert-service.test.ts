import { describe, expect, it } from "vitest";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import { buildRetentionAlerts, type RetentionAlert } from "@bpt-jersey/domain/retention";
import {
  buildRetentionProductionAuditEventId,
  createInMemoryRetentionAlertStore,
  RetentionAlertStoreError,
} from "./retention-alert-service";

function alert(academyId = "academy-a", studentId = "student-a"): RetentionAlert {
  const result = buildRetentionAlerts({
    academyId,
    now: "2026-08-28T12:00:00Z",
    policy: {
      inactivityDays: 14,
      lookbackDays: 30,
      noShowThreshold: 2,
      membershipExpiryDays: 14,
    },
    students: [
      {
        academyId,
        studentId,
        active: true,
        hasActiveMembership: true,
        membershipStartsAt: "2026-01-01T00:00:00Z",
        membershipEndsAt: null,
        attendance: [],
      },
    ],
  });
  if (!result.ok || result.value[0] === undefined) throw new Error("Invalid test alert");
  return result.value[0];
}

type RetentionProductionAudit = Extract<AuditEventDraft, { action: "retention.alerts.generated" }>;

function auditDraft(
  alerts: readonly RetentionAlert[],
  sourceHash = "a".repeat(64),
): RetentionProductionAudit {
  return {
    academyId: "academy-a",
    actorId: "system-retention-producer",
    action: "retention.alerts.generated",
    targetRef: "academies/academy-a/retentionAlerts",
    purpose: "daily retention alert production",
    correlationId: "retention-alerts:academy-a:2026-08-28",
    runDate: "2026-08-28",
    policyVersion: "1",
    evaluatedStudents: 1,
    alertCount: alerts.length,
    inactivityDays: 14,
    lookbackDays: 30,
    noShowThreshold: 2,
    membershipExpiryDays: 14,
    sourceHash,
  } as unknown as RetentionProductionAudit;
}

describe("retention alert store", () => {
  it("persists a deterministic alert once and lists only its tenant", async () => {
    const store = createInMemoryRetentionAlertStore();
    await expect(
      store.upsertAlerts({ academyId: "academy-a", alerts: [alert()] }),
    ).resolves.toEqual({
      created: 1,
      unchanged: 0,
    });
    await expect(
      store.upsertAlerts({ academyId: "academy-a", alerts: [alert()] }),
    ).resolves.toEqual({
      created: 0,
      unchanged: 1,
    });
    await expect(store.listAlerts("academy-a")).resolves.toHaveLength(1);
    await expect(store.listAlerts("academy-b")).resolves.toEqual([]);
  });

  it("rejects cross-tenant, duplicate, changed, and non-minimal alerts", async () => {
    const store = createInMemoryRetentionAlertStore();
    const first = alert();
    await expect(
      store.upsertAlerts({ academyId: "academy-b", alerts: [first] }),
    ).rejects.toMatchObject({ code: "tenant" });
    await expect(
      store.upsertAlerts({ academyId: "academy-a", alerts: [first, first] }),
    ).rejects.toMatchObject({ code: "conflict" });

    const oversized = Array.from({ length: 201 }, (_, index) =>
      alert("academy-a", "student-" + index),
    );
    await expect(
      store.upsertAlerts({ academyId: "academy-a", alerts: oversized }),
    ).rejects.toMatchObject({ code: "invalid" });

    await store.upsertAlerts({ academyId: "academy-a", alerts: [first] });
    await expect(
      store.upsertAlerts({
        academyId: "academy-a",
        alerts: [{ ...first, createdAt: "2026-08-28T13:00:00Z" }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.upsertAlerts({
        academyId: "academy-a",
        alerts: [{ ...alert(), email: "private@example.test" } as RetentionAlert],
      }),
    ).rejects.toBeInstanceOf(RetentionAlertStoreError);
    await expect(
      store.upsertAlerts({
        academyId: "academy-a",
        alerts: [{ ...alert(), createdAt: "2026-02-30T12:00:00Z" }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      store.upsertAlerts({
        academyId: "academy-a",
        alerts: [{ ...alert(), studentId: "different-student" }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("preflights a whole batch before mutating the in-memory store", async () => {
    const store = createInMemoryRetentionAlertStore();
    const existing = alert("academy-a", "existing-student");
    await store.upsertAlerts({ academyId: "academy-a", alerts: [existing] });

    await expect(
      store.upsertAlerts({
        academyId: "academy-a",
        alerts: [
          alert("academy-a", "new-student"),
          {
            ...existing,
            evidence: { ...existing.evidence, noShowCount: 1 },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(store.listAlerts("academy-a")).resolves.toEqual([existing]);
  });

  it("commits alerts and one deterministic audit as an idempotent unit", async () => {
    const store = createInMemoryRetentionAlertStore();
    const alerts = [alert()];
    const audit = auditDraft(alerts);
    const auditEventId = buildRetentionProductionAuditEventId("academy-a", "2026-08-28");

    await expect(
      store.commitProductionRun({ academyId: "academy-a", alerts, audit, auditEventId }),
    ).resolves.toEqual({ created: 1, unchanged: 0, replayed: false });
    await expect(
      store.commitProductionRun({ academyId: "academy-a", alerts, audit, auditEventId }),
    ).resolves.toEqual({ created: 0, unchanged: 1, replayed: true });
    await expect(
      store.commitProductionRun({
        academyId: "academy-a",
        alerts,
        audit: auditDraft(alerts, "b".repeat(64)),
        auditEventId,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(store.listAlerts("academy-a")).resolves.toEqual(alerts);
  });
});
