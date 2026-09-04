import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import type { MemberDirectoryRestoreEnvironmentBinding } from "../members/member-directory-environment.js";
import {
  assertMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "../members/member-directory-state.js";
import {
  BackupV3RehearsalError,
  createBackupV3RehearsalSnapshot,
  prepareBackupV3RehearsalTarget,
  restoreBackupV3RehearsalSnapshot,
  verifyBackupV3RehearsalSnapshot,
  type BackupV3Inventory,
  type BackupV3RehearsalEndpoint,
  type BackupV3TargetCheckpointWrite,
  type BackupV3WriteDocument,
} from "./backup-v3-rehearsal.js";
import {
  encodeBackupV3FirestoreDocument,
  type BackupV3CanonicalFirestoreDocument,
} from "./backup-v3-firestore-value-codec.js";
import type { BackupV3ExactPayloadDocument } from "./backup-v3-firestore-exact-writer.js";

const academyId = "academy-rehearsal-1";
const sourceSecret = Buffer.from(Array.from({ length: 32 }, (_, index) => 11 + index)).toString(
  "base64url",
);
const targetSecret = Buffer.from(Array.from({ length: 32 }, (_, index) => 91 + index)).toString(
  "base64url",
);
const binding: MemberDirectoryRestoreEnvironmentBinding = Object.freeze({
  target: "emulator",
  sourceProjectId: "demo-bpt-jersey",
  targetProjectId: "demo-bpt-jersey-restore",
  sourceAppName: "member-directory-restore-source",
  targetAppName: "member-directory-restore-target",
  firestoreEmulatorHost: "127.0.0.1:8080",
  authEmulatorHost: "127.0.0.1:9099",
});

function directoryState() {
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
    secretVersion: "identity-v1",
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

function sourceControlPlane() {
  return buildInitialMemberDirectoryControlPlane({
    projectId: "demo-bpt-jersey",
    state: directoryState(),
    integritySecretMaterial: sourceSecret,
    integritySecretVersion: "source-integrity-v1",
    now: "2026-09-03T12:00:00.000Z",
    actorId: "system",
  });
}

type TestInventoryEntry =
  | Readonly<{ path: string; exists: false }>
  | Readonly<{
      path: string;
      exists: true;
      data: Readonly<Record<string, unknown>> | BackupV3CanonicalFirestoreDocument;
    }>;

function restValue(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } };
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          restValue(item),
        ]),
      ),
    },
  };
}

function encodedDocument(
  data: Readonly<Record<string, unknown>> | BackupV3CanonicalFirestoreDocument,
  projectId: string,
): BackupV3CanonicalFirestoreDocument {
  if ("codecVersion" in data) return data as BackupV3CanonicalFirestoreDocument;
  return encodeBackupV3FirestoreDocument(
    Object.fromEntries(Object.entries(data).map(([key, value]) => [key, restValue(value)])),
    { database: `projects/${projectId}/databases/(default)/documents` },
  );
}

function sourceInventory(extra: readonly TestInventoryEntry[] = []): readonly TestInventoryEntry[] {
  const control = sourceControlPlane();
  return [
    { path: `academies/${academyId}`, exists: false },
    {
      path: `academies/${academyId}/memberDirectoryStates/current`,
      exists: true,
      data: directoryState(),
    },
    {
      path: `academies/${academyId}/students/student-1`,
      exists: true,
      data: {
        academyId,
        studentId: "student-1",
        fullName: "Synthetic Student",
      },
    },
    {
      path: `academies/${academyId}/users/user-1`,
      exists: true,
      data: {
        academyId,
        userId: "user-1",
        accountType: "client",
      },
    },
    {
      path: `academies/${academyId}/memberDirectoryCursorStates/cursor-1`,
      exists: true,
      data: { academyId, cursorMac: "not-backed-up" },
    },
    {
      path: `memberDirectoryRestoreGuards/${academyId}`,
      exists: true,
      data: control.guard,
    },
    {
      path: `memberDirectoryRestoreGuards/${academyId}/events/0`,
      exists: true,
      data: control.event,
    },
    {
      path: "memberDirectoryRestoreAttestations/old-attestation",
      exists: true,
      data: { academyId, status: "old" },
    },
    ...extra,
  ];
}

