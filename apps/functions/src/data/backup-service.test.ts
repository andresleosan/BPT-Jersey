import { describe, expect, it } from "vitest";

import { buildWaitlistIdV2 } from "@bpt-jersey/domain/schedule/advanced-booking";

import type {
  BackupArtifactStore,
  TenantBackupDocument,
  TenantBackupSource,
} from "./backup-contracts.js";
import { BACKUP_SCHEMA_VERSION, TENANT_BACKUP_COLLECTIONS } from "./backup-contracts.js";
import {
  BackupOperationError,
  createTenantBackupService,
  getTenantBackupArtifactPath,
  getTenantBackupManifestPath,
} from "./backup-service.js";
import { runTenantRestoreRehearsal } from "./backup-rehearsal.js";

function createMemoryArtifacts() {
  const records = new Map<string, Uint8Array>();
  const store: BackupArtifactStore = {
    put: async (path, body) => {
      records.set(path, body);
    },
    get: async (path) => {
      const body = records.get(path);
      if (!body) throw new Error("artifact not found");
      return body;
    },
    delete: async (path) => {
      records.delete(path);
    },
  };
  return { records, store };
}

function createSource(documents: readonly TenantBackupDocument[]): TenantBackupSource {
  return { listTenantDocuments: async () => documents };
}

const documents: readonly TenantBackupDocument[] = [
  { collection: "students", documentId: "student-1", data: { academyId: "academy-1" } },
  {
    collection: "attendance",
    documentId: "session-1__student-1",
    data: { academyId: "academy-1" },
  },
];

