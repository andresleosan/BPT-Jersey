export const BACKUP_SCHEMA_VERSION = 1 as const;

export const TENANT_BACKUP_COLLECTIONS = [
  "users",
  "families",
  "students",
  "staff",
  "relationships",
  "locations",
  "programs",
  "classes",
  "sessions",
  "plans",
  "bookings",
  "attendance",
  "checkouts",
  "memberships",
  "invoices",
  "payments",
  "paymentEvents",
  "assessments",
  "skillProgress",
  "recognitions",
  "leads",
  "messages",
  "deliveryEvents",
  "healthProfiles",
  "safeguardingCases",
  "consents",
  "documents",
  "auditEvents",
  "exports",
  "regyfitAccessRecords",
  "levelSystems",
  "levelDefinitions",
  "levelRequirements",
] as const;

export type TenantBackupCollection = (typeof TENANT_BACKUP_COLLECTIONS)[number];
export type BackupDocumentData = Readonly<Record<string, unknown>>;

export type TenantBackupDocument = Readonly<{
  collection: TenantBackupCollection;
  documentId: string;
  data: BackupDocumentData;
}>;

export type TenantBackupDocumentCounts = Readonly<Partial<Record<TenantBackupCollection, number>>>;

export type BackupOperationStatus = "created" | "verified" | "failed" | "expired";

export type TenantBackupManifest = Readonly<{
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  operationId: string;
  academyId: string;
  createdAt: string;
  expiresAt: string;
  artifactPath: string;
  rollbackManifestPath: string;
  documentCounts: TenantBackupDocumentCounts;
  totalDocumentCount: number;
  checksum: string;
  status: BackupOperationStatus;
  verifiedAt?: string;
}>;

export type TenantBackupResult = Readonly<{
  operationId: string;
  manifestPath: string;
  expiresAt: string;
}>;

export type TenantBackupVerification = Readonly<{
  operationId: string;
  documentCounts: TenantBackupDocumentCounts;
  checksum: string;
  verified: boolean;
}>;

export type TenantRestorePreparation = Readonly<{
  restoreId: string;
  rollbackManifestPath: string;
}>;

export type TenantBackupSource = Readonly<{
  listTenantDocuments: (academyId: string) => Promise<readonly TenantBackupDocument[]>;
}>;

export type BackupArtifactStore = Readonly<{
  put: (path: string, body: Uint8Array, contentType: string) => Promise<void>;
  get: (path: string) => Promise<Uint8Array>;
  delete: (path: string) => Promise<void>;
}>;

export type TenantBackupService = Readonly<{
  createTenantBackup: (academyId: string) => Promise<TenantBackupResult>;
  verifyTenantBackup: (operationId: string) => Promise<TenantBackupVerification>;
  prepareTenantRestore: (
    operationId: string,
    confirmationToken: string,
  ) => Promise<TenantRestorePreparation>;
}>;

export function isTenantBackupCollection(value: unknown): value is TenantBackupCollection {
  return (
    typeof value === "string" && (TENANT_BACKUP_COLLECTIONS as readonly string[]).includes(value)
  );
}
