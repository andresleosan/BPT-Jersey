import { createHash, randomUUID } from "node:crypto";

import {
  BACKUP_SCHEMA_VERSION,
  isTenantBackupCollection,
  type BackupArtifactStore,
  type BackupDocumentData,
  type TenantBackupDocument,
  type TenantBackupDocumentCounts,
  type TenantBackupManifest,
  type TenantBackupService,
  type TenantBackupSource,
  type TenantBackupVerification,
  type TenantRestorePreparation,
} from "./backup-contracts.js";

export const DEFAULT_BACKUP_RETENTION_DAYS = 7;
export const BACKUP_JSON_CONTENT_TYPE = "application/json";

const academyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
// Firestore caps a document ID at 1,500 UTF-8 bytes. This allowlist is ASCII-only,
// so the character count is also the byte count.
const documentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,1499}$/u;
const operationIdPattern = /^op-[A-Za-z0-9-]{10,80}$/u;
const sensitiveKeyPattern =
  /(?:password|secret|credential|privatekey|accesstoken|refreshtoken|apikey|cardnumber|cvv|cvc)/iu;

export class BackupOperationError extends Error {
  public readonly code: "invalid" | "not-found" | "conflict" | "unavailable";

  public constructor(code: "invalid" | "not-found" | "conflict" | "unavailable", message: string) {
    super(message);
    this.name = "BackupOperationError";
    this.code = code;
  }
}

type TenantBackupArtifact = Readonly<{
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  operationId: string;
  academyId: string;
  documents: readonly TenantBackupDocument[];
}>;

type BackupServiceOptions = Readonly<{
  source: TenantBackupSource;
  artifacts: BackupArtifactStore;
  now?: () => Date;
  operationId?: () => string;
}>;

function assertAcademyId(academyId: string): void {
  if (!academyIdPattern.test(academyId)) {
    throw new BackupOperationError("invalid", "Invalid academy scope");
  }
}

function assertOperationId(operationId: string): void {
  if (!operationIdPattern.test(operationId)) {
    throw new BackupOperationError("invalid", "Invalid backup operation");
  }
}

