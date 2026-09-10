import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { requireUserActor } from "../auth/user-authorization.js";
import { BackupOperationError, createUnavailableTenantBackupService } from "./backup-service.js";
import type { TenantBackupService } from "./backup-contracts.js";

const backupRoles = ["owner", "administrator"] as const;
type BackupRole = (typeof backupRoles)[number];

function requireBackupRole(request: CallableRequest<unknown>): void {
  const actor = requireUserActor(request);
  if (!backupRoles.includes(actor.role as BackupRole)) {
    throw new HttpsError("permission-denied", "Owner or administrator role required");
  }
}

function requireNullPayload(data: unknown): void {
  if (data !== null && data !== undefined) {
    throw new HttpsError("invalid-argument", "This backup operation does not accept a payload");
  }
}

function requireOperationPayload(
  data: unknown,
  kind: "verify" | "restore",
): { operationId: string; confirmationToken?: string } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", `Invalid ${kind} backup payload`);
  }
  const record = data as Record<string, unknown>;
  const requiredKeys = kind === "restore" ? ["operationId", "confirmationToken"] : ["operationId"];
  if (
    Object.keys(record).some((key) => !requiredKeys.includes(key)) ||
    requiredKeys.some((key) => typeof record[key] !== "string" || record[key] === "")
  ) {
    throw new HttpsError("invalid-argument", `Invalid ${kind} backup payload`);
  }
  return {
    operationId: record.operationId as string,
    ...(kind === "restore" ? { confirmationToken: record.confirmationToken as string } : {}),
  };
}

function mapBackupError(error: unknown): never {
  if (error instanceof BackupOperationError) {
    if (error.code === "invalid") throw new HttpsError("invalid-argument", error.message);
    if (error.code === "not-found") throw new HttpsError("not-found", "Backup operation not found");
    if (error.code === "conflict") throw new HttpsError("failed-precondition", error.message);
    throw new HttpsError("failed-precondition", "Backup service is not configured");
  }
  throw new HttpsError("internal", "Backup operation failed");
}

export function createTenantBackupHandler({ service }: { service: TenantBackupService }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!backupRoles.includes(actor.role as BackupRole)) {
      throw new HttpsError("permission-denied", "Owner or administrator role required");
    }
    requireNullPayload(request.data);
    try {
      return await service.createTenantBackup(actor.academyId);
    } catch (error) {
      return mapBackupError(error);
    }
  };
}

export function verifyTenantBackupHandler({ service }: { service: TenantBackupService }) {
  return async (request: CallableRequest<unknown>) => {
    requireBackupRole(request);
    const payload = requireOperationPayload(request.data, "verify");
    try {
      return await service.verifyTenantBackup(payload.operationId);
    } catch (error) {
      return mapBackupError(error);
    }
  };
}

export function prepareTenantRestoreHandler({ service }: { service: TenantBackupService }) {
  return async (request: CallableRequest<unknown>) => {
    requireBackupRole(request);
    const payload = requireOperationPayload(request.data, "restore");
    try {
      return await service.prepareTenantRestore(payload.operationId, payload.confirmationToken!);
    } catch (error) {
      return mapBackupError(error);
    }
  };
}

let defaultService: TenantBackupService | undefined;
function getDefaultService(): TenantBackupService {
  defaultService ??= createUnavailableTenantBackupService();
  return defaultService;
}

export const createTenantBackup = onCall(
  { enforceAppCheck: true, consumeAppCheckToken: true },
  async (request) => createTenantBackupHandler({ service: getDefaultService() })(request),
);

export const verifyTenantBackup = onCall(
  { enforceAppCheck: true, consumeAppCheckToken: true },
  async (request) => verifyTenantBackupHandler({ service: getDefaultService() })(request),
);

export const prepareTenantRestore = onCall(
  { enforceAppCheck: true, consumeAppCheckToken: true },
  async (request) => prepareTenantRestoreHandler({ service: getDefaultService() })(request),
);