describe("tenant backup service", () => {
  it("versions and allowlists the complete T060 waitlist recovery boundary", () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(2);
    expect(TENANT_BACKUP_COLLECTIONS).toEqual(
      expect.arrayContaining([
        "waitlistEntries",
        "sessionCapacityStates",
        "bookingQuotaStates",
        "waitlistPositionStates",
      ]),
    );
  });

  it("creates a tenant-scoped manifest and verifies its deterministic checksum", async () => {
    const { records, store } = createMemoryArtifacts();
    const service = createTenantBackupService({
      source: createSource(documents),
      artifacts: store,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      operationId: () => "op-1234567890",
    });

    const created = await service.createTenantBackup("academy-1");
    const manifest = JSON.parse(
      new TextDecoder().decode(records.get(getTenantBackupManifestPath(created.operationId))!),
    ) as { schemaVersion?: unknown };
    const artifact = JSON.parse(
      new TextDecoder().decode(
        records.get(getTenantBackupArtifactPath("academy-1", created.operationId))!,
      ),
    ) as { schemaVersion?: unknown };
    expect(manifest.schemaVersion).toBe(2);
    expect(artifact.schemaVersion).toBe(2);
    expect(created).toEqual({
      operationId: "op-1234567890",
      manifestPath: "backups/operations/op-1234567890/manifest.json",
      expiresAt: "2026-08-30T12:00:00.000Z",
    });

    const verified = await service.verifyTenantBackup(created.operationId);
    expect(verified.verified).toBe(true);
    expect(verified.documentCounts).toEqual({ attendance: 1, students: 1 });
    expect(verified.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(records.has(getTenantBackupManifestPath(created.operationId))).toBe(true);
    expect(records.has(getTenantBackupArtifactPath("academy-1", created.operationId))).toBe(true);
  });

  it("round-trips long canonical coordination IDs within the Firestore limit", async () => {
    const sessionId = "s".repeat(128);
    const studentId = "t".repeat(128);
    const waitlistId = buildWaitlistIdV2(sessionId, studentId);
    const quotaId = `v2:${studentId.length}:${studentId}:10:2099-09-01`;
    expect(waitlistId.length).toBeGreaterThan(128);
    expect(quotaId.length).toBeGreaterThan(128);
    const { store } = createMemoryArtifacts();
    const service = createTenantBackupService({
      source: createSource([
        {
          collection: "waitlistEntries",
          documentId: waitlistId,
          data: { academyId: "academy-1", sessionId, position: 1 },
        },
        {
          collection: "waitlistPositionStates",
          documentId: sessionId,
          data: { academyId: "academy-1", sessionId, lastPosition: 1 },
        },
        {
          collection: "bookingQuotaStates",
          documentId: quotaId,
          data: { academyId: "academy-1", quotaId },
        },
      ]),
      artifacts: store,
      operationId: () => "op-1234567894",
    });

    await service.createTenantBackup("academy-1");
    await expect(service.verifyTenantBackup("op-1234567894")).resolves.toMatchObject({
      verified: true,
      documentCounts: {
        bookingQuotaStates: 1,
        waitlistEntries: 1,
        waitlistPositionStates: 1,
      },
    });
  });

  it("rejects an unsafe waitlist position snapshot before backup or rehearsal", async () => {
    const unsafeDocuments: readonly TenantBackupDocument[] = [
      {
        collection: "waitlistEntries",
        documentId: "v2:9:session-1:9:student-1",
        data: { academyId: "academy-1", sessionId: "session-1", position: 2 },
      },
      {
        collection: "waitlistPositionStates",
        documentId: "session-1",
        data: { academyId: "academy-1", sessionId: "session-1", lastPosition: 1 },
      },
    ];
    const { store } = createMemoryArtifacts();
    await expect(
      createTenantBackupService({
        source: createSource(unsafeDocuments),
        artifacts: store,
      }).createTenantBackup("academy-1"),
    ).rejects.toThrow("position state is behind");

    let applied = false;
    await expect(
      runTenantRestoreRehearsal({
        academyId: "academy-1",
        backupDocuments: unsafeDocuments,
        target: {
          readTenantDocuments: async () => documents,
          replaceTenantDocuments: async () => {
            applied = true;
          },
        },
      }),
    ).rejects.toThrow("position state is behind");
    expect(applied).toBe(false);
  });

  it("fails closed on tampered artifacts, tenant crossings, duplicates, and secret fields", async () => {
    const { records, store } = createMemoryArtifacts();
    const service = createTenantBackupService({
      source: createSource(documents),
      artifacts: store,
      operationId: () => "op-1234567891",
    });
    const created = await service.createTenantBackup("academy-1");
    const artifactPath = getTenantBackupArtifactPath("academy-1", created.operationId);
    const artifact = JSON.parse(new TextDecoder().decode(records.get(artifactPath)!)) as {
      documents: TenantBackupDocument[];
    };
    const firstDocument = artifact.documents[0];
    if (!firstDocument) throw new Error("Synthetic artifact is empty");
    artifact.documents[0] = {
      ...firstDocument,
      data: { academyId: "academy-1", label: "changed" },
    };
    records.set(artifactPath, new TextEncoder().encode(JSON.stringify(artifact)));
    await expect(service.verifyTenantBackup(created.operationId)).resolves.toMatchObject({
      verified: false,
    });

    await expect(
      createTenantBackupService({
        source: createSource([
          { collection: "students", documentId: "student-1", data: { academyId: "academy-2" } },
        ]),
        artifacts: store,
      }).createTenantBackup("academy-1"),
    ).rejects.toThrow("crosses tenant scope");

    await expect(
      createTenantBackupService({
        source: createSource([
          ...documents,
          { collection: "students", documentId: "student-1", data: { academyId: "academy-1" } },
        ]),
        artifacts: store,
      }).createTenantBackup("academy-1"),
    ).rejects.toBeInstanceOf(BackupOperationError);

    await expect(
      createTenantBackupService({
        source: createSource([
          {
            collection: "students",
            documentId: "student-2",
            data: { academyId: "academy-1", accessToken: "never" },
          },
        ]),
        artifacts: store,
      }).createTenantBackup("academy-1"),
    ).rejects.toThrow("prohibited secret field");

    await expect(
      createTenantBackupService({
        source: createSource([
          {
            collection: "students",
            documentId: "x".repeat(1501),
            data: { academyId: "academy-1" },
          },
        ]),
        artifacts: store,
      }).createTenantBackup("academy-1"),
    ).rejects.toThrow("invalid document ID");
  });

  it("requires a verified backup and an exact operator confirmation token", async () => {
    const { records, store } = createMemoryArtifacts();
    const service = createTenantBackupService({
      source: createSource(documents),
      artifacts: store,
      operationId: () => "op-1234567892",
    });
    await service.createTenantBackup("academy-1");
    await expect(service.prepareTenantRestore("op-1234567892", "RESTORE:wrong")).rejects.toThrow(
      "verified backup",
    );
    await service.verifyTenantBackup("op-1234567892");
    await expect(service.prepareTenantRestore("op-1234567892", "RESTORE:wrong")).rejects.toThrow(
      "confirmation token",
    );
    await expect(
      service.prepareTenantRestore("op-1234567892", "RESTORE:op-1234567892"),
    ).resolves.toEqual({
      restoreId: expect.stringMatching(/^restore-[a-f0-9]{24}$/u),
      rollbackManifestPath: "backups/academies/academy-1/op-1234567892/rollback-manifest.json",
    });

    const artifactPath = getTenantBackupArtifactPath("academy-1", "op-1234567892");
    const artifact = JSON.parse(new TextDecoder().decode(records.get(artifactPath)!)) as {
      documents: TenantBackupDocument[];
    };
    artifact.documents.push({
      collection: "students",
      documentId: "student-after-verification",
      data: { academyId: "academy-1" },
    });
    records.set(artifactPath, new TextEncoder().encode(JSON.stringify(artifact)));
    await expect(
      service.prepareTenantRestore("op-1234567892", "RESTORE:op-1234567892"),
    ).rejects.toThrow("changed after verification");
  });

  it("rehearses apply and restores the previous isolated state after a synthetic failure", async () => {
    let current = [...documents];
    const target = {
      readTenantDocuments: async () => current,
      replaceTenantDocuments: async (_academyId: string, next: readonly TenantBackupDocument[]) => {
        current = [...next];
      },
    };
    const result = await runTenantRestoreRehearsal({
      academyId: "academy-1",
      backupDocuments: [
        { collection: "students", documentId: "student-new", data: { academyId: "academy-1" } },
      ],
      target,
      failAfterApply: true,
    });
    expect(result).toEqual({
      status: "rolled-back",
      restoredDocumentCount: 1,
      rollbackDocumentCount: 2,
    });
    expect(current).toEqual(documents);
  });
});