function assertSafeData(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) {
    throw new BackupOperationError("invalid", "Backup data contains a cyclic value");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertSafeData(item, seen);
  } else {
    for (const [key, nested] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(key)) {
        throw new BackupOperationError("invalid", "Backup data contains a prohibited secret field");
      }
      assertSafeData(nested, seen);
    }
  }
  seen.delete(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function checksum(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function parseJson<T>(bytes: Uint8Array, message: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new BackupOperationError("invalid", message);
  }
}

function operationIdFromFactory(factory: (() => string) | undefined): string {
  const operationId = factory?.() ?? `op-${randomUUID()}`;
  assertOperationId(operationId);
  return operationId;
}

function manifestPath(operationId: string): string {
  return `backups/operations/${operationId}/manifest.json`;
}

function artifactPath(academyId: string, operationId: string): string {
  return `backups/academies/${academyId}/${operationId}/tenant-backup.json`;
}

function rollbackPath(academyId: string, operationId: string): string {
  return `backups/academies/${academyId}/${operationId}/rollback-manifest.json`;
}

function countDocuments(documents: readonly TenantBackupDocument[]): TenantBackupDocumentCounts {
  const counts: Record<string, number> = {};
  for (const document of documents) {
    counts[document.collection] = (counts[document.collection] ?? 0) + 1;
  }
  return counts;
}

function assertWaitlistPositionInvariant(
  academyId: string,
  documents: readonly TenantBackupDocument[],
): void {
  const maximumPositions = new Map<string, number>();
  const positionStates = new Map<string, number>();

  for (const document of documents) {
    if (document.collection === "waitlistEntries") {
      const sessionId = document.data["sessionId"];
      const position = document.data["position"];
      if (
        document.data["academyId"] !== academyId ||
        typeof sessionId !== "string" ||
        !academyIdPattern.test(sessionId) ||
        !Number.isSafeInteger(position) ||
        (position as number) < 1 ||
        (position as number) > 10_000
      ) {
        throw new BackupOperationError("invalid", "Backup waitlist entry is invalid");
      }
      maximumPositions.set(
        sessionId,
        Math.max(maximumPositions.get(sessionId) ?? 0, position as number),
      );
    }

    if (document.collection === "waitlistPositionStates") {
      const sessionId = document.data["sessionId"];
      const lastPosition = document.data["lastPosition"];
      if (
        document.data["academyId"] !== academyId ||
        typeof sessionId !== "string" ||
        !academyIdPattern.test(sessionId) ||
        document.documentId !== sessionId ||
        !Number.isSafeInteger(lastPosition) ||
        (lastPosition as number) < 0 ||
        (lastPosition as number) > 10_000 ||
        positionStates.has(sessionId)
      ) {
        throw new BackupOperationError("invalid", "Backup waitlist position state is invalid");
      }
      positionStates.set(sessionId, lastPosition as number);
    }
  }

  for (const [sessionId, maximumPosition] of maximumPositions) {
    if ((positionStates.get(sessionId) ?? -1) < maximumPosition) {
      throw new BackupOperationError(
        "invalid",
        "Backup waitlist position state is behind its historical queue",
      );
    }
  }
}

export function validateTenantBackupDocuments(
  academyId: string,
  documents: readonly TenantBackupDocument[],
): readonly TenantBackupDocument[] {
  assertAcademyId(academyId);
  if (!Array.isArray(documents)) {
    throw new BackupOperationError("invalid", "Backup documents are invalid");
  }
  const seen = new Set<string>();
  for (const document of documents) {
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      throw new BackupOperationError("invalid", "Backup contains an invalid document");
    }
    if (!isTenantBackupCollection(document.collection)) {
      throw new BackupOperationError("invalid", "Backup contains an unsupported collection");
    }
    if (!documentIdPattern.test(document.documentId)) {
      throw new BackupOperationError("invalid", "Backup contains an invalid document ID");
    }
    const identity = `${document.collection}/${document.documentId}`;
    if (seen.has(identity)) {
      throw new BackupOperationError("conflict", "Backup contains a duplicate document");
    }
    seen.add(identity);
    if (document.data["academyId"] !== undefined && document.data["academyId"] !== academyId) {
      throw new BackupOperationError("invalid", "Backup document crosses tenant scope");
    }
    assertSafeData(document.data);
  }
  assertWaitlistPositionInvariant(academyId, documents);
  return [...documents].sort((left, right) =>
    `${left.collection}/${left.documentId}`.localeCompare(
      `${right.collection}/${right.documentId}`,
    ),
  );
}

async function inspectBackupArtifact(
  artifacts: BackupArtifactStore,
  manifest: TenantBackupManifest,
): Promise<{ actualChecksum: string; valid: boolean }> {
  const artifact = parseJson<TenantBackupArtifact>(
    await artifacts.get(manifest.artifactPath),
    "Backup artifact is invalid",
  );
  const documents = validateTenantBackupDocuments(manifest.academyId, artifact.documents);
  const actualChecksum = checksum({ ...artifact, documents });
  return {
    actualChecksum,
    valid:
      artifact.schemaVersion === BACKUP_SCHEMA_VERSION &&
      artifact.operationId === manifest.operationId &&
      artifact.academyId === manifest.academyId &&
      actualChecksum === manifest.checksum &&
      documents.length === manifest.totalDocumentCount &&
      stableJson(countDocuments(documents)) === stableJson(manifest.documentCounts),
  };
}

async function writeJson(
  artifacts: BackupArtifactStore,
  path: string,
  value: unknown,
): Promise<void> {
  await artifacts.put(path, new TextEncoder().encode(stableJson(value)), BACKUP_JSON_CONTENT_TYPE);
}

async function readManifest(
  artifacts: BackupArtifactStore,
  operationId: string,
): Promise<TenantBackupManifest> {
  assertOperationId(operationId);
  const manifest = parseJson<TenantBackupManifest>(
    await artifacts.get(manifestPath(operationId)),
    "Backup manifest is invalid",
  );
  if (
    manifest.schemaVersion !== BACKUP_SCHEMA_VERSION ||
    manifest.operationId !== operationId ||
    !academyIdPattern.test(manifest.academyId)
  ) {
    throw new BackupOperationError("invalid", "Backup manifest is invalid");
  }
  return manifest;
}