function inventory(
  projectId: string,
  entries: readonly TestInventoryEntry[],
  readTime = "2026-09-03T12:05:00.000Z",
): BackupV3Inventory {
  return Object.freeze({
    projectId,
    readTime,
    entries: Object.freeze(
      entries.map((entry) =>
        entry.exists
          ? Object.freeze({
              path: entry.path,
              exists: true as const,
              data: encodedDocument(entry.data, projectId),
            })
          : entry,
      ),
    ),
  });
}

function endpoint(input: {
  projectId: string;
  sourceEntries?: readonly TestInventoryEntry[];
  targetEntries?: readonly TestInventoryEntry[];
  hasAuthUser?: boolean;
  prepareCrash?: "before-commit-once" | "after-commit-once";
  afterPrepare?: (
    records: Map<string, Readonly<Record<string, unknown>> | BackupV3CanonicalFirestoreDocument>,
    attempt: number,
  ) => void;
}) {
  let sourceReads = 0;
  let namespaceReads = 0;
  let authReads = 0;
  let prepareAttempts = 0;
  const records = new Map<
    string,
    Readonly<Record<string, unknown>> | BackupV3CanonicalFirestoreDocument
  >(
    (input.targetEntries ?? [])
      .filter((entry) => entry.exists)
      .map((entry) => [entry.path, entry.data!]),
  );
  const metadata = new Map<string, Readonly<Record<string, unknown>>>();
  const writes: BackupV3ExactPayloadDocument[][] = [];
  const controlWrites: BackupV3WriteDocument[][] = [];
  const api: BackupV3RehearsalEndpoint = {
    projectId: input.projectId,
    readSourceInventory: async () => {
      sourceReads += 1;
      return inventory(input.projectId, input.sourceEntries ?? sourceInventory());
    },
    readNamespaceInventory: async () => {
      namespaceReads += 1;
      return inventory(input.projectId, [
        { path: `academies/${academyId}`, exists: false },
        ...[...records].map(([path, data]) => ({ path, exists: true as const, data })),
      ]);
    },
    hasAnyAuthUser: async () => {
      authReads += 1;
      return input.hasAuthUser ?? false;
    },
    prepareTargetCheckpoint: async (command: BackupV3TargetCheckpointWrite) => {
      prepareAttempts += 1;
      const existingCount = command.documents.filter((document) =>
        records.has(document.path),
      ).length;
      if (existingCount !== 0 && existingCount !== command.documents.length) {
        throw new Error("partial target checkpoint");
      }
      if (existingCount === 0) {
        if (input.prepareCrash === "before-commit-once" && prepareAttempts === 1) {
          throw new Error("synthetic crash before checkpoint commit");
        }
        for (const document of command.documents) {
          records.set(document.path, document.data);
        }
        controlWrites.push([...command.documents]);
        if (input.prepareCrash === "after-commit-once" && prepareAttempts === 1) {
          throw new Error("synthetic crash after checkpoint commit");
        }
      }
      input.afterPrepare?.(records, prepareAttempts);
      return existingCount === 0 ? "created" : "existing";
    },
    createPayloadDocuments: async (request) => {
      writes.push([...request.documents]);
      for (const document of request.documents) {
        if (records.has(document.path)) throw new Error("document exists");
        records.set(document.path, document.data);
      }
    },
    putMetadataDocument: async (path, data) => {
      const previous = metadata.get(path);
      if (previous && JSON.stringify(previous) !== JSON.stringify(data)) {
        throw new Error("metadata conflict");
      }
      metadata.set(path, data);
    },
  };
  return {
    api,
    metadata,
    records,
    writes,
    controlWrites,
    get sourceReads() {
      return sourceReads;
    },
    get namespaceReads() {
      return namespaceReads;
    },
    get authReads() {
      return authReads;
    },
    get prepareAttempts() {
      return prepareAttempts;
    },
  };
}

async function makeSnapshot(
  source = endpoint({
    projectId: "demo-bpt-jersey",
    sourceEntries: sourceInventory(),
  }).api,
) {
  return createBackupV3RehearsalSnapshot({
    academyId,
    binding,
    source,
    sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
    targetIntegrityVersion: "target-integrity-v1",
  });
}

