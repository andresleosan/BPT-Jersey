import { describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { TenantBackupService } from "./backup-contracts.js";
import {
  createTenantBackupHandler,
  prepareTenantRestoreHandler,
  verifyTenantBackupHandler,
} from "./backup-callables.js";

function request(data: unknown, role = "owner", uid: string | null = "staff-1") {
  return {
    data,
    auth: uid ? { uid, token: { academyId: "academy-1", role } } : undefined,
  } as unknown as CallableRequest<unknown>;
}

function createService(): TenantBackupService {
  return {
    createTenantBackup: async (academyId) => ({
      operationId: `op-${academyId}-123456`,
      manifestPath: "backups/operations/op-academy-1-123456/manifest.json",
      expiresAt: "2026-08-30T12:00:00.000Z",
    }),
    verifyTenantBackup: async (operationId) => ({
      operationId,
      documentCounts: { students: 1 },
      checksum: "a".repeat(64),
      verified: true,
    }),
    prepareTenantRestore: async (operationId, token) => ({
      restoreId: `restore-${operationId}-${token.length}`,
      rollbackManifestPath: "backups/academies/academy-1/op-1234567890/rollback-manifest.json",
    }),
  };
}

describe("tenant backup callable boundaries", () => {
  it("scopes creation to the authenticated owner tenant and rejects other roles/payloads", async () => {
    const calls: string[] = [];
    const service = createService();
    const handler = createTenantBackupHandler({
      service: {
        ...service,
        createTenantBackup: async (academyId) => {
          calls.push(academyId);
          return service.createTenantBackup(academyId);
        },
      },
    });
    await expect(handler(request(null, "owner"))).resolves.toMatchObject({
      operationId: "op-academy-1-123456",
    });
    expect(calls).toEqual(["academy-1"]);
    await expect(handler(request(null, "coach"))).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(handler(request({}, "owner"))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(handler(request(null, "owner", null))).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("requires strict operation payloads and operator confirmation for verification/restore preparation", async () => {
    const service = createService();
    const verify = verifyTenantBackupHandler({ service });
    const prepare = prepareTenantRestoreHandler({ service });
    await expect(
      verify(request({ operationId: "op-1234567890" }, "administrator")),
    ).resolves.toEqual({
      operationId: "op-1234567890",
      documentCounts: { students: 1 },
      checksum: "a".repeat(64),
      verified: true,
    });
    await expect(
      verify(request({ operationId: "op-1234567890", extra: true })),
    ).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(
      prepare(
        request({ operationId: "op-1234567890", confirmationToken: "RESTORE:op-1234567890" }),
      ),
    ).resolves.toMatchObject({
      rollbackManifestPath: expect.stringContaining("rollback-manifest.json"),
    });
    await expect(prepare(request({ operationId: "op-1234567890" }))).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });
});
