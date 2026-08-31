import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackupArtifactStore } from "../../apps/functions/src/data/backup-contracts.js";
import { createFirestoreTenantBackupSource } from "../../apps/functions/src/data/backup-firestore-source.js";
import { runTenantRestoreRehearsal } from "../../apps/functions/src/data/backup-rehearsal.js";
import { createTenantBackupService } from "../../apps/functions/src/data/backup-service.js";

const runId = `backup-rehearsal-${process.pid}-${randomUUID()}`;
const academyId = `${runId}-academy`;
const otherAcademyId = `${runId}-other`;
const waitlistId = "v2:9:session-1:9:student-1";
const quotaId = "v2:9:student-1:10:2026-08-24";
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);

function tenantPaths(scope: string): readonly string[] {
  return Object.freeze([
    `academies/${scope}/students/student-1`,
    `academies/${scope}/attendance/session-1__student-1`,
    `academies/${scope}/waitlistEntries/${waitlistId}`,
    `academies/${scope}/sessionCapacityStates/session-1`,
    `academies/${scope}/bookingQuotaStates/${quotaId}`,
    `academies/${scope}/waitlistPositionStates/session-1`,
  ]);
}

function createMemoryArtifacts(): BackupArtifactStore {
  const records = new Map<string, Uint8Array>();
  return {
    put: async (path, body) => records.set(path, body),
    get: async (path) => {
      const body = records.get(path);
      if (!body) throw new Error("artifact not found");
      return body;
    },
    delete: async (path) => records.delete(path),
  };
}

describe("tenant backup rehearsal against the local Firestore emulator", () => {
  beforeAll(async () => {
    await Promise.all([
      firestore.doc(`academies/${academyId}/students/student-1`).set({
        academyId,
        fullName: "Synthetic Backup Student",
      }),
      firestore.doc(`academies/${academyId}/attendance/session-1__student-1`).set({
        academyId,
        studentId: "student-1",
        status: "attended",
      }),
      firestore.doc(`academies/${academyId}/waitlistEntries/${waitlistId}`).set({
        waitlistId,
        academyId,
        sessionId: "session-1",
        studentId: "student-1",
        membershipId: "membership-1",
        position: 1,
        status: "waiting",
      }),
      firestore.doc(`academies/${academyId}/sessionCapacityStates/session-1`).set({
        academyId,
        sessionId: "session-1",
        revision: 1,
      }),
      firestore.doc(`academies/${academyId}/bookingQuotaStates/${quotaId}`).set({
        academyId,
        quotaId,
        studentId: "student-1",
        weekStart: "2026-08-24",
        revision: 1,
      }),
      firestore.doc(`academies/${academyId}/waitlistPositionStates/session-1`).set({
        academyId,
        sessionId: "session-1",
        lastPosition: 1,
        revision: 1,
      }),
      firestore.doc(`academies/${otherAcademyId}/students/student-other`).set({
        academyId: otherAcademyId,
        fullName: "Other Tenant Student",
      }),
      firestore.doc(`academies/${otherAcademyId}/waitlistEntries/${waitlistId}`).set({
        academyId: otherAcademyId,
        waitlistId,
        sessionId: "session-1",
        studentId: "student-1",
        status: "waiting",
      }),
      firestore.doc(`academies/${otherAcademyId}/sessionCapacityStates/session-1`).set({
        academyId: otherAcademyId,
        sessionId: "session-1",
        revision: 1,
      }),
      firestore.doc(`academies/${otherAcademyId}/bookingQuotaStates/${quotaId}`).set({
        academyId: otherAcademyId,
        quotaId,
        revision: 1,
      }),
      firestore.doc(`academies/${otherAcademyId}/waitlistPositionStates/session-1`).set({
        academyId: otherAcademyId,
        sessionId: "session-1",
        lastPosition: 1,
        revision: 1,
      }),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      ...tenantPaths(academyId).map((path) => firestore.doc(path).delete()),
      firestore.doc(`academies/${otherAcademyId}/students/student-other`).delete(),
      ...tenantPaths(otherAcademyId)
        .slice(2)
        .map((path) => firestore.doc(path).delete()),
    ]);
    await deleteApp(app);
  });

  it("backs up only the selected tenant, verifies it, and rehearses rollback", async () => {
    const service = createTenantBackupService({
      source: createFirestoreTenantBackupSource({ firestore }),
      artifacts: createMemoryArtifacts(),
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      operationId: () => "op-1234567893",
    });
    const created = await service.createTenantBackup(academyId);
    const verification = await service.verifyTenantBackup(created.operationId);
    expect(verification).toMatchObject({
      operationId: "op-1234567893",
      documentCounts: {
        attendance: 1,
        bookingQuotaStates: 1,
        sessionCapacityStates: 1,
        students: 1,
        waitlistEntries: 1,
        waitlistPositionStates: 1,
      },
      verified: true,
    });

    const backupDocuments = await createFirestoreTenantBackupSource({
      firestore,
    }).listTenantDocuments(academyId);
    expect(backupDocuments).toHaveLength(6);
    expect(backupDocuments.map(({ collection }) => collection).sort()).toEqual([
      "attendance",
      "bookingQuotaStates",
      "sessionCapacityStates",
      "students",
      "waitlistEntries",
      "waitlistPositionStates",
    ]);
    expect(backupDocuments.every((document) => document.data.academyId === academyId)).toBe(true);
    let current = [...backupDocuments];
    const rehearsal = await runTenantRestoreRehearsal({
      academyId,
      backupDocuments,
      target: {
        readTenantDocuments: async () => current,
        replaceTenantDocuments: async (_scope, next) => {
          current = [...next];
        },
      },
      failAfterApply: true,
    });
    expect(rehearsal.status).toBe("rolled-back");
    expect(current).toEqual(backupDocuments);
  });
});
