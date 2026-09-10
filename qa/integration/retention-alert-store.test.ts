import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { parseAuditEventDraft } from "../../packages/domain/src/audit/audit-event.js";
import { buildRetentionAlerts } from "../../packages/domain/src/retention-contracts.js";
import {
  buildRetentionProductionAuditEventId,
  createFirestoreRetentionAlertStore,
} from "../../apps/functions/src/retention/retention-alert-service.js";

const runId = "retention-alerts-" + process.pid + "-" + randomUUID();
const academyA = runId + "-academy-a";
const academyB = runId + "-academy-b";
const academyC = runId + "-academy-c";
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const store = createFirestoreRetentionAlertStore({
  firestore: firestore as unknown as Parameters<
    typeof createFirestoreRetentionAlertStore
  >[0]["firestore"],
});
const createdPaths: string[] = [];

function alertsFor(academyId: string) {
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
        studentId: "student-retention",
        active: true,
        hasActiveMembership: true,
        membershipStartsAt: "2026-01-01T00:00:00Z",
        membershipEndsAt: "2026-09-02T00:00:00Z",
        attendance: [],
      },
    ],
  });
  if (!result.ok) throw new Error("Invalid retention integration fixture");
  for (const alert of result.value) {
    createdPaths.push("academies/" + academyId + "/retentionAlerts/" + alert.alertId);
  }
  return result.value;
}

afterAll(async () => {
  await Promise.all([...new Set(createdPaths)].map(async (path) => firestore.doc(path).delete()));
  await deleteApp(app);
});

describe("retention alert store against the Firestore emulator", () => {
  it("persists idempotently and isolates tenant reads", async () => {
    const alertsA = alertsFor(academyA);
    const alertsB = alertsFor(academyB);

    await expect(store.upsertAlerts({ academyId: academyA, alerts: alertsA })).resolves.toEqual({
      created: 2,
      unchanged: 0,
    });
    await expect(store.upsertAlerts({ academyId: academyA, alerts: alertsA })).resolves.toEqual({
      created: 0,
      unchanged: 2,
    });
    await expect(store.upsertAlerts({ academyId: academyB, alerts: alertsB })).resolves.toEqual({
      created: 2,
      unchanged: 0,
    });

    const listedA = await store.listAlerts(academyA);
    const listedB = await store.listAlerts(academyB);
    expect(listedA).toHaveLength(2);
    expect(listedB).toHaveLength(2);
    expect(listedA.every((alert) => alert.academyId === academyA)).toBe(true);
    expect(listedB.every((alert) => alert.academyId === academyB)).toBe(true);
  });

  it("commits the maximum 200 alerts plus one audit atomically", async () => {
    const runDate = "2026-08-29";
    const built = buildRetentionAlerts({
      academyId: academyC,
      now: runDate + "T00:00:00.000Z",
      policy: {
        inactivityDays: 14,
        lookbackDays: 30,
        noShowThreshold: 2,
        membershipExpiryDays: 14,
      },
      students: Array.from({ length: 200 }, (_, index) => ({
        academyId: academyC,
        studentId: "student-" + index,
        active: true,
        hasActiveMembership: true,
        membershipStartsAt: "2026-01-01T00:00:00Z",
        membershipEndsAt: null,
        attendance: [],
      })),
    });
    if (!built.ok) throw new Error("Invalid maximum retention fixture");
    const audit = parseAuditEventDraft({
      academyId: academyC,
      actorId: "system-retention-producer",
      action: "retention.alerts.generated",
      targetRef: "academies/" + academyC + "/retentionAlerts",
      purpose: "daily retention alert production",
      correlationId: "retention-alerts:" + academyC + ":" + runDate,
      runDate,
      policyVersion: "1",
      evaluatedStudents: 200,
      alertCount: 200,
      inactivityDays: 14,
      lookbackDays: 30,
      noShowThreshold: 2,
      membershipExpiryDays: 14,
      sourceHash: "e".repeat(64),
    });
    if (!audit.ok || audit.value.action !== "retention.alerts.generated") {
      throw new Error("Invalid maximum retention audit fixture");
    }
    const auditEventId = buildRetentionProductionAuditEventId(academyC, runDate);
    for (const alert of built.value) {
      createdPaths.push("academies/" + academyC + "/retentionAlerts/" + alert.alertId);
    }
    createdPaths.push("academies/" + academyC + "/auditEvents/" + auditEventId);

    await expect(
      store.commitProductionRun({
        academyId: academyC,
        alerts: built.value,
        audit: audit.value,
        auditEventId,
      }),
    ).resolves.toEqual({ created: 200, unchanged: 0, replayed: false });
    await expect(
      store.commitProductionRun({
        academyId: academyC,
        alerts: built.value,
        audit: audit.value,
        auditEventId,
      }),
    ).resolves.toEqual({ created: 0, unchanged: 200, replayed: true });
    expect(
      (await firestore.collection("academies/" + academyC + "/retentionAlerts").get()).size,
    ).toBe(200);
  });
});