export function createTenantBackupService(options: BackupServiceOptions): TenantBackupService {
  const now = options.now ?? (() => new Date());
  return {
    async createTenantBackup(academyId) {
      assertAcademyId(academyId);
      const operationId = operationIdFromFactory(options.operationId);
      const createdAt = now().toISOString();
      const expiresAt = new Date(
        now().getTime() + DEFAULT_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const documents = validateTenantBackupDocuments(
        academyId,
        await options.source.listTenantDocuments(academyId),
      );
      const artifact: TenantBackupArtifact = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        operationId,
        academyId,
        documents,
      };
      const manifest: TenantBackupManifest = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        operationId,
        academyId,
        createdAt,
        expiresAt,
        artifactPath: artifactPath(academyId, operationId),
        rollbackManifestPath: rollbackPath(academyId, operationId),
        documentCounts: countDocuments(documents),
        totalDocumentCount: documents.length,
        checksum: checksum(artifact),
        status: "created",
      };
      await writeJson(options.artifacts, manifest.artifactPath, artifact);
      await writeJson(options.artifacts, manifestPath(operationId), manifest);
      return { operationId, manifestPath: manifestPath(operationId), expiresAt };
    },

    async verifyTenantBackup(operationId): Promise<TenantBackupVerification> {
      const manifest = await readManifest(options.artifacts, operationId);
      if (new Date(manifest.expiresAt).getTime() <= now().getTime()) {
        await writeJson(options.artifacts, manifestPath(operationId), {
          ...manifest,
          status: "expired",
        });
        return {
          operationId,
          documentCounts: manifest.documentCounts,
          checksum: manifest.checksum,
          verified: false,
        };
      }
      const { actualChecksum, valid: verified } = await inspectBackupArtifact(
        options.artifacts,
        manifest,
      );
      await writeJson(options.artifacts, manifestPath(operationId), {
        ...manifest,
        status: verified ? "verified" : "failed",
        ...(verified ? { verifiedAt: now().toISOString() } : {}),
      });
      return {
        operationId,
        documentCounts: manifest.documentCounts,
        checksum: actualChecksum,
        verified,
      };
    },

    async prepareTenantRestore(operationId, confirmationToken): Promise<TenantRestorePreparation> {
      const manifest = await readManifest(options.artifacts, operationId);
      if (manifest.status !== "verified") {
        throw new BackupOperationError("conflict", "A verified backup is required before restore");
      }
      if (confirmationToken !== `RESTORE:${operationId}`) {
        throw new BackupOperationError("invalid", "Restore confirmation token is invalid");
      }
      if (new Date(manifest.expiresAt).getTime() <= now().getTime()) {
        await writeJson(options.artifacts, manifestPath(operationId), {
          ...manifest,
          status: "expired",
        });
        throw new BackupOperationError("conflict", "Verified backup has expired");
      }
      const inspection = await inspectBackupArtifact(options.artifacts, manifest);
      if (!inspection.valid) {
        await writeJson(options.artifacts, manifestPath(operationId), {
          ...manifest,
          status: "failed",
        });
        throw new BackupOperationError("conflict", "Backup changed after verification");
      }
      const restoreId = `restore-${checksum({ operationId, checksum: manifest.checksum }).slice(0, 24)}`;
      return { restoreId, rollbackManifestPath: manifest.rollbackManifestPath };
    },
  };
}

export function createUnavailableTenantBackupService(): TenantBackupService {
  const unavailable = async (): Promise<never> => {
    throw new BackupOperationError(
      "unavailable",
      "Tenant backup service is not configured; use the emulator rehearsal runbook",
    );
  };
  return {
    createTenantBackup: unavailable,
    verifyTenantBackup: unavailable,
    prepareTenantRestore: unavailable,
  };
}

export function getTenantBackupArtifactPath(academyId: string, operationId: string): string {
  assertAcademyId(academyId);
  assertOperationId(operationId);
  return artifactPath(academyId, operationId);
}

export function getTenantBackupManifestPath(operationId: string): string {
  assertOperationId(operationId);
  return manifestPath(operationId);
}

export function getTenantBackupRollbackPath(academyId: string, operationId: string): string {
  assertAcademyId(academyId);
  assertOperationId(operationId);
  return rollbackPath(academyId, operationId);
}

export function backupDataContainsSensitiveFields(data: BackupDocumentData): boolean {
  try {
    assertSafeData(data);
    return false;
  } catch (error) {
    if (error instanceof BackupOperationError && error.code === "invalid") return true;
    throw error;
  }
}
