import { describe, expect, it } from "vitest";

import type {
  BackupArtifactStore,
  TenantBackupDocument,
  TenantBackupSource,
} from "./backup-contracts.js";
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
  it("creates a tenant-scoped manifest and verifies its deterministic checksum", async () => {
    const { records, store } = createMemoryArtifacts();
    const service = createTenantBackupService({
      source: createSource(documents),
      artifacts: store,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      operationId: () => "op-1234567890",
    });

    const created = await service.createTenantBackup("academy-1");
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
  });

  it("requires a verified backup and an exact operator confirmation token", async () => {
    const { store } = createMemoryArtifacts();
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
