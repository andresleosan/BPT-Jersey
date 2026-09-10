import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createFirestoreRetentionSnapshotSource,
  createRetentionAlertProducer,
  type RetentionSourceFirestore,
} from "../../apps/functions/src/retention/retention-alert-producer.js";
import {
  buildRetentionProductionAuditEventId,
  createFirestoreRetentionAlertStore,
} from "../../apps/functions/src/retention/retention-alert-service.js";

const runId = "retention-producer-" + process.pid + "-" + randomUUID();
const academyId = runId + "-academy";
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const source = createFirestoreRetentionSnapshotSource({
  firestore: firestore as unknown as RetentionSourceFirestore,
});
const store = createFirestoreRetentionAlertStore({
  firestore: firestore as unknown as Parameters<
    typeof createFirestoreRetentionAlertStore
  >[0]["firestore"],
});
const producer = createRetentionAlertProducer({ source, store });
const policy = {
  inactivityDays: 14,
  lookbackDays: 30,
  noShowThreshold: 2,
  membershipExpiryDays: 14,
} as const;

beforeAll(async () => {
  await Promise.all([
    firestore.doc("academies/" + academyId + "/students/student-a").set({
      studentId: "student-a",
      academyId,
      active: true,
      status: "active",
    }),
    firestore.doc("academies/" + academyId + "/memberships/membership-a").set({
      membershipId: "membership-a",
      academyId,
      studentId: "student-a",
      status: "active",
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2026-09-05T00:00:00Z",
    }),
    ...[
      {
        attendanceId: "session-old__student-a",
        sessionId: "session-old",
        state: "attended",
        occurredAt: "2026-08-01T10:00:00Z",
        correctionOf: null,
        schemaVersion: "1",
      },
      {
        attendanceId: "session-no-show-1__student-a",
        sessionId: "session-no-show-1",
        state: "no_show",
        occurredAt: "2026-08-20T10:00:00Z",
        correctionOf: null,
        schemaVersion: "1",
      },
      {
        attendanceId: "session-no-show-2__student-a",
        sessionId: "session-no-show-2",
        state: "no_show",
        occurredAt: "2026-08-21T10:00:00Z",
        correctionOf: null,
        schemaVersion: "1",
      },
      {
        attendanceId: "attendance-correction",
        sessionId: "session-no-show-2",
        state: "no_show",
        occurredAt: "2026-08-22T10:00:00Z",
        correctionOf: "session-no-show-2__student-a",
        schemaVersion: "1",
      },
      {
        attendanceId: "session-excused__student-a",
        sessionId: "session-excused",
        state: "excused",
        occurredAt: "2026-08-23T10:00:00Z",
        correctionOf: null,
        schemaVersion: "1",
      },
    ].map((attendance) =>
      firestore.doc("academies/" + academyId + "/attendance/" + attendance.attendanceId).set({
        ...attendance,
        academyId,
        studentId: "student-a",
      }),
    ),
  ]);
});

afterAll(async () => {
  for (const collectionName of [
    "students",
    "memberships",
    "attendance",
    "retentionAlerts",
    "auditEvents",
  ]) {
    const snapshot = await firestore
      .collection("academies/" + academyId + "/" + collectionName)
      .get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
  await deleteApp(app);
});

describe("retention producer against the local Firestore emulator", () => {
  it("atomically converges concurrent identical runs to alerts and one audit", async () => {
    const results = await Promise.all([
      producer.produce({ academyId, runDate: "2026-08-31", policy }),
      producer.produce({ academyId, runDate: "2026-08-31", policy }),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(3);
    expect(results.every((result) => result.alertCount === 3)).toBe(true);
    const alerts = await firestore.collection("academies/" + academyId + "/retentionAlerts").get();
    expect(alerts.docs).toHaveLength(3);
    expect(
      alerts.docs.every(
        (document) =>
          document.data().academyId === academyId &&
          !Object.hasOwn(document.data(), "email") &&
          !Object.hasOwn(document.data(), "fullName"),
      ),
    ).toBe(true);

    const audits = await firestore.collection("academies/" + academyId + "/auditEvents").get();
    expect(audits.docs).toHaveLength(1);
    expect(audits.docs[0]?.data()).toEqual(
      expect.objectContaining({
        action: "retention.alerts.generated",
        actorId: "system-retention-producer",
        alertCount: 3,
        evaluatedStudents: 1,
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("rejects divergent replay without changing alerts or audit", async () => {
    const beforeAlerts = (
      await firestore.collection("academies/" + academyId + "/retentionAlerts").get()
    ).docs.map((document) => ({ id: document.id, data: document.data() }));
    const auditId = buildRetentionProductionAuditEventId(academyId, "2026-08-31");
    const auditBefore = (
      await firestore.doc("academies/" + academyId + "/auditEvents/" + auditId).get()
    ).data();

    await expect(
      producer.produce({
        academyId,
        runDate: "2026-08-31",
        policy: { ...policy, noShowThreshold: 3 },
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const afterAlerts = (
      await firestore.collection("academies/" + academyId + "/retentionAlerts").get()
    ).docs.map((document) => ({ id: document.id, data: document.data() }));
    expect(afterAlerts).toEqual(beforeAlerts);
    expect(
      (await firestore.doc("academies/" + academyId + "/auditEvents/" + auditId).get()).data(),
    ).toEqual(auditBefore);
  });

  it("does not create alerts when a pre-existing audit makes commit fail", async () => {
    const runDate = "2026-09-01";
    const auditId = buildRetentionProductionAuditEventId(academyId, runDate);
    await firestore.doc("academies/" + academyId + "/auditEvents/" + auditId).set({
      auditEventId: auditId,
      academyId,
      actorId: "system-retention-producer",
      action: "retention.alerts.generated",
      targetRef: "academies/" + academyId + "/retentionAlerts",
      purpose: "daily retention alert production",
      correlationId: "retention-alerts:" + academyId + ":" + runDate,
      runDate,
      policyVersion: "1",
      evaluatedStudents: 1,
      alertCount: 3,
      inactivityDays: 14,
      lookbackDays: 30,
      noShowThreshold: 2,
      membershipExpiryDays: 14,
      sourceHash: "f".repeat(64),
      occurredAt: new Date(runDate + "T00:00:00.000Z"),
      result: "completed",
      schemaVersion: 1,
    });

    await expect(producer.produce({ academyId, runDate, policy })).rejects.toMatchObject({
      code: "conflict",
    });
    const alertsForFailedRun = await firestore
      .collection("academies/" + academyId + "/retentionAlerts")
      .where("createdAt", "==", runDate + "T00:00:00.000Z")
      .get();
    expect(alertsForFailedRun.empty).toBe(true);
  });
});