function preparationInput(
  artifact: Awaited<ReturnType<typeof makeSnapshot>>,
  target: BackupV3RehearsalEndpoint,
  preparedAt = "2026-09-03T12:10:00.000Z",
) {
  return {
    academyId,
    artifact,
    binding,
    source: endpoint({ projectId: "demo-bpt-jersey" }).api,
    target,
    sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
    targetIntegrity: { version: "target-integrity-v1", material: targetSecret },
    now: () => new Date(preparedAt),
  } as const;
}

function expectCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(BackupV3RehearsalError);
  expect(error).toMatchObject({ code });
  return true;
}

describe("backup v3 isolated rehearsal core", () => {
  it("snapshots only the closed materializable disposition and verifies its MAC", async () => {
    const artifact = await makeSnapshot();

    expect(artifact).toMatchObject({
      schemaVersion: 3,
      artifactDispositionVersion: "member-directory-restore-v1",
      inventoryVersion: "firestore-namespace-inventory-v1",
      firestoreValueCodecVersion: "firestore-value-v1",
      sourceProjectId: "demo-bpt-jersey",
      targetProjectId: "demo-bpt-jersey-restore",
      academyId,
      authorityMode: "quarantined-no-auth",
      authArtifactCount: 0,
      backupDocumentCount: 3,
      payloadDocumentCount: 2,
      excludedDocumentCount: 4,
    });
    expect(artifact.rows.map(({ sourcePath, disposition }) => [sourcePath, disposition])).toEqual([
      [`academies/${academyId}/memberDirectoryStates/current`, "verify-only-authority"],
      [`academies/${academyId}/students/student-1`, "materialize-exact"],
      [`academies/${academyId}/users/user-1`, "materialize-exact"],
    ]);
    expect(artifact.rows.some(({ sourcePath }) => sourcePath.includes("CursorStates"))).toBe(false);
    expect(artifact.rows.some(({ sourcePath }) => sourcePath.includes("RestoreGuards"))).toBe(
      false,
    );
    expect(artifact.payloadRootMac).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.sourceStateEvidenceMac).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.backupRootMac).toMatch(/^[a-f0-9]{64}$/u);

    expect(
      verifyBackupV3RehearsalSnapshot({
        artifact,
        sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
      }),
    ).toEqual({
      backupDocumentCount: 3,
      payloadDocumentCount: 2,
      payloadDecodedBytes: artifact.payloadDecodedBytes,
    });
  });

  it("rejects unknown inventory, missing authority evidence and tampered artifacts", async () => {
    const unknown = endpoint({
      projectId: "demo-bpt-jersey",
      sourceEntries: sourceInventory([
        {
          path: `academies/${academyId}/unknown/doc-1`,
          exists: true,
          data: { academyId },
        },
      ]),
    });
    await expect(makeSnapshot(unknown.api)).rejects.toSatisfy((error: unknown) =>
      expectCode(error, "invalid-inventory"),
    );

    const missingState = endpoint({
      projectId: "demo-bpt-jersey",
      sourceEntries: sourceInventory().filter(
        ({ path }) => path !== `academies/${academyId}/memberDirectoryStates/current`,
      ),
    });
    await expect(makeSnapshot(missingState.api)).rejects.toSatisfy((error: unknown) =>
      expectCode(error, "source-authority-evidence"),
    );

    const artifact = await makeSnapshot();
    const tampered = {
      ...artifact,
      rows: artifact.rows.map((row) =>
        row.sourcePath.endsWith("/students/student-1")
          ? {
              ...row,
              data: {
                ...row.data,
                fields: {
                  ...row.data.fields,
                  fullName: { type: "string" as const, value: "Tampered Student" },
                },
              },
            }
          : row,
      ),
    };
    expect(() =>
      verifyBackupV3RehearsalSnapshot({
        artifact: tampered,
        sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-artifact" }));
  });

  it("rejects a missing or divergent source guard head before creating an artifact", async () => {
    const missingEvent = endpoint({
      projectId: "demo-bpt-jersey",
      sourceEntries: sourceInventory().filter(({ path }) => !path.endsWith("/events/0")),
    });
    await expect(makeSnapshot(missingEvent.api)).rejects.toSatisfy((error: unknown) =>
      expectCode(error, "source-authority-evidence"),
    );

    const divergentGuard = endpoint({
      projectId: "demo-bpt-jersey",
      sourceEntries: sourceInventory().map((entry) =>
        entry.path === `memberDirectoryRestoreGuards/${academyId}` && entry.exists
          ? { ...entry, data: { ...entry.data, highestStateRevision: 1 } }
          : entry,
      ),
    });
    await expect(makeSnapshot(divergentGuard.api)).rejects.toSatisfy((error: unknown) =>
      expectCode(error, "source-authority-evidence"),
    );
  });

  it("atomically prepares the exact non-serving I1 control checkpoint before payload", async () => {
    const artifact = await makeSnapshot();
    const target = endpoint({ projectId: "demo-bpt-jersey-restore" });
    const preparedAt = "2026-09-03T12:10:00.000Z";

    const result = await prepareBackupV3RehearsalTarget(
      preparationInput(artifact, target.api, preparedAt),
    );

    expect(result).toEqual({
      checkpoint: "I1",
      targetOperationId: `restore-op-${artifact.backupRootMac.slice(0, 24)}`,
      targetStateRevision: 0,
      targetControlDocumentCount: 5,
      auditEventId: expect.stringMatching(/^restore-audit-[a-f0-9]{48}$/u),
      replayed: false,
    });
    expect(target.controlWrites).toHaveLength(1);
    expect(target.controlWrites[0]).toHaveLength(5);
    expect(target.writes).toHaveLength(0);

    const operationId = result.targetOperationId;
    const statePath = `academies/${academyId}/memberDirectoryStates/current`;
    const guardPath = `memberDirectoryRestoreGuards/${academyId}`;
    const eventPath = `${guardPath}/events/0`;
    const migrationPath = `academies/${academyId}/memberDirectoryMigrations/${operationId}`;
    const auditPath = `academies/${academyId}/auditEvents/${result.auditEventId}`;
    expect([...target.records.keys()].sort()).toEqual(
      [statePath, guardPath, eventPath, migrationPath, auditPath].sort(),
    );

    const preparedState = target.records.get(statePath)!;
    expect(preparedState).toEqual({
      stateId: "current",
      academyId,
      readerVersion: "canonical-v1",
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      stateRevision: 0,
      globalLegacyReadEliminated: false,
      identityKeyCoverage: "incomplete",
      digestVersion: "hmac-sha256-v1",
      secretVersion: "identity-v1",
      rollbackProtocolVersion: "legacy-projection-v1",
      rollbackCapacityLimit: 400,
      rollbackEligibleStudentCount: 1,
      operationPhase: "restore-prepared",
      lastCommittedChunkNo: 0,
      preparedOperationId: operationId,
      schemaVersion: "1",
      createdAt: preparedAt,
      createdBy: "backup-v3-rehearsal",
      updatedAt: preparedAt,
      updatedBy: "backup-v3-rehearsal",
    });
    for (const forbidden of [
      "activeOperationId",
      "leaseId",
      "leaseOwner",
      "leaseExpiresAt",
      "operationDeadline",
    ]) {
      expect(preparedState).not.toHaveProperty(forbidden);
    }

    const guard = target.records.get(guardPath)!;
    const event = target.records.get(eventPath)!;
    expect(event).toMatchObject({
      eventId: "0",
      projectId: "demo-bpt-jersey-restore",
      academyId,
      operationId,
      transitionKind: "restore-prepare",
      actorId: "backup-v3-rehearsal",
      currentStateRevision: 0,
      restoreEpoch: 0,
    });
    expect(() =>
      assertMemberDirectoryControlPlane({
        projectId: "demo-bpt-jersey-restore",
        state: preparedState,
        guard,
        event,
        integritySecretMaterial: targetSecret,
        integritySecretVersion: "target-integrity-v1",
      }),
    ).not.toThrow();
    expect(() =>
      assertMemberDirectoryControlPlane({
        projectId: "demo-bpt-jersey-restore",
        state: preparedState,
        guard,
        event,
        integritySecretMaterial: sourceSecret,
        integritySecretVersion: "target-integrity-v1",
      }),
    ).toThrow("MAC mismatch");

    const migration = target.records.get(migrationPath)!;
    expect(migration).toEqual({
      operationId,
      operationType: "member-directory-restore-recovery",
      status: "planned",
      sourceProjectId: "demo-bpt-jersey",
      targetProjectId: "demo-bpt-jersey-restore",
      academyId,
      authorityMode: "quarantined-no-auth",
      artifactDispositionVersion: "member-directory-restore-v1",
      inventoryVersion: "firestore-namespace-inventory-v1",
      firestoreValueCodecVersion: "firestore-value-v1",
      integrityMacVersion: "hmac-sha256-v1",
      sourceIntegritySecretVersion: "source-integrity-v1",
      targetIntegritySecretVersion: "target-integrity-v1",
      snapshotReadTime: artifact.snapshotReadTime,
      sourceStateRevision: 0,
      sourceGlobalLegacyReadEliminated: false,
      sourceRollbackEligibleStudentCount: 1,
      targetStateRevision: 0,
      payloadDocumentCount: 2,
      payloadDecodedBytes: artifact.payloadDecodedBytes,
      payloadRootMac: artifact.payloadRootMac,
      backupRootMac: artifact.backupRootMac,
      sourceStateEvidenceMac: artifact.sourceStateEvidenceMac,
      preparedAt,
      preparedBy: "backup-v3-rehearsal",
      schemaVersion: "1",
      planMac: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(target.records.get(auditPath)).toEqual({
      auditEventId: result.auditEventId,
      academyId,
      actorId: "backup-v3-rehearsal",
      action: "member-directory.restore.prepared",
      targetRef: migrationPath,
      purpose: "quarantined-restore-preparation",
      correlationId: operationId,
      result: "prepared",
      stateRevision: 0,
      occurredAt: preparedAt,
      schemaVersion: 1,
    });
    const serializedMetadata = JSON.stringify({ migration, audit: target.records.get(auditPath) });
    expect(serializedMetadata).not.toMatch(
      /Synthetic Student|student-1|user-1|fullName|email|phoneNumber|rows|sourcePath|targetPath/u,
    );
    expect(serializedMetadata).not.toContain(sourceSecret);
    expect(serializedMetadata).not.toContain(targetSecret);
  });

  it("leaves only I0 or complete I1 across ambiguous preparation crashes and replays exact I1", async () => {
    const artifact = await makeSnapshot();
    const beforeCommit = endpoint({
      projectId: "demo-bpt-jersey-restore",
      prepareCrash: "before-commit-once",
    });
    await expect(
      prepareBackupV3RehearsalTarget(preparationInput(artifact, beforeCommit.api)),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "target-verification"));
    expect(beforeCommit.records).toHaveLength(0);
    expect(beforeCommit.controlWrites).toHaveLength(0);

    const recoveredI0 = await prepareBackupV3RehearsalTarget(
      preparationInput(artifact, beforeCommit.api, "2026-09-03T12:11:00.000Z"),
    );
    expect(recoveredI0).toMatchObject({ checkpoint: "I1", replayed: false });
    expect(beforeCommit.records).toHaveLength(5);
    expect(beforeCommit.controlWrites).toHaveLength(1);

    const afterCommit = endpoint({
      projectId: "demo-bpt-jersey-restore",
      prepareCrash: "after-commit-once",
    });
    await expect(
      prepareBackupV3RehearsalTarget(preparationInput(artifact, afterCommit.api)),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "target-verification"));
    expect(afterCommit.records).toHaveLength(5);
    expect(afterCommit.controlWrites).toHaveLength(1);

    const recoveredI1 = await prepareBackupV3RehearsalTarget(
      preparationInput(artifact, afterCommit.api, "2026-09-03T12:12:00.000Z"),
    );
    expect(recoveredI1).toMatchObject({ checkpoint: "I1", replayed: true });
    expect(afterCommit.records).toHaveLength(5);
    expect(afterCommit.controlWrites).toHaveLength(1);
  });

  it("fails closed on partial, divergent or Auth-populated I1 without another control write", async () => {
    const artifact = await makeSnapshot();

    const partial = endpoint({ projectId: "demo-bpt-jersey-restore" });
    const partialResult = await prepareBackupV3RehearsalTarget(
      preparationInput(artifact, partial.api),
    );
    partial.records.delete(`academies/${academyId}/auditEvents/${partialResult.auditEventId}`);
    await expect(
      prepareBackupV3RehearsalTarget(
        preparationInput(artifact, partial.api, "2026-09-03T12:11:00.000Z"),
      ),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "target-verification"));
    expect(partial.controlWrites).toHaveLength(1);

    const divergent = endpoint({ projectId: "demo-bpt-jersey-restore" });
    const divergentResult = await prepareBackupV3RehearsalTarget(
      preparationInput(artifact, divergent.api),
    );
    const migrationPath = `academies/${academyId}/memberDirectoryMigrations/${divergentResult.targetOperationId}`;
    divergent.records.set(migrationPath, {
      ...divergent.records.get(migrationPath)!,
      planMac: "0".repeat(64),
    });
    await expect(
      prepareBackupV3RehearsalTarget(
        preparationInput(artifact, divergent.api, "2026-09-03T12:11:00.000Z"),
      ),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "target-verification"));
    expect(divergent.controlWrites).toHaveLength(1);

    const populatedAuth = endpoint({
      projectId: "demo-bpt-jersey-restore",
      targetEntries: [...divergent.records].map(([path, data]) => ({
        path,
        exists: true as const,
        data,
      })),
      hasAuthUser: true,
    });
    await expect(
      prepareBackupV3RehearsalTarget(preparationInput(artifact, populatedAuth.api)),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "target-auth-not-empty"));
    expect(populatedAuth.controlWrites).toHaveLength(0);
  });

  it("never writes payload when post-commit I1 verification detects divergence", async () => {
    const artifact = await makeSnapshot();
    const target = endpoint({
      projectId: "demo-bpt-jersey-restore",
      afterPrepare: (records) => {
        const migrationPath = [...records.keys()].find((path) =>
          path.includes("/memberDirectoryMigrations/"),
        );
        if (migrationPath === undefined) throw new Error("missing synthetic migration plan");
        records.set(migrationPath, {
          ...records.get(migrationPath)!,
          planMac: "0".repeat(64),
        });
      },
    });

    await expect(
      restoreBackupV3RehearsalSnapshot({
        academyId,
        artifact,
        binding,
        source: endpoint({ projectId: "demo-bpt-jersey" }).api,
        target: target.api,
        sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
        targetIntegrity: { version: "target-integrity-v1", material: targetSecret },
        now: () => new Date("2026-09-03T12:10:00.000Z"),
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "target-verification"));
    expect(target.controlWrites).toHaveLength(1);
    expect(target.writes).toHaveLength(0);
  });

  it("restores create-only into an empty no-Auth target and writes metadata-only attestation", async () => {
    const artifact = await makeSnapshot();
    const source = endpoint({ projectId: "demo-bpt-jersey" });
    const target = endpoint({ projectId: "demo-bpt-jersey-restore" });

    const result = await restoreBackupV3RehearsalSnapshot({
      academyId,
      artifact,
      binding,
      source: source.api,
      target: target.api,
      sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
      targetIntegrity: { version: "target-integrity-v1", material: targetSecret },
      now: () => new Date("2026-09-03T12:10:00.000Z"),
    });

    expect(result).toMatchObject({
      restoredDocumentCount: 2,
      authorityMode: "quarantined-no-auth",
      targetAuthUserCount: 0,
    });
    expect(target.controlWrites).toHaveLength(1);
    expect(target.writes).toHaveLength(1);
    expect(target.records).toHaveLength(7);
    expect([...target.records.keys()]).toEqual(
      expect.arrayContaining([
        `academies/${academyId}/memberDirectoryStates/current`,
        `memberDirectoryRestoreGuards/${academyId}`,
        `memberDirectoryRestoreGuards/${academyId}/events/0`,
        `academies/${academyId}/memberDirectoryMigrations/${result.attestation.targetOperationId}`,
        `academies/${academyId}/students/student-1`,
        `academies/${academyId}/users/user-1`,
      ]),
    );
    expect(
      target.records.get(`academies/${academyId}/memberDirectoryStates/current`),
    ).toMatchObject({
      readerVersion: "canonical-v1",
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: "restore-prepared",
      preparedOperationId: result.attestation.targetOperationId,
    });

    expect(source.metadata).toHaveLength(1);
    const [attestationPath, attestation] = [...source.metadata][0]!;
    expect(attestationPath).toMatch(
      new RegExp("^memberDirectoryRestoreAttestations/restore-v3-[a-f0-9]{48}$", "u"),
    );
    expect(Reflect.ownKeys(attestation).sort()).toEqual(
      [
        "academyId",
        "artifactDispositionVersion",
        "attestationId",
        "attestedReadTime",
        "attestedTargetInventoryMac",
        "authorityMode",
        "backupDocumentCount",
        "backupRootMac",
        "createdAt",
        "createdBy",
        "firestoreValueCodecVersion",
        "inventoryVersion",
        "payloadDecodedBytes",
        "payloadDocumentCount",
        "payloadRootMac",
        "schemaVersion",
        "snapshotReadTime",
        "sourceAttestationMac",
        "sourceIntegritySecretVersion",
        "sourceProjectId",
        "sourceStateEvidenceMac",
        "targetAuthUserCount",
        "targetDocumentCount",
        "targetIntegritySecretVersion",
        "targetOperationId",
        "targetProjectId",
      ].sort(),
    );
    const serialized = JSON.stringify(attestation);
    expect(serialized).not.toContain("Synthetic Student");
    expect(serialized).not.toContain("student-1");
    expect(serialized).not.toContain("user-1");
    expect(serialized).not.toContain(sourceSecret);
    expect(serialized).not.toContain(targetSecret);
  });

  it("rejects Auth, a nonempty target or the wrong project pair before any write", async () => {
    const artifact = await makeSnapshot();
    for (const [target, code] of [
      [
        endpoint({ projectId: "demo-bpt-jersey-restore", hasAuthUser: true }),
        "target-auth-not-empty",
      ],
      [
        endpoint({
          projectId: "demo-bpt-jersey-restore",
          targetEntries: [{ path: "unexpected/doc-1", exists: true, data: { value: 1 } }],
        }),
        "target-not-empty",
      ],
    ] as const) {
      await expect(
        restoreBackupV3RehearsalSnapshot({
          academyId,
          artifact,
          binding,
          source: endpoint({ projectId: "demo-bpt-jersey" }).api,
          target: target.api,
          sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
          targetIntegrity: { version: "target-integrity-v1", material: targetSecret },
        }),
      ).rejects.toSatisfy((error: unknown) => expectCode(error, code));
      expect(target.writes).toHaveLength(0);
    }

    const wrongTarget = endpoint({ projectId: "demo-bpt-jersey" });
    await expect(
      restoreBackupV3RehearsalSnapshot({
        academyId,
        artifact,
        binding,
        source: endpoint({ projectId: "demo-bpt-jersey" }).api,
        target: wrongTarget.api,
        sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
        targetIntegrity: { version: "target-integrity-v1", material: targetSecret },
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "unsafe-environment"));
    expect(wrongTarget.writes).toHaveLength(0);
  });

  it("validates the target integrity secret and purpose separation before payload writes", async () => {
    const artifact = await makeSnapshot();
    for (const material of ["short", sourceSecret]) {
      const target = endpoint({ projectId: "demo-bpt-jersey-restore" });
      await expect(
        restoreBackupV3RehearsalSnapshot({
          academyId,
          artifact,
          binding,
          source: endpoint({ projectId: "demo-bpt-jersey" }).api,
          target: target.api,
          sourceIntegrity: { version: "source-integrity-v1", material: sourceSecret },
          targetIntegrity: { version: "target-integrity-v1", material },
        }),
      ).rejects.toSatisfy((error: unknown) => expectCode(error, "unsafe-environment"));
      expect(target.writes).toHaveLength(0);
      expect(target.authReads).toBe(0);
      expect(target.namespaceReads).toBe(0);
    }
  });

  it("rejects an invalid source integrity secret before source inventory I/O", async () => {
    const source = endpoint({ projectId: "demo-bpt-jersey" });
    await expect(
      createBackupV3RehearsalSnapshot({
        academyId,
        binding,
        source: source.api,
        sourceIntegrity: { version: "source-integrity-v1", material: "short" },
        targetIntegrityVersion: "target-integrity-v1",
      }),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "unsafe-environment"));
    expect(source.sourceReads).toBe(0);
  });
});
