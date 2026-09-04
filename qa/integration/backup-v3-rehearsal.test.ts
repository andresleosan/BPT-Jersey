import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { deleteApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createBackupV3FirestoreRehearsalEndpoint } from "../../apps/functions/src/data/backup-v3-firestore-rehearsal.js";
import {
  BackupV3RehearsalError,
  createBackupV3RehearsalSnapshot,
  prepareBackupV3RehearsalTarget,
  restoreBackupV3RehearsalSnapshot,
} from "../../apps/functions/src/data/backup-v3-rehearsal.js";
import {
  assertMemberDirectoryRestoreAdminApps,
  assertMemberDirectoryRestoreEnvironment,
  type MemberDirectoryEmulatorSecretBinding,
} from "../../apps/functions/src/members/member-directory-environment.js";
import {
  assertMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "../../apps/functions/src/members/member-directory-state.js";

const enabled =
  process.env["FIRESTORE_EMULATOR_HOST"] === "127.0.0.1:8080" &&
  process.env["FIREBASE_AUTH_EMULATOR_HOST"] === "127.0.0.1:9099";
const suite = enabled ? describe : describe.skip;
const runId = randomUUID().replaceAll("-", "");
const academyId = `backup-v3-${runId}`;
const authUid = `backup-user-${runId}`;
const oldAttestationId = `old-${runId}`;
const sourceProjectId = "demo-bpt-jersey";
const targetProjectId = "demo-bpt-jersey-restore";
const sourceAppName = "member-directory-restore-source";
const targetAppName = "member-directory-restore-target";

function material(seed: number): string {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => seed + index)).toString("base64url");
}

const secrets: readonly MemberDirectoryEmulatorSecretBinding[] = [
  {
    kind: "emulator-test",
    role: "source",
    projectId: sourceProjectId,
    purpose: "identity-key",
    version: "source-identity-v1",
    material: material(3),
  },
  {
    kind: "emulator-test",
    role: "source",
    projectId: sourceProjectId,
    purpose: "migration-integrity",
    version: "source-integrity-v1",
    material: material(43),
  },
  {
    kind: "emulator-test",
    role: "source",
    projectId: sourceProjectId,
    purpose: "directory-cursor",
    version: "source-cursor-v1",
    material: material(83),
  },
  {
    kind: "emulator-test",
    role: "target",
    projectId: targetProjectId,
    purpose: "identity-key",
    version: "target-identity-v1",
    material: material(123),
  },
  {
    kind: "emulator-test",
    role: "target",
    projectId: targetProjectId,
    purpose: "migration-integrity",
    version: "target-integrity-v1",
    material: material(163),
  },
  {
    kind: "emulator-test",
    role: "target",
    projectId: targetProjectId,
    purpose: "directory-cursor",
    version: "target-cursor-v1",
    material: material(203),
  },
];
const sourceIntegrity = {
  version: "source-integrity-v1",
  material: material(43),
} as const;
const targetIntegrity = {
  version: "target-integrity-v1",
  material: material(163),
} as const;

function state() {
  return {
    stateId: "current",
    academyId,
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "incomplete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "source-identity-v1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 1,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-03T12:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-09-03T12:00:00.000Z",
    updatedBy: "system",
  } as const;
}

