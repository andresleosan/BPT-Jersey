import type { TenantBackupDocument } from "./backup-contracts.js";
import { validateTenantBackupDocuments } from "./backup-service.js";

export type RehearsalTenantStore = Readonly<{
  readTenantDocuments: (academyId: string) => Promise<readonly TenantBackupDocument[]>;
  replaceTenantDocuments: (
    academyId: string,
    documents: readonly TenantBackupDocument[],
  ) => Promise<void>;
}>;

export type RestoreRehearsalResult = Readonly<{
  status: "restored" | "rolled-back";
  restoredDocumentCount: number;
  rollbackDocumentCount: number;
}>;

export async function runTenantRestoreRehearsal(options: {
  academyId: string;
  backupDocuments: readonly TenantBackupDocument[];
  target: RehearsalTenantStore;
  failAfterApply?: boolean;
}): Promise<RestoreRehearsalResult> {
  const backupDocuments = validateTenantBackupDocuments(options.academyId, options.backupDocuments);
  const previousDocuments = await options.target.readTenantDocuments(options.academyId);
  try {
    await options.target.replaceTenantDocuments(options.academyId, backupDocuments);
    if (options.failAfterApply) throw new Error("synthetic restore failure");
    return {
      status: "restored",
      restoredDocumentCount: backupDocuments.length,
      rollbackDocumentCount: previousDocuments.length,
    };
  } catch (error) {
    await options.target.replaceTenantDocuments(options.academyId, previousDocuments);
    if (error instanceof Error && error.message === "synthetic restore failure") {
      return {
        status: "rolled-back",
        restoredDocumentCount: backupDocuments.length,
        rollbackDocumentCount: previousDocuments.length,
      };
    }
    throw error;
  }
}