suite("backup v3 isolated dual-project Firestore rehearsal", () => {
  let sourceApp: App;
  let targetApp: App;
  let sourceFirestore: Firestore;
  let targetFirestore: Firestore;
  let attestationPath: string | undefined;
  let targetOperationId: string | undefined;
  let targetAuditId: string | undefined;

  beforeAll(async () => {
    assertMemberDirectoryRestoreAdminApps(
      "before-initialization",
      getApps().map((app) =>
        app.options.projectId === undefined
          ? { name: app.name }
          : { name: app.name, projectId: app.options.projectId },
      ),
    );
    sourceApp = initializeApp({ projectId: sourceProjectId }, sourceAppName);
    targetApp = initializeApp({ projectId: targetProjectId }, targetAppName);
    sourceFirestore = getFirestore(sourceApp);
    targetFirestore = getFirestore(targetApp);
    const sourceState = state();
    const sourceControl = buildInitialMemberDirectoryControlPlane({
      projectId: sourceProjectId,
      state: sourceState,
      integritySecretMaterial: sourceIntegrity.material,
      integritySecretVersion: sourceIntegrity.version,
      now: "2026-09-03T12:00:00.000Z",
      actorId: "system",
    });
    await Promise.all([
      sourceFirestore
        .doc(`academies/${academyId}/memberDirectoryStates/current`)
        .create(sourceState),
      sourceFirestore.doc(`academies/${academyId}/students/student-1`).create({
        academyId,
        studentId: "student-1",
        fullName: "Synthetic Restore Student",
      }),
      sourceFirestore.doc(`academies/${academyId}/users/${authUid}`).create({
        academyId,
        userId: authUid,
        accountType: "client",
      }),
      sourceFirestore.doc(`academies/${academyId}/memberDirectoryCursorStates/cursor-1`).create({
        academyId,
        cursorMac: "excluded-synthetic-cursor",
      }),
      sourceFirestore.doc(`memberDirectoryRestoreGuards/${academyId}`).create({
        ...sourceControl.guard,
      }),
      sourceFirestore
        .doc(`memberDirectoryRestoreGuards/${academyId}/events/0`)
        .create(sourceControl.event),
      sourceFirestore.doc(`memberDirectoryRestoreAttestations/${oldAttestationId}`).create({
        academyId,
        schemaVersion: "old-synthetic",
      }),
      getAuth(sourceApp).createUser({
        uid: authUid,
        email: `${runId}@example.test`,
      }),
    ]);
  });

  afterAll(async () => {
    const paths = [
      `academies/${academyId}/memberDirectoryStates/current`,
      `academies/${academyId}/students/student-1`,
      `academies/${academyId}/users/${authUid}`,
      `academies/${academyId}/memberDirectoryCursorStates/cursor-1`,
      `memberDirectoryRestoreGuards/${academyId}`,
      `memberDirectoryRestoreGuards/${academyId}/events/0`,
      `memberDirectoryRestoreAttestations/${oldAttestationId}`,
      ...(attestationPath === undefined ? [] : [attestationPath]),
    ];
    await Promise.all([
      ...paths.map((path) => sourceFirestore.doc(path).delete()),
      targetFirestore.doc(`academies/${academyId}/students/student-1`).delete(),
      targetFirestore.doc(`academies/${academyId}/users/${authUid}`).delete(),
      targetFirestore.doc(`academies/${academyId}/memberDirectoryStates/current`).delete(),
      targetFirestore.doc(`memberDirectoryRestoreGuards/${academyId}`).delete(),
      targetFirestore.doc(`memberDirectoryRestoreGuards/${academyId}/events/0`).delete(),
      ...(targetOperationId === undefined
        ? []
        : [
            targetFirestore
              .doc(`academies/${academyId}/memberDirectoryMigrations/${targetOperationId}`)
              .delete(),
          ]),
      ...(targetAuditId === undefined
        ? []
        : [targetFirestore.doc(`academies/${academyId}/auditEvents/${targetAuditId}`).delete()]),
      targetFirestore.doc("unexpectedTargets/probe").delete(),
      getAuth(sourceApp)
        .deleteUser(authUid)
        .catch(() => undefined),
    ]);
    await Promise.all([deleteApp(sourceApp), deleteApp(targetApp)]);
  });

  it("snapshots, verifies and restores only quarantined payload into the empty target", async () => {
    const binding = assertMemberDirectoryRestoreEnvironment({
      target: "emulator",
      sourceProjectId,
      targetProjectId,
      environment: {
        FIRESTORE_EMULATOR_HOST: process.env["FIRESTORE_EMULATOR_HOST"]!,
        FIREBASE_AUTH_EMULATOR_HOST: process.env["FIREBASE_AUTH_EMULATOR_HOST"]!,
        ...(process.env["GCLOUD_PROJECT"] ? { GCLOUD_PROJECT: process.env["GCLOUD_PROJECT"] } : {}),
        ...(process.env["GOOGLE_CLOUD_PROJECT"]
          ? { GOOGLE_CLOUD_PROJECT: process.env["GOOGLE_CLOUD_PROJECT"] }
          : {}),
        ...(process.env["FIREBASE_CONFIG"]
          ? { FIREBASE_CONFIG: process.env["FIREBASE_CONFIG"] }
          : {}),
      },
      testSecrets: secrets,
    });
    assertMemberDirectoryRestoreAdminApps(
      "after-initialization",
      getApps().map((app) =>
        app.options.projectId === undefined
          ? { name: app.name }
          : { name: app.name, projectId: app.options.projectId },
      ),
    );
    const source = createBackupV3FirestoreRehearsalEndpoint({
      app: sourceApp,
      role: "source",
    });
    const target = createBackupV3FirestoreRehearsalEndpoint({
      app: targetApp,
      role: "target",
    });
    const artifact = await createBackupV3RehearsalSnapshot({
      academyId,
      binding,
      source,
      sourceIntegrity,
      targetIntegrityVersion: targetIntegrity.version,
    });
    expect(artifact.payloadDocumentCount).toBe(2);
    expect(artifact.authArtifactCount).toBe(0);
    expect(artifact.rows.some(({ sourcePath }) => sourcePath.includes("CursorStates"))).toBe(false);
    expect(artifact.rows.some(({ sourcePath }) => sourcePath.includes("RestoreGuards"))).toBe(
      false,
    );

    await targetFirestore.doc("unexpectedTargets/probe").create({ synthetic: true });
    await expect(
      restoreBackupV3RehearsalSnapshot({
        academyId,
        artifact,
        binding,
        source,
        target,
        sourceIntegrity,
        targetIntegrity,
      }),
    ).rejects.toMatchObject({ code: "target-not-empty" } satisfies Partial<BackupV3RehearsalError>);
    await targetFirestore.doc("unexpectedTargets/probe").delete();

    const preparationInput = (preparedAt: string) => ({
      academyId,
      artifact,
      binding,
      source,
      target,
      sourceIntegrity,
      targetIntegrity,
      now: () => new Date(preparedAt),
    });
    const concurrentPreparations = await Promise.all([
      prepareBackupV3RehearsalTarget(preparationInput("2026-09-03T12:10:00.000Z")),
      prepareBackupV3RehearsalTarget(preparationInput("2026-09-03T12:10:00.000Z")),
    ]);
    expect(concurrentPreparations.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect(new Set(concurrentPreparations.map(({ targetOperationId: id }) => id)).size).toBe(1);
    expect(new Set(concurrentPreparations.map(({ auditEventId }) => auditEventId)).size).toBe(1);
    targetOperationId = concurrentPreparations[0]!.targetOperationId;
    targetAuditId = concurrentPreparations[0]!.auditEventId;

    const exactRetry = await prepareBackupV3RehearsalTarget(
      preparationInput("2026-09-03T12:11:00.000Z"),
    );
    expect(exactRetry).toMatchObject({
      checkpoint: "I1",
      targetOperationId,
      auditEventId: targetAuditId,
      targetStateRevision: 0,
      targetControlDocumentCount: 5,
      replayed: true,
    });

    const statePath = `academies/${academyId}/memberDirectoryStates/current`;
    const guardPath = `memberDirectoryRestoreGuards/${academyId}`;
    const eventPath = `${guardPath}/events/0`;
    const migrationPath = `academies/${academyId}/memberDirectoryMigrations/${targetOperationId}`;
    const auditPath = `academies/${academyId}/auditEvents/${targetAuditId}`;
    const [preparedState, preparedGuard, preparedEvent, migration, audit] = await Promise.all([
      targetFirestore.doc(statePath).get(),
      targetFirestore.doc(guardPath).get(),
      targetFirestore.doc(eventPath).get(),
      targetFirestore.doc(migrationPath).get(),
      targetFirestore.doc(auditPath).get(),
    ]);
    expect(preparedState.data()).toMatchObject({
      readerVersion: "canonical-v1",
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: "restore-prepared",
      stateRevision: 0,
      preparedOperationId: targetOperationId,
    });
    expect(preparedState.data()).not.toHaveProperty("activeOperationId");
    expect(preparedState.data()).not.toHaveProperty("leaseId");
    expect(preparedState.data()).not.toHaveProperty("operationDeadline");
    expect(() =>
      assertMemberDirectoryControlPlane({
        projectId: targetProjectId,
        state: preparedState.data(),
        guard: preparedGuard.data(),
        event: preparedEvent.data(),
        integritySecretMaterial: targetIntegrity.material,
        integritySecretVersion: targetIntegrity.version,
      }),
    ).not.toThrow();
    expect(migration.data()).toMatchObject({
      operationId: targetOperationId,
      operationType: "member-directory-restore-recovery",
      status: "planned",
      targetStateRevision: 0,
      payloadDocumentCount: 2,
      preparedBy: "backup-v3-rehearsal",
    });
    expect(audit.data()).toEqual({
      auditEventId: targetAuditId,
      academyId,
      actorId: "backup-v3-rehearsal",
      action: "member-directory.restore.prepared",
      targetRef: migrationPath,
      purpose: "quarantined-restore-preparation",
      correlationId: targetOperationId,
      result: "prepared",
      stateRevision: 0,
      occurredAt: "2026-09-03T12:10:00.000Z",
      schemaVersion: 1,
    });
    expect(JSON.stringify({ migration: migration.data(), audit: audit.data() })).not.toMatch(
      /Synthetic Restore Student|student-1|fullName|email|phoneNumber/u,
    );

    const exactAudit = audit.data()!;
    await targetFirestore.doc(auditPath).delete();
    await expect(
      prepareBackupV3RehearsalTarget(preparationInput("2026-09-03T12:12:00.000Z")),
    ).rejects.toMatchObject({
      code: "target-verification",
    } satisfies Partial<BackupV3RehearsalError>);
    await targetFirestore.doc(auditPath).create(exactAudit);

    const exactMigration = migration.data()!;
    await targetFirestore.doc(migrationPath).set({
      ...exactMigration,
      planMac: "0".repeat(64),
    });
    await expect(
      prepareBackupV3RehearsalTarget(preparationInput("2026-09-03T12:13:00.000Z")),
    ).rejects.toMatchObject({
      code: "target-verification",
    } satisfies Partial<BackupV3RehearsalError>);
    await targetFirestore.doc(migrationPath).set(exactMigration);

    const result = await restoreBackupV3RehearsalSnapshot({
      academyId,
      artifact,
      binding,
      source,
      target,
      sourceIntegrity,
      targetIntegrity,
      now: () => new Date("2026-09-03T12:14:00.000Z"),
    });
    attestationPath = `memberDirectoryRestoreAttestations/${result.attestationId}`;

    expect(result).toMatchObject({
      restoredDocumentCount: 2,
      authorityMode: "quarantined-no-auth",
      targetAuthUserCount: 0,
    });
    const [student, user, stateDocument, guard, targetUsers, attestation] = await Promise.all([
      targetFirestore.doc(`academies/${academyId}/students/student-1`).get(),
      targetFirestore.doc(`academies/${academyId}/users/${authUid}`).get(),
      targetFirestore.doc(`academies/${academyId}/memberDirectoryStates/current`).get(),
      targetFirestore.doc(`memberDirectoryRestoreGuards/${academyId}`).get(),
      getAuth(targetApp).listUsers(1),
      sourceFirestore.doc(attestationPath).get(),
    ]);
    expect(student.data()).toEqual({
      academyId,
      studentId: "student-1",
      fullName: "Synthetic Restore Student",
    });
    expect(user.exists).toBe(true);
    expect(stateDocument.data()).toMatchObject({
      readerVersion: "canonical-v1",
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: "restore-prepared",
      preparedOperationId: targetOperationId,
    });
    expect(guard.exists).toBe(true);
    expect(targetUsers.users).toHaveLength(0);
    expect(attestation.exists).toBe(true);
    expect(attestation.data()).toEqual(result.attestation);
    const attestationJson = JSON.stringify(attestation.data());
    expect(attestationJson).not.toContain("Synthetic Restore Student");
    expect(attestationJson).not.toContain("student-1");
    expect(attestationJson).not.toContain(authUid);
    expect(attestationJson).not.toContain(sourceIntegrity.material);
    expect(attestationJson).not.toContain(targetIntegrity.material);
  });
});
