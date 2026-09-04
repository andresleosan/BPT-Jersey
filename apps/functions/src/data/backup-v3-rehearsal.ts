import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import {
  memberDirectoryStateSchema,
  type MemberDirectoryState,
} from "@bpt-jersey/domain/members/directory";
import { z } from "zod";

import {
  canonicalizeMemberDirectoryValue,
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
  decodeMemberDirectorySecret,
} from "../members/member-directory-crypto.js";
import type { MemberDirectoryRestoreEnvironmentBinding } from "../members/member-directory-environment.js";
import {
  assertMemberDirectoryControlPlane,
  memberDirectoryGuardEventSchema,
  memberDirectoryRestoreGuardSchema,
} from "../members/member-directory-state.js";
import {
  BACKUP_V3_ARTIFACT_DISPOSITION_VERSION,
  BACKUP_V3_INTEGRITY_MAC_VERSION,
  BACKUP_V3_INVENTORY_VERSION,
  BACKUP_V3_LIMITS,
  BACKUP_V3_MATERIALIZABLE_PATH_CLASSES,
  BACKUP_V3_SCHEMA_VERSION,
  classifyBackupV3SourcePath,
  parseBackupV3ArtifactRow,
  validateBackupV3Plan,
  type BackupV3ArtifactDisposition,
  type BackupV3MaterializablePathClass,
} from "./backup-v3-contracts.js";
import {
  BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
  canonicalizeBackupV3FirestoreDocument,
  encodeBackupV3FirestoreDocument,
  parseBackupV3FirestoreDocument,
  type BackupV3CanonicalFirestoreDocument,
  type BackupV3CanonicalFirestoreValue,
} from "./backup-v3-firestore-value-codec.js";
import type {
  BackupV3ExactPayloadDocument,
  BackupV3ExactPayloadPlan,
} from "./backup-v3-firestore-exact-writer.js";

const sourceProjectId = "demo-bpt-jersey" as const;
const targetProjectId = "demo-bpt-jersey-restore" as const;
const authorityMode = "quarantined-no-auth" as const;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const macPattern = /^[a-f0-9]{64}$/u;

export type BackupV3RehearsalErrorCode =
  | "attestation-conflict"
  | "invalid-artifact"
  | "invalid-inventory"
  | "source-authority-evidence"
  | "target-auth-not-empty"
  | "target-not-empty"
  | "target-verification"
  | "unsafe-environment";

export class BackupV3RehearsalError extends Error {
  readonly code: BackupV3RehearsalErrorCode;

  constructor(code: BackupV3RehearsalErrorCode, message: string) {
    super(message);
    this.name = "BackupV3RehearsalError";
    this.code = code;
  }
}

export type BackupV3InventoryEntry =
  | Readonly<{ path: string; exists: false }>
  | Readonly<{
      path: string;
      exists: true;
      data: BackupV3CanonicalFirestoreDocument;
    }>;

export type BackupV3Inventory = Readonly<{
  projectId: string;
  readTime: string;
  entries: readonly BackupV3InventoryEntry[];
}>;

export type BackupV3WriteDocument = Readonly<{
  path: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type BackupV3TargetCheckpointWrite = Readonly<{
  academyId: string;
  targetOperationId: string;
  documents: readonly BackupV3WriteDocument[];
}>;

export type BackupV3PayloadWriteRequest = Omit<BackupV3ExactPayloadPlan, "client">;

export type BackupV3RehearsalEndpoint = Readonly<{
  projectId: string;
  readSourceInventory: (academyId: string) => Promise<BackupV3Inventory>;
  readNamespaceInventory: (academyId: string) => Promise<BackupV3Inventory>;
  hasAnyAuthUser: () => Promise<boolean>;
  prepareTargetCheckpoint: (
    input: BackupV3TargetCheckpointWrite,
  ) => Promise<"created" | "existing">;
  createPayloadDocuments: (request: BackupV3PayloadWriteRequest) => Promise<void>;
  putMetadataDocument: (path: string, data: Readonly<Record<string, unknown>>) => Promise<void>;
}>;

export type BackupV3RehearsalRow = Readonly<{
  sourcePath: string;
  disposition: Exclude<BackupV3ArtifactDisposition, "exclude-before-backup">;
  targetPlanSet: "payload" | null;
  targetPath: string | null;
  data: BackupV3CanonicalFirestoreDocument;
}>;

export type BackupV3RehearsalArtifact = Readonly<{
  schemaVersion: typeof BACKUP_V3_SCHEMA_VERSION;
  artifactDispositionVersion: typeof BACKUP_V3_ARTIFACT_DISPOSITION_VERSION;
  inventoryVersion: typeof BACKUP_V3_INVENTORY_VERSION;
  firestoreValueCodecVersion: typeof BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION;
  integrityMacVersion: typeof BACKUP_V3_INTEGRITY_MAC_VERSION;
  sourceProjectId: typeof sourceProjectId;
  targetProjectId: typeof targetProjectId;
  academyId: string;
  authorityMode: typeof authorityMode;
  authArtifactCount: 0;
  snapshotReadTime: string;
  sourceIntegritySecretVersion: string;
  targetIntegritySecretVersion: string;
  rows: readonly BackupV3RehearsalRow[];
  pathClassCounts: readonly Readonly<{
    pathClass: BackupV3MaterializablePathClass;
    documentCount: number;
  }>[];
  backupDocumentCount: number;
  payloadDocumentCount: number;
  excludedDocumentCount: number;
  payloadDecodedBytes: number;
  payloadRootMac: string;
  sourceStateEvidenceMac: string;
  backupRootMac: string;
}>;

type IntegritySecret = Readonly<{ version: string; material: string }>;

export type BackupV3RestoreAttestation = Readonly<{
  attestationId: string;
  schemaVersion: "1";
  sourceProjectId: typeof sourceProjectId;
  targetProjectId: typeof targetProjectId;
  academyId: string;
  targetOperationId: string;
  authorityMode: typeof authorityMode;
  artifactDispositionVersion: typeof BACKUP_V3_ARTIFACT_DISPOSITION_VERSION;
  inventoryVersion: typeof BACKUP_V3_INVENTORY_VERSION;
  firestoreValueCodecVersion: typeof BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION;
  snapshotReadTime: string;
  attestedReadTime: string;
  backupDocumentCount: number;
  payloadDocumentCount: number;
  payloadDecodedBytes: number;
  targetDocumentCount: number;
  targetAuthUserCount: 0;
  payloadRootMac: string;
  backupRootMac: string;
  sourceStateEvidenceMac: string;
  attestedTargetInventoryMac: string;
  sourceIntegritySecretVersion: string;
  targetIntegritySecretVersion: string;
  createdAt: string;
  createdBy: "backup-v3-rehearsal";
  sourceAttestationMac: string;
}>;

export type BackupV3RestoreResult = Readonly<{
  attestationId: string;
  restoredDocumentCount: number;
  authorityMode: typeof authorityMode;
  targetAuthUserCount: 0;
  attestation: BackupV3RestoreAttestation;
}>;

export type BackupV3TargetPreparationResult = Readonly<{
  checkpoint: "I1";
  targetOperationId: string;
  targetStateRevision: 0;
  targetControlDocumentCount: 5;
  auditEventId: string;
  replayed: boolean;
}>;

const inventoryEntrySchema = z.discriminatedUnion("exists", [
  z.strictObject({ path: z.string().min(1).max(6_144), exists: z.literal(false) }),
  z.strictObject({
    path: z.string().min(1).max(6_144),
    exists: z.literal(true),
    data: z.unknown(),
  }),
]);
const inventorySchema = z.strictObject({
  projectId: z.string(),
  readTime: z.string(),
  entries: z.array(inventoryEntrySchema).max(BACKUP_V3_LIMITS.maxVisitedPathCount),
});
const pathClassCountSchema = z.strictObject({
  pathClass: z.string(),
  documentCount: z.number().int().nonnegative().safe(),
});
const rehearsalRowSchema = z.strictObject({
  sourcePath: z.string().min(1).max(6_144),
  disposition: z.enum(["materialize-exact", "verify-only-authority"]),
  targetPlanSet: z.literal("payload").nullable(),
  targetPath: z.string().min(1).max(6_144).nullable(),
  data: z.unknown(),
});
const rehearsalArtifactSchema = z.strictObject({
  schemaVersion: z.literal(BACKUP_V3_SCHEMA_VERSION),
  artifactDispositionVersion: z.literal(BACKUP_V3_ARTIFACT_DISPOSITION_VERSION),
  inventoryVersion: z.literal(BACKUP_V3_INVENTORY_VERSION),
  firestoreValueCodecVersion: z.literal(BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION),
  integrityMacVersion: z.literal(BACKUP_V3_INTEGRITY_MAC_VERSION),
  sourceProjectId: z.literal(sourceProjectId),
  targetProjectId: z.literal(targetProjectId),
  academyId: z.string().regex(identifierPattern),
  authorityMode: z.literal(authorityMode),
  authArtifactCount: z.literal(0),
  snapshotReadTime: z.string(),
  sourceIntegritySecretVersion: z.string().regex(identifierPattern),
  targetIntegritySecretVersion: z.string().regex(identifierPattern),
  rows: z.array(rehearsalRowSchema).max(BACKUP_V3_LIMITS.payload.maxDocumentCount + 1),
  pathClassCounts: z
    .array(pathClassCountSchema)
    .length(BACKUP_V3_MATERIALIZABLE_PATH_CLASSES.length),
  backupDocumentCount: z.number().int().nonnegative().safe(),
  payloadDocumentCount: z
    .number()
    .int()
    .nonnegative()
    .max(BACKUP_V3_LIMITS.payload.maxDocumentCount),
  excludedDocumentCount: z.number().int().nonnegative().safe(),
  payloadDecodedBytes: z.number().int().nonnegative().max(BACKUP_V3_LIMITS.payload.maxDecodedBytes),
  payloadRootMac: z.string().regex(macPattern),
  sourceStateEvidenceMac: z.string().regex(macPattern),
  backupRootMac: z.string().regex(macPattern),
});
const attestationSchema = z.strictObject({
  attestationId: z.string().regex(/^restore-v3-[a-f0-9]{48}$/u),
  schemaVersion: z.literal("1"),
  sourceProjectId: z.literal(sourceProjectId),
  targetProjectId: z.literal(targetProjectId),
  academyId: z.string().regex(identifierPattern),
  targetOperationId: z.string().regex(/^restore-op-[a-f0-9]{24}$/u),
  authorityMode: z.literal(authorityMode),
  artifactDispositionVersion: z.literal(BACKUP_V3_ARTIFACT_DISPOSITION_VERSION),
  inventoryVersion: z.literal(BACKUP_V3_INVENTORY_VERSION),
  firestoreValueCodecVersion: z.literal(BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION),
  snapshotReadTime: z.string(),
  attestedReadTime: z.string(),
  backupDocumentCount: z.number().int().nonnegative().safe(),
  payloadDocumentCount: z.number().int().nonnegative().safe(),
  payloadDecodedBytes: z.number().int().nonnegative().safe(),
  targetDocumentCount: z.number().int().nonnegative().safe(),
  targetAuthUserCount: z.literal(0),
  payloadRootMac: z.string().regex(macPattern),
  backupRootMac: z.string().regex(macPattern),
  sourceStateEvidenceMac: z.string().regex(macPattern),
  attestedTargetInventoryMac: z.string().regex(macPattern),
  sourceIntegritySecretVersion: z.string().regex(identifierPattern),
  targetIntegritySecretVersion: z.string().regex(identifierPattern),
  createdAt: z.string(),
  createdBy: z.literal("backup-v3-rehearsal"),
  sourceAttestationMac: z.string().regex(macPattern),
});

const targetMigrationPlanSchema = z.strictObject({
  operationId: z.string().regex(/^restore-op-[a-f0-9]{24}$/u),
  operationType: z.literal("member-directory-restore-recovery"),
  status: z.literal("planned"),
  sourceProjectId: z.literal(sourceProjectId),
  targetProjectId: z.literal(targetProjectId),
  academyId: z.string().regex(identifierPattern),
  authorityMode: z.literal(authorityMode),
  artifactDispositionVersion: z.literal(BACKUP_V3_ARTIFACT_DISPOSITION_VERSION),
  inventoryVersion: z.literal(BACKUP_V3_INVENTORY_VERSION),
  firestoreValueCodecVersion: z.literal(BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION),
  integrityMacVersion: z.literal(BACKUP_V3_INTEGRITY_MAC_VERSION),
  sourceIntegritySecretVersion: z.string().regex(identifierPattern),
  targetIntegritySecretVersion: z.string().regex(identifierPattern),
  snapshotReadTime: z.string().refine(validTimestamp),
  sourceStateRevision: z.number().int().nonnegative().safe(),
  sourceGlobalLegacyReadEliminated: z.boolean(),
  sourceRollbackEligibleStudentCount: z.number().int().nonnegative().max(400).safe(),
  targetStateRevision: z.literal(0),
  payloadDocumentCount: z.number().int().nonnegative().safe(),
  payloadDecodedBytes: z.number().int().nonnegative().safe(),
  payloadRootMac: z.string().regex(macPattern),
  backupRootMac: z.string().regex(macPattern),
  sourceStateEvidenceMac: z.string().regex(macPattern),
  preparedAt: z.string().refine(validTimestamp),
  preparedBy: z.literal("backup-v3-rehearsal"),
  schemaVersion: z.literal("1"),
  planMac: z.string().regex(macPattern),
});

type BackupV3TargetMigrationPlan = Readonly<z.infer<typeof targetMigrationPlanSchema>>;

const targetPreparationAuditSchema = z.strictObject({
  auditEventId: z.string().regex(/^restore-audit-[a-f0-9]{48}$/u),
  academyId: z.string().regex(identifierPattern),
  actorId: z.literal("backup-v3-rehearsal"),
  action: z.literal("member-directory.restore.prepared"),
  targetRef: z.string().min(1).max(6_144),
  purpose: z.literal("quarantined-restore-preparation"),
  correlationId: z.string().regex(/^restore-op-[a-f0-9]{24}$/u),
  result: z.literal("prepared"),
  stateRevision: z.literal(0),
  occurredAt: z.string().refine(validTimestamp),
  schemaVersion: z.literal(1),
});

function fail(code: BackupV3RehearsalErrorCode, message: string): never {
  throw new BackupV3RehearsalError(code, message);
}

function validTimestamp(value: string): boolean {
  if (!timestampPattern.test(value)) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) fail("unsafe-environment", `Invalid ${label}`);
}

function assertPair(
  binding: MemberDirectoryRestoreEnvironmentBinding,
  source: BackupV3RehearsalEndpoint,
  target?: BackupV3RehearsalEndpoint,
): void {
  if (
    binding.target !== "emulator" ||
    binding.sourceProjectId !== sourceProjectId ||
    binding.targetProjectId !== targetProjectId ||
    binding.sourceAppName !== "member-directory-restore-source" ||
    binding.targetAppName !== "member-directory-restore-target" ||
    binding.firestoreEmulatorHost !== "127.0.0.1:8080" ||
    binding.authEmulatorHost !== "127.0.0.1:9099" ||
    source.projectId !== sourceProjectId ||
    (target !== undefined && target.projectId !== targetProjectId)
  ) {
    fail("unsafe-environment", "Backup v3 requires the exact isolated Emulator pair");
  }
}

function firestoreDatabase(projectId: string): string {
  return `projects/${projectId}/databases/(default)/documents`;
}

type FirestoreDocumentErrorCode =
  | "invalid-artifact"
  | "invalid-inventory"
  | "source-authority-evidence"
  | "target-not-empty"
  | "target-verification";

function safeFirestoreDocument(
  value: unknown,
  projectId: string,
  errorCode: FirestoreDocumentErrorCode,
): BackupV3CanonicalFirestoreDocument {
  try {
    return parseBackupV3FirestoreDocument(value, { database: firestoreDatabase(projectId) });
  } catch {
    return fail(errorCode, "Backup v3 Firestore document encoding is invalid");
  }
}

function jsonValueFromCanonical(
  value: BackupV3CanonicalFirestoreValue,
  errorCode: FirestoreDocumentErrorCode,
): unknown {
  if (value.type === "null") return null;
  if (value.type === "boolean" || value.type === "string") return value.value;
  if (value.type === "integer") {
    const integer = Number(value.value);
    if (!Number.isSafeInteger(integer) || BigInt(integer) !== BigInt(value.value)) {
      return fail(errorCode, "Backup v3 native int64 cannot enter a JSON-only control path");
    }
    return integer;
  }
  if (value.type === "array") {
    return value.values.map((item) => jsonValueFromCanonical(item, errorCode));
  }
  if (value.type === "map") {
    return Object.fromEntries(
      Object.entries(value.fields).map(([key, item]) => [
        key,
        jsonValueFromCanonical(item, errorCode),
      ]),
    );
  }
  return fail(errorCode, "Backup v3 native Firestore value requires the exact I2 writer");
}

function jsonDocumentFromCanonical(
  value: unknown,
  projectId: string,
  errorCode: FirestoreDocumentErrorCode,
): Readonly<Record<string, unknown>> {
  const document = safeFirestoreDocument(value, projectId, errorCode);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(document.fields).map(([key, item]) => [
        key,
        jsonValueFromCanonical(item, errorCode),
      ]),
    ),
  );
}

function restValueFromJson(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null) return Object.freeze({ nullValue: "NULL_VALUE" });
  if (typeof value === "boolean") return Object.freeze({ booleanValue: value });
  if (typeof value === "string") return Object.freeze({ stringValue: value });
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return Object.freeze({ integerValue: String(value) });
  }
  if (Array.isArray(value)) {
    return Object.freeze({
      arrayValue: Object.freeze({ values: Object.freeze(value.map(restValueFromJson)) }),
    });
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze({
      mapValue: Object.freeze({
        fields: Object.freeze(
          Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, restValueFromJson(item)]),
          ),
        ),
      }),
    });
  }
  return fail("target-verification", "Backup v3 control document is not canonical JSON data");
}

function firestoreDocumentFromJson(
  value: Readonly<Record<string, unknown>>,
  projectId: string,
): BackupV3CanonicalFirestoreDocument {
  let json: Readonly<Record<string, unknown>>;
  try {
    json = JSON.parse(canonicalizeMemberDirectoryValue(value)) as Record<string, unknown>;
  } catch {
    return fail("target-verification", "Backup v3 control document is not canonical JSON data");
  }
  return encodeBackupV3FirestoreDocument(
    Object.fromEntries(Object.entries(json).map(([key, item]) => [key, restValueFromJson(item)])),
    { database: firestoreDatabase(projectId) },
  );
}

function parsedInventory(
  value: unknown,
  expectedProjectId: string,
  errorCode: "invalid-inventory" | "target-not-empty" | "target-verification",
): BackupV3Inventory {
  const parsed = inventorySchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.projectId !== expectedProjectId ||
    !validTimestamp(parsed.data.readTime)
  ) {
    return fail(errorCode, "Backup v3 inventory envelope is invalid");
  }
  const seen = new Set<string>();
  const entries: BackupV3InventoryEntry[] = [];
  for (const entry of parsed.data.entries) {
    if (seen.has(entry.path))
      return fail(errorCode, "Backup v3 inventory contains duplicate paths");
    seen.add(entry.path);
    entries.push(
      entry.exists
        ? Object.freeze({
            path: entry.path,
            exists: true as const,
            data: safeFirestoreDocument(entry.data, expectedProjectId, errorCode),
          })
        : Object.freeze({ path: entry.path, exists: false as const }),
    );
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({
    projectId: parsed.data.projectId,
    readTime: parsed.data.readTime,
    entries: Object.freeze(entries),
  });
}

function materializablePathClass(path: string): BackupV3MaterializablePathClass {
  const segments = path.split("/");
  const pathClass =
    segments.length === 4 ? segments[2] : `students/*/${segments.length === 6 ? segments[4] : ""}`;
  if (
    pathClass === undefined ||
    !BACKUP_V3_MATERIALIZABLE_PATH_CLASSES.includes(pathClass as BackupV3MaterializablePathClass)
  ) {
    return fail("invalid-inventory", "Backup v3 path class is not materializable");
  }
  return pathClass as BackupV3MaterializablePathClass;
}

function canonicalRow(row: BackupV3RehearsalRow): string {
  return canonicalizeMemberDirectoryValue({
    sourcePath: row.sourcePath,
    disposition: row.disposition,
    targetPlanSet: row.targetPlanSet,
    targetPath: row.targetPath,
    data: row.data,
  });
}

function decodedPayloadBytes(rows: readonly BackupV3RehearsalRow[]): number {
  return rows
    .filter(({ disposition }) => disposition === "materialize-exact")
    .reduce((total, row) => total + Buffer.byteLength(canonicalRow(row), "utf8"), 0);
}

function integrityMac(domain: string, values: readonly string[], secret: IntegritySecret): string {
  if (!identifierPattern.test(secret.version)) {
    fail("unsafe-environment", "Backup v3 integrity secret version is invalid");
  }
  try {
    return createMemberDirectoryIntegrityMac({
      domain,
      values,
      secretMaterial: secret.material,
    });
  } catch {
    return fail("unsafe-environment", "Backup v3 integrity secret is invalid");
  }
}

function assertIntegritySecret(secret: IntegritySecret, label: string): Buffer {
  if (!identifierPattern.test(secret.version)) {
    fail("unsafe-environment", `Backup v3 ${label} secret version is invalid`);
  }
  try {
    return decodeMemberDirectorySecret(secret.material, `${label} integrity`);
  } catch {
    return fail("unsafe-environment", `Backup v3 ${label} integrity secret is invalid`);
  }
}

function assertRestoreSecrets(source: IntegritySecret, target: IntegritySecret): void {
  const sourceBytes = assertIntegritySecret(source, "source");
  const targetBytes = assertIntegritySecret(target, "target");
  if (sourceBytes.length === targetBytes.length && timingSafeEqual(sourceBytes, targetBytes)) {
    fail("unsafe-environment", "Backup v3 source and target integrity secrets must be distinct");
  }
}

function pathClassCounts(rows: readonly BackupV3RehearsalRow[]) {
  const counts = new Map<BackupV3MaterializablePathClass, number>(
    BACKUP_V3_MATERIALIZABLE_PATH_CLASSES.map((pathClass) => [pathClass, 0]),
  );
  for (const row of rows) {
    if (row.disposition !== "materialize-exact") continue;
    const pathClass = materializablePathClass(row.sourcePath);
    counts.set(pathClass, (counts.get(pathClass) ?? 0) + 1);
  }
  return Object.freeze(
    BACKUP_V3_MATERIALIZABLE_PATH_CLASSES.map((pathClass) =>
      Object.freeze({ pathClass, documentCount: counts.get(pathClass) ?? 0 }),
    ),
  );
}

function artifactMacInput(artifact: Omit<BackupV3RehearsalArtifact, "backupRootMac">): string {
  return canonicalizeMemberDirectoryValue(artifact);
}

function unsignedArtifact(
  artifact: BackupV3RehearsalArtifact,
): Omit<BackupV3RehearsalArtifact, "backupRootMac"> {
  return Object.freeze(
    Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "backupRootMac")),
  ) as Omit<BackupV3RehearsalArtifact, "backupRootMac">;
}

function snapshotRows(
  academyId: string,
  inventory: BackupV3Inventory,
): Readonly<{
  rows: readonly BackupV3RehearsalRow[];
  excludedDocumentCount: number;
}> {
  const expectedMissingAnchor = `academies/${academyId}`;
  const rows: BackupV3RehearsalRow[] = [];
  let excludedDocumentCount = 0;

  for (const entry of inventory.entries) {
    if (!entry.exists) {
      if (entry.path !== expectedMissingAnchor) {
        fail("invalid-inventory", "Backup v3 source inventory contains an unknown missing path");
      }
      continue;
    }
    let classified;
    try {
      classified = classifyBackupV3SourcePath({ academyId, sourcePath: entry.path });
    } catch {
      return fail("invalid-inventory", "Backup v3 source inventory contains an unlisted path");
    }
    if (classified.disposition === "exclude-before-backup") {
      excludedDocumentCount += 1;
      continue;
    }
    const row = Object.freeze({
      sourcePath: classified.sourcePath,
      disposition: classified.disposition,
      targetPlanSet: classified.targetPlanSet,
      targetPath: classified.targetPath,
      data: safeFirestoreDocument(entry.data, sourceProjectId, "invalid-inventory"),
    });
    try {
      parseBackupV3ArtifactRow(
        {
          sourcePath: row.sourcePath,
          disposition: row.disposition,
          targetPlanSet: row.targetPlanSet,
          targetPath: row.targetPath,
        },
        academyId,
      );
    } catch {
      return fail("invalid-inventory", "Backup v3 source disposition is invalid");
    }
    rows.push(row);
  }
  rows.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  return Object.freeze({ rows: Object.freeze(rows), excludedDocumentCount });
}

function assertSourceState(
  academyId: string,
  rows: readonly BackupV3RehearsalRow[],
): BackupV3RehearsalRow {
  const authorityRows = rows.filter(({ disposition }) => disposition === "verify-only-authority");
  if (authorityRows.length !== 1) {
    return fail(
      "source-authority-evidence",
      "Backup v3 requires exactly one source authority evidence row",
    );
  }
  const state = authorityRows[0]!;
  const parsed = memberDirectoryStateSchema.safeParse(
    jsonDocumentFromCanonical(state.data, sourceProjectId, "source-authority-evidence"),
  );
  if (
    !parsed.success ||
    parsed.data.academyId !== academyId ||
    state.sourcePath !== `academies/${academyId}/memberDirectoryStates/current`
  ) {
    return fail("source-authority-evidence", "Backup v3 source state evidence is invalid");
  }
  return state;
}

function assertStableSourceControl(
  academyId: string,
  inventory: BackupV3Inventory,
  sourceIntegrity: IntegritySecret,
): void {
  const statePath = `academies/${academyId}/memberDirectoryStates/current`;
  const guardPath = `memberDirectoryRestoreGuards/${academyId}`;
  const stateEntry = inventory.entries.find((entry) => entry.path === statePath && entry.exists);
  const guardEntry = inventory.entries.find((entry) => entry.path === guardPath && entry.exists);
  if (
    stateEntry === undefined ||
    !stateEntry.exists ||
    guardEntry === undefined ||
    !guardEntry.exists
  ) {
    fail("source-authority-evidence", "Backup v3 source control plane is incomplete");
  }
  const parsedState = memberDirectoryStateSchema.safeParse(
    jsonDocumentFromCanonical(stateEntry.data, sourceProjectId, "source-authority-evidence"),
  );
  const parsedGuard = memberDirectoryRestoreGuardSchema.safeParse(
    jsonDocumentFromCanonical(guardEntry.data, sourceProjectId, "source-authority-evidence"),
  );
  if (!parsedState.success || !parsedGuard.success) {
    fail("source-authority-evidence", "Backup v3 source control plane is invalid");
  }
  const state = parsedState.data;
  const stableLegacy =
    state.readerVersion === "legacy-v1" &&
    state.directoryWriteMode === "legacy-v1" &&
    state.freezeStatus === "open" &&
    state.operationPhase === "idle" &&
    state.globalLegacyReadEliminated === false;
  const stableCanonical =
    state.readerVersion === "canonical-v1" &&
    state.directoryWriteMode === "canonical-v1" &&
    state.freezeStatus === "open" &&
    state.operationPhase === "idle";
  const stableRollback =
    state.readerVersion === "legacy-rollback-v1" &&
    state.directoryWriteMode === "blocked" &&
    state.freezeStatus === "frozen" &&
    state.operationPhase === "rollback-readonly" &&
    state.globalLegacyReadEliminated === false;
  if (
    state.academyId !== academyId ||
    state.lastCommittedChunkNo !== 0 ||
    (!stableLegacy && !stableCanonical && !stableRollback)
  ) {
    fail("source-authority-evidence", "Backup v3 source state is not stable");
  }
  const eventPath = `${guardPath}/events/${parsedGuard.data.lastEventId}`;
  const eventEntry = inventory.entries.find((entry) => entry.path === eventPath && entry.exists);
  if (eventEntry === undefined || !eventEntry.exists) {
    fail("source-authority-evidence", "Backup v3 source guard event is missing");
  }
  try {
    assertMemberDirectoryControlPlane({
      projectId: sourceProjectId,
      state: jsonDocumentFromCanonical(
        stateEntry.data,
        sourceProjectId,
        "source-authority-evidence",
      ),
      guard: jsonDocumentFromCanonical(
        guardEntry.data,
        sourceProjectId,
        "source-authority-evidence",
      ),
      event: jsonDocumentFromCanonical(
        eventEntry.data,
        sourceProjectId,
        "source-authority-evidence",
      ),
      integritySecretMaterial: sourceIntegrity.material,
      integritySecretVersion: sourceIntegrity.version,
    });
  } catch {
    fail("source-authority-evidence", "Backup v3 source control plane diverged");
  }
}

function validatePlan(
  academyId: string,
  rows: readonly BackupV3RehearsalRow[],
  payloadDecodedBytes: number,
): void {
  const payloadPaths = rows
    .filter(({ disposition }) => disposition === "materialize-exact")
    .map(({ targetPath }) => targetPath!);
  try {
    validateBackupV3Plan({
      academyId,
      payloadPaths,
      targetControlPaths: [],
      payloadDecodedBytes,
      targetControlDecodedBytes: 0,
      visitedPathCount: payloadPaths.length,
    });
  } catch {
    fail("invalid-artifact", "Backup v3 payload plan is invalid");
  }
}

type PreparedTargetCheckpoint = Readonly<{
  targetOperationId: string;
  auditEventId: string;
  state: MemberDirectoryState;
  documents: readonly BackupV3WriteDocument[];
}>;

function artifactSourceState(artifact: BackupV3RehearsalArtifact): MemberDirectoryState {
  const stateRow = assertSourceState(artifact.academyId, artifact.rows);
  const parsed = memberDirectoryStateSchema.safeParse(
    jsonDocumentFromCanonical(stateRow.data, sourceProjectId, "invalid-artifact"),
  );
  if (!parsed.success) fail("invalid-artifact", "Backup v3 source state evidence is invalid");
  return parsed.data;
}

function targetOperationIdFor(artifact: BackupV3RehearsalArtifact): string {
  return `restore-op-${artifact.backupRootMac.slice(0, 24)}`;
}

function targetAuditIdFor(
  artifact: BackupV3RehearsalArtifact,
  targetOperationId: string,
  targetIntegrity: IntegritySecret,
): string {
  const mac = integrityMac(
    "bpt-backup-v3-rehearsal-target-prepare-audit-id-v1",
    [
      sourceProjectId,
      targetProjectId,
      artifact.academyId,
      targetOperationId,
      artifact.backupRootMac,
      artifact.sourceStateEvidenceMac,
    ],
    targetIntegrity,
  );
  return `restore-audit-${mac.slice(0, 48)}`;
}

function buildPreparedTargetCheckpoint(
  artifact: BackupV3RehearsalArtifact,
  targetIntegrity: IntegritySecret,
  preparedAt: string,
): PreparedTargetCheckpoint {
  if (!validTimestamp(preparedAt)) fail("target-verification", "Invalid target preparation time");
  const sourceState = artifactSourceState(artifact);
  const targetOperationId = targetOperationIdFor(artifact);
  const auditEventId = targetAuditIdFor(artifact, targetOperationId, targetIntegrity);
  const actorId = "backup-v3-rehearsal" as const;
  const state = memberDirectoryStateSchema.parse({
    ...sourceState,
    readerVersion: "canonical-v1",
    directoryWriteMode: "blocked",
    freezeStatus: "frozen",
    stateRevision: 0,
    operationPhase: "restore-prepared",
    lastCommittedChunkNo: 0,
    preparedOperationId: targetOperationId,
    createdAt: preparedAt,
    createdBy: actorId,
    updatedAt: preparedAt,
    updatedBy: actorId,
  });
  const eventWithoutMac = Object.freeze({
    eventId: "0",
    guardId: artifact.academyId,
    projectId: targetProjectId,
    academyId: artifact.academyId,
    previousStateRevision: -1,
    currentStateRevision: 0,
    previousEventMac: "0".repeat(64),
    globalLegacyReadEverEliminated: state.globalLegacyReadEliminated,
    highestRollbackEligibleStudentCount: state.rollbackEligibleStudentCount,
    restoreEpoch: 0,
    operationId: targetOperationId,
    transitionKind: "restore-prepare",
    occurredAt: preparedAt,
    actorId,
    integrityMacVersion: BACKUP_V3_INTEGRITY_MAC_VERSION,
    integritySecretVersion: targetIntegrity.version,
    schemaVersion: "1",
  });
  const event = memberDirectoryGuardEventSchema.parse({
    ...eventWithoutMac,
    eventMac: integrityMac(
      "bpt-member-directory-guard-event-v1",
      [canonicalizeMemberDirectoryValue(eventWithoutMac)],
      targetIntegrity,
    ),
  });
  const guard = memberDirectoryRestoreGuardSchema.parse({
    guardId: artifact.academyId,
    projectId: targetProjectId,
    academyId: artifact.academyId,
    highestStateRevision: 0,
    globalLegacyReadEverEliminated: state.globalLegacyReadEliminated,
    highestRollbackEligibleStudentCount: state.rollbackEligibleStudentCount,
    restoreEpoch: 0,
    integrityMacVersion: BACKUP_V3_INTEGRITY_MAC_VERSION,
    integritySecretVersion: targetIntegrity.version,
    lastEventId: "0",
    lastEventMac: event.eventMac,
    schemaVersion: "1",
    createdAt: preparedAt,
    createdBy: actorId,
    updatedAt: preparedAt,
    updatedBy: actorId,
  });
  const planWithoutMac: Omit<BackupV3TargetMigrationPlan, "planMac"> = Object.freeze({
    operationId: targetOperationId,
    operationType: "member-directory-restore-recovery",
    status: "planned",
    sourceProjectId,
    targetProjectId,
    academyId: artifact.academyId,
    authorityMode,
    artifactDispositionVersion: BACKUP_V3_ARTIFACT_DISPOSITION_VERSION,
    inventoryVersion: BACKUP_V3_INVENTORY_VERSION,
    firestoreValueCodecVersion: BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
    integrityMacVersion: BACKUP_V3_INTEGRITY_MAC_VERSION,
    sourceIntegritySecretVersion: artifact.sourceIntegritySecretVersion,
    targetIntegritySecretVersion: artifact.targetIntegritySecretVersion,
    snapshotReadTime: artifact.snapshotReadTime,
    sourceStateRevision: sourceState.stateRevision,
    sourceGlobalLegacyReadEliminated: sourceState.globalLegacyReadEliminated,
    sourceRollbackEligibleStudentCount: sourceState.rollbackEligibleStudentCount,
    targetStateRevision: 0,
    payloadDocumentCount: artifact.payloadDocumentCount,
    payloadDecodedBytes: artifact.payloadDecodedBytes,
    payloadRootMac: artifact.payloadRootMac,
    backupRootMac: artifact.backupRootMac,
    sourceStateEvidenceMac: artifact.sourceStateEvidenceMac,
    preparedAt,
    preparedBy: actorId,
    schemaVersion: "1",
  });
  const migrationPlan = targetMigrationPlanSchema.parse({
    ...planWithoutMac,
    planMac: integrityMac(
      "bpt-backup-v3-rehearsal-target-plan-v1",
      [canonicalizeMemberDirectoryValue(planWithoutMac)],
      targetIntegrity,
    ),
  });
  const migrationPath = `academies/${artifact.academyId}/memberDirectoryMigrations/${targetOperationId}`;
  const audit = targetPreparationAuditSchema.parse({
    auditEventId,
    academyId: artifact.academyId,
    actorId,
    action: "member-directory.restore.prepared",
    targetRef: migrationPath,
    purpose: "quarantined-restore-preparation",
    correlationId: targetOperationId,
    result: "prepared",
    stateRevision: 0,
    occurredAt: preparedAt,
    schemaVersion: 1,
  });
  const documents: BackupV3WriteDocument[] = [
    {
      path: `academies/${artifact.academyId}/memberDirectoryStates/current`,
      data: Object.freeze(state),
    },
    { path: `memberDirectoryRestoreGuards/${artifact.academyId}`, data: Object.freeze(guard) },
    {
      path: `memberDirectoryRestoreGuards/${artifact.academyId}/events/0`,
      data: Object.freeze(event),
    },
    { path: migrationPath, data: Object.freeze(migrationPlan) },
    {
      path: `academies/${artifact.academyId}/auditEvents/${auditEventId}`,
      data: Object.freeze(audit),
    },
  ];
  documents.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({
    targetOperationId,
    auditEventId,
    state: Object.freeze(state),
    documents: Object.freeze(documents),
  });
}

function targetControlDecodedBytes(documents: readonly BackupV3WriteDocument[]): number {
  return documents.reduce(
    (total, document) =>
      total +
      Buffer.byteLength(
        canonicalizeMemberDirectoryValue({ path: document.path, data: document.data }),
        "utf8",
      ),
    0,
  );
}

function validateRestorePlan(
  artifact: BackupV3RehearsalArtifact,
  checkpoint: PreparedTargetCheckpoint,
): void {
  const payloadPaths = artifact.rows
    .filter(({ disposition }) => disposition === "materialize-exact")
    .map(({ targetPath }) => targetPath!);
  try {
    validateBackupV3Plan({
      academyId: artifact.academyId,
      payloadPaths,
      targetControlPaths: checkpoint.documents.map(({ path }) => path),
      payloadDecodedBytes: artifact.payloadDecodedBytes,
      targetControlDecodedBytes: targetControlDecodedBytes(checkpoint.documents),
      visitedPathCount: payloadPaths.length + checkpoint.documents.length + 1,
      missingStructuralAnchorPath: `academies/${artifact.academyId}`,
    });
  } catch {
    fail("invalid-artifact", "Backup v3 restore plan is invalid");
  }
}

function isExactEmptyTarget(academyId: string, inventory: BackupV3Inventory): boolean {
  const anchor = `academies/${academyId}`;
  return inventory.entries.every((entry) => !entry.exists && entry.path === anchor);
}

function isPossibleTargetCheckpointPath(academyId: string, path: string): boolean {
  return (
    path === `academies/${academyId}/memberDirectoryStates/current` ||
    path === `memberDirectoryRestoreGuards/${academyId}` ||
    path === `memberDirectoryRestoreGuards/${academyId}/events/0` ||
    path.startsWith(`academies/${academyId}/memberDirectoryMigrations/`) ||
    path.startsWith(`academies/${academyId}/auditEvents/`)
  );
}

function storedPreparedAt(academyId: string, inventory: BackupV3Inventory): string {
  const statePath = `academies/${academyId}/memberDirectoryStates/current`;
  const stateEntry = inventory.entries.find((entry) => entry.path === statePath && entry.exists);
  if (stateEntry === undefined || !stateEntry.exists) {
    return fail("target-verification", "Backup v3 target I1 state is missing");
  }
  const parsed = memberDirectoryStateSchema.safeParse(
    jsonDocumentFromCanonical(stateEntry.data, targetProjectId, "target-verification"),
  );
  if (!parsed.success || parsed.data.operationPhase !== "restore-prepared") {
    return fail("target-verification", "Backup v3 target I1 state is invalid");
  }
  return parsed.data.createdAt;
}

function assertExactPreparedTarget(
  artifact: BackupV3RehearsalArtifact,
  targetIntegrity: IntegritySecret,
  inventory: BackupV3Inventory,
  expectedPayload: readonly BackupV3RehearsalRow[] = [],
): Readonly<{
  checkpoint: PreparedTargetCheckpoint;
  payloadRows: readonly BackupV3RehearsalRow[];
}> {
  const anchor = `academies/${artifact.academyId}`;
  if (inventory.entries.some((entry) => !entry.exists && entry.path !== anchor)) {
    return fail("target-verification", "Backup v3 target I1 has an unknown missing path");
  }
  const checkpoint = buildPreparedTargetCheckpoint(
    artifact,
    targetIntegrity,
    storedPreparedAt(artifact.academyId, inventory),
  );
  const actual = inventory.entries.filter((entry) => entry.exists);
  const expectedByPath = new Map<string, BackupV3CanonicalFirestoreDocument>(
    checkpoint.documents.map((document) => [
      document.path,
      firestoreDocumentFromJson(document.data, targetProjectId),
    ]),
  );
  for (const row of expectedPayload) expectedByPath.set(row.targetPath!, row.data);
  if (actual.length !== expectedByPath.size) {
    return fail("target-verification", "Backup v3 target I1 document count diverged");
  }
  for (const entry of actual) {
    if (!entry.exists) continue;
    const expected = expectedByPath.get(entry.path);
    if (
      expected === undefined ||
      canonicalizeBackupV3FirestoreDocument(entry.data, {
        database: firestoreDatabase(targetProjectId),
      }) !== canonicalizeMemberDirectoryValue(expected)
    ) {
      return fail("target-verification", "Backup v3 target I1 document diverged");
    }
  }
  const actualByPath = new Map(
    actual.map((entry) => [entry.path, entry.exists ? entry.data : Object.freeze({})]),
  );
  const state = jsonDocumentFromCanonical(
    actualByPath.get(`academies/${artifact.academyId}/memberDirectoryStates/current`),
    targetProjectId,
    "target-verification",
  );
  const guard = jsonDocumentFromCanonical(
    actualByPath.get(`memberDirectoryRestoreGuards/${artifact.academyId}`),
    targetProjectId,
    "target-verification",
  );
  const event = jsonDocumentFromCanonical(
    actualByPath.get(`memberDirectoryRestoreGuards/${artifact.academyId}/events/0`),
    targetProjectId,
    "target-verification",
  );
  try {
    assertMemberDirectoryControlPlane({
      projectId: targetProjectId,
      state,
      guard,
      event,
      integritySecretMaterial: targetIntegrity.material,
      integritySecretVersion: targetIntegrity.version,
    });
  } catch {
    return fail("target-verification", "Backup v3 target I1 control plane diverged");
  }
  const payloadRows = expectedPayload
    .map((row) =>
      Object.freeze({
        ...row,
        sourcePath: row.targetPath!,
        targetPath: row.targetPath!,
        data: safeFirestoreDocument(
          actualByPath.get(row.targetPath!),
          targetProjectId,
          "target-verification",
        ),
      }),
    )
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  return Object.freeze({ checkpoint, payloadRows: Object.freeze(payloadRows) });
}

export async function prepareBackupV3RehearsalTarget(
  input: Readonly<{
    academyId: string;
    artifact: unknown;
    binding: MemberDirectoryRestoreEnvironmentBinding;
    source: BackupV3RehearsalEndpoint;
    target: BackupV3RehearsalEndpoint;
    sourceIntegrity: IntegritySecret;
    targetIntegrity: IntegritySecret;
    now?: () => Date;
  }>,
): Promise<BackupV3TargetPreparationResult> {
  assertPair(input.binding, input.source, input.target);
  assertIdentifier(input.academyId, "academy ID");
  assertRestoreSecrets(input.sourceIntegrity, input.targetIntegrity);
  verifyBackupV3RehearsalSnapshot({
    artifact: input.artifact,
    sourceIntegrity: input.sourceIntegrity,
  });
  const artifact = rehearsalArtifactSchema.parse(input.artifact) as BackupV3RehearsalArtifact;
  if (
    artifact.academyId !== input.academyId ||
    artifact.targetIntegritySecretVersion !== input.targetIntegrity.version
  ) {
    fail("invalid-artifact", "Backup v3 artifact target binding diverged");
  }
  const preparedAt = (input.now ?? (() => new Date()))().toISOString();
  if (!validTimestamp(preparedAt)) fail("target-verification", "Invalid target preparation time");
  const plannedCheckpoint = buildPreparedTargetCheckpoint(
    artifact,
    input.targetIntegrity,
    preparedAt,
  );
  validateRestorePlan(artifact, plannedCheckpoint);

  if (await input.target.hasAnyAuthUser()) {
    fail("target-auth-not-empty", "Backup v3 target Auth must be empty");
  }
  const initialTarget = parsedInventory(
    await input.target.readNamespaceInventory(input.academyId),
    targetProjectId,
    "target-not-empty",
  );
  let replayed = false;
  if (isExactEmptyTarget(input.academyId, initialTarget)) {
    try {
      const result = await input.target.prepareTargetCheckpoint({
        academyId: input.academyId,
        targetOperationId: plannedCheckpoint.targetOperationId,
        documents: plannedCheckpoint.documents,
      });
      replayed = result === "existing";
    } catch {
      return fail("target-verification", "Backup v3 target I1 could not be prepared atomically");
    }
  } else if (
    initialTarget.entries.some(
      (entry) => entry.exists && isPossibleTargetCheckpointPath(input.academyId, entry.path),
    )
  ) {
    assertExactPreparedTarget(artifact, input.targetIntegrity, initialTarget);
    replayed = true;
  } else {
    fail("target-not-empty", "Backup v3 target namespace must be empty");
  }

  if (await input.target.hasAnyAuthUser()) {
    fail("target-auth-not-empty", "Backup v3 target Auth changed during I1 preparation");
  }
  const verifiedTarget = parsedInventory(
    await input.target.readNamespaceInventory(input.academyId),
    targetProjectId,
    "target-verification",
  );
  const verifiedCheckpoint = assertExactPreparedTarget(
    artifact,
    input.targetIntegrity,
    verifiedTarget,
  ).checkpoint;
  if (await input.target.hasAnyAuthUser()) {
    fail("target-auth-not-empty", "Backup v3 target Auth changed after I1 verification");
  }
  return Object.freeze({
    checkpoint: "I1",
    targetOperationId: verifiedCheckpoint.targetOperationId,
    targetStateRevision: 0,
    targetControlDocumentCount: 5,
    auditEventId: verifiedCheckpoint.auditEventId,
    replayed,
  });
}

export async function createBackupV3RehearsalSnapshot(
  input: Readonly<{
    academyId: string;
    binding: MemberDirectoryRestoreEnvironmentBinding;
    source: BackupV3RehearsalEndpoint;
    sourceIntegrity: IntegritySecret;
    targetIntegrityVersion: string;
  }>,
): Promise<BackupV3RehearsalArtifact> {
  assertPair(input.binding, input.source);
  assertIdentifier(input.academyId, "academy ID");
  assertIdentifier(input.targetIntegrityVersion, "target integrity version");
  assertIntegritySecret(input.sourceIntegrity, "source");
  const inventory = parsedInventory(
    await input.source.readSourceInventory(input.academyId),
    sourceProjectId,
    "invalid-inventory",
  );
  assertStableSourceControl(input.academyId, inventory, input.sourceIntegrity);
  const { rows, excludedDocumentCount } = snapshotRows(input.academyId, inventory);
  const sourceState = assertSourceState(input.academyId, rows);
  const payloadRows = rows.filter(({ disposition }) => disposition === "materialize-exact");
  const payloadDecodedBytes = decodedPayloadBytes(rows);
  validatePlan(input.academyId, rows, payloadDecodedBytes);
  const payloadRootMac = integrityMac(
    "bpt-backup-v3-rehearsal-payload-v1",
    payloadRows.map(canonicalRow),
    input.sourceIntegrity,
  );
  const sourceStateEvidenceMac = integrityMac(
    "bpt-backup-v3-rehearsal-source-state-v1",
    [canonicalRow(sourceState)],
    input.sourceIntegrity,
  );
  const withoutRoot: Omit<BackupV3RehearsalArtifact, "backupRootMac"> = Object.freeze({
    schemaVersion: BACKUP_V3_SCHEMA_VERSION,
    artifactDispositionVersion: BACKUP_V3_ARTIFACT_DISPOSITION_VERSION,
    inventoryVersion: BACKUP_V3_INVENTORY_VERSION,
    firestoreValueCodecVersion: BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
    integrityMacVersion: BACKUP_V3_INTEGRITY_MAC_VERSION,
    sourceProjectId,
    targetProjectId,
    academyId: input.academyId,
    authorityMode,
    authArtifactCount: 0,
    snapshotReadTime: inventory.readTime,
    sourceIntegritySecretVersion: input.sourceIntegrity.version,
    targetIntegritySecretVersion: input.targetIntegrityVersion,
    rows,
    pathClassCounts: pathClassCounts(rows),
    backupDocumentCount: rows.length,
    payloadDocumentCount: payloadRows.length,
    excludedDocumentCount,
    payloadDecodedBytes,
    payloadRootMac,
    sourceStateEvidenceMac,
  });
  const artifact: BackupV3RehearsalArtifact = Object.freeze({
    ...withoutRoot,
    backupRootMac: integrityMac(
      "bpt-backup-v3-rehearsal-artifact-v1",
      [artifactMacInput(withoutRoot)],
      input.sourceIntegrity,
    ),
  });
  verifyBackupV3RehearsalSnapshot({ artifact, sourceIntegrity: input.sourceIntegrity });
  return artifact;
}

export function verifyBackupV3RehearsalSnapshot(
  input: Readonly<{
    artifact: unknown;
    sourceIntegrity: IntegritySecret;
  }>,
): Readonly<{
  backupDocumentCount: number;
  payloadDocumentCount: number;
  payloadDecodedBytes: number;
}> {
  const parsed = rehearsalArtifactSchema.safeParse(input.artifact);
  if (!parsed.success || !validTimestamp(parsed.data.snapshotReadTime)) {
    return fail("invalid-artifact", "Backup v3 rehearsal artifact is invalid");
  }
  const artifact = parsed.data as BackupV3RehearsalArtifact;
  if (artifact.sourceIntegritySecretVersion !== input.sourceIntegrity.version) {
    return fail("invalid-artifact", "Backup v3 source integrity version is unavailable");
  }
  const canonicalRows = artifact.rows.map((row) => {
    try {
      const artifactRow = parseBackupV3ArtifactRow(
        {
          sourcePath: row.sourcePath,
          disposition: row.disposition,
          targetPlanSet: row.targetPlanSet,
          targetPath: row.targetPath,
        },
        artifact.academyId,
      );
      if (artifactRow.disposition === "exclude-before-backup") throw new Error();
      return Object.freeze({
        ...row,
        data: safeFirestoreDocument(row.data, sourceProjectId, "invalid-artifact"),
      });
    } catch {
      return fail("invalid-artifact", "Backup v3 artifact row is invalid");
    }
  });
  const sortedPaths = canonicalRows.map(({ sourcePath }) => sourcePath);
  if (
    new Set(sortedPaths).size !== sortedPaths.length ||
    [...sortedPaths]
      .sort((left, right) => left.localeCompare(right))
      .some((path, index) => path !== sortedPaths[index])
  ) {
    return fail("invalid-artifact", "Backup v3 artifact rows are not a unique canonical order");
  }
  const sourceState = assertSourceState(artifact.academyId, canonicalRows);
  const payloadRows = canonicalRows.filter(
    ({ disposition }) => disposition === "materialize-exact",
  );
  const bytes = decodedPayloadBytes(canonicalRows);
  validatePlan(artifact.academyId, canonicalRows, bytes);
  if (
    artifact.backupDocumentCount !== canonicalRows.length ||
    artifact.backupDocumentCount !== payloadRows.length + 1 ||
    artifact.payloadDocumentCount !== payloadRows.length ||
    artifact.payloadDecodedBytes !== bytes ||
    canonicalizeMemberDirectoryValue(artifact.pathClassCounts) !==
      canonicalizeMemberDirectoryValue(pathClassCounts(canonicalRows))
  ) {
    return fail("invalid-artifact", "Backup v3 artifact counts do not reconcile");
  }
  const expectedPayloadRoot = integrityMac(
    "bpt-backup-v3-rehearsal-payload-v1",
    payloadRows.map(canonicalRow),
    input.sourceIntegrity,
  );
  const expectedStateMac = integrityMac(
    "bpt-backup-v3-rehearsal-source-state-v1",
    [canonicalRow(sourceState)],
    input.sourceIntegrity,
  );
  const expectedBackupRoot = integrityMac(
    "bpt-backup-v3-rehearsal-artifact-v1",
    [artifactMacInput(unsignedArtifact(artifact))],
    input.sourceIntegrity,
  );
  if (
    !constantTimeMacEquals(artifact.payloadRootMac, expectedPayloadRoot) ||
    !constantTimeMacEquals(artifact.sourceStateEvidenceMac, expectedStateMac) ||
    !constantTimeMacEquals(artifact.backupRootMac, expectedBackupRoot)
  ) {
    return fail("invalid-artifact", "Backup v3 artifact integrity verification failed");
  }
  return Object.freeze({
    backupDocumentCount: artifact.backupDocumentCount,
    payloadDocumentCount: artifact.payloadDocumentCount,
    payloadDecodedBytes: artifact.payloadDecodedBytes,
  });
}

function attestationMacInput(
  attestation: Omit<BackupV3RestoreAttestation, "sourceAttestationMac">,
): string {
  return canonicalizeMemberDirectoryValue(attestation);
}

export async function restoreBackupV3RehearsalSnapshot(
  input: Readonly<{
    academyId: string;
    artifact: unknown;
    binding: MemberDirectoryRestoreEnvironmentBinding;
    source: BackupV3RehearsalEndpoint;
    target: BackupV3RehearsalEndpoint;
    sourceIntegrity: IntegritySecret;
    targetIntegrity: IntegritySecret;
    now?: () => Date;
  }>,
): Promise<BackupV3RestoreResult> {
  const preparation = await prepareBackupV3RehearsalTarget(input);
  const artifact = rehearsalArtifactSchema.parse(input.artifact) as BackupV3RehearsalArtifact;
  const targetOperationId = preparation.targetOperationId;
  const payloadRows = artifact.rows.filter(
    ({ disposition }) => disposition === "materialize-exact",
  );
  if (await input.target.hasAnyAuthUser()) {
    fail("target-auth-not-empty", "Backup v3 target Auth changed before payload restore");
  }
  const plannedPaths = Object.freeze(payloadRows.map((row) => row.targetPath!));
  const documents: readonly BackupV3ExactPayloadDocument[] = Object.freeze(
    payloadRows.map((row) => Object.freeze({ path: row.targetPath!, data: row.data })),
  );
  await input.target.createPayloadDocuments({
    sourceProjectId,
    targetProjectId,
    academyId: input.academyId,
    plannedPaths,
    documents,
  });
  if (await input.target.hasAnyAuthUser()) {
    fail("target-auth-not-empty", "Backup v3 target Auth changed during restore");
  }
  const finalTarget = parsedInventory(
    await input.target.readNamespaceInventory(input.academyId),
    targetProjectId,
    "target-verification",
  );
  const verifiedTargetRows = assertExactPreparedTarget(
    artifact,
    input.targetIntegrity,
    finalTarget,
    payloadRows,
  ).payloadRows;
  if (await input.target.hasAnyAuthUser()) {
    fail("target-auth-not-empty", "Backup v3 target Auth changed before attestation");
  }
  const targetDecodedBytes = decodedPayloadBytes(verifiedTargetRows);
  if (
    targetDecodedBytes !== artifact.payloadDecodedBytes ||
    verifiedTargetRows.length !== artifact.payloadDocumentCount
  ) {
    fail("target-verification", "Backup v3 target summary diverged");
  }
  const attestedTargetInventoryMac = integrityMac(
    "bpt-backup-v3-rehearsal-target-inventory-v1",
    [
      BACKUP_V3_INVENTORY_VERSION,
      targetProjectId,
      input.academyId,
      targetOperationId,
      authorityMode,
      finalTarget.readTime,
      String(verifiedTargetRows.length),
      String(targetDecodedBytes),
      ...verifiedTargetRows.map(canonicalRow),
    ],
    input.targetIntegrity,
  );
  const attestationIdMac = integrityMac(
    "bpt-backup-v3-rehearsal-attestation-id-v1",
    [
      sourceProjectId,
      targetProjectId,
      input.academyId,
      targetOperationId,
      artifact.backupRootMac,
      artifact.sourceStateEvidenceMac,
      attestedTargetInventoryMac,
    ],
    input.sourceIntegrity,
  );
  const attestationId = `restore-v3-${attestationIdMac.slice(0, 48)}`;
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  if (!validTimestamp(createdAt)) fail("attestation-conflict", "Invalid attestation timestamp");
  const withoutMac: Omit<BackupV3RestoreAttestation, "sourceAttestationMac"> = Object.freeze({
    attestationId,
    schemaVersion: "1",
    sourceProjectId,
    targetProjectId,
    academyId: input.academyId,
    targetOperationId,
    authorityMode,
    artifactDispositionVersion: BACKUP_V3_ARTIFACT_DISPOSITION_VERSION,
    inventoryVersion: BACKUP_V3_INVENTORY_VERSION,
    firestoreValueCodecVersion: BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
    snapshotReadTime: artifact.snapshotReadTime,
    attestedReadTime: finalTarget.readTime,
    backupDocumentCount: artifact.backupDocumentCount,
    payloadDocumentCount: artifact.payloadDocumentCount,
    payloadDecodedBytes: artifact.payloadDecodedBytes,
    targetDocumentCount: verifiedTargetRows.length,
    targetAuthUserCount: 0,
    payloadRootMac: artifact.payloadRootMac,
    backupRootMac: artifact.backupRootMac,
    sourceStateEvidenceMac: artifact.sourceStateEvidenceMac,
    attestedTargetInventoryMac,
    sourceIntegritySecretVersion: artifact.sourceIntegritySecretVersion,
    targetIntegritySecretVersion: artifact.targetIntegritySecretVersion,
    createdAt,
    createdBy: "backup-v3-rehearsal",
  });
  const attestation: BackupV3RestoreAttestation = Object.freeze({
    ...withoutMac,
    sourceAttestationMac: integrityMac(
      "bpt-backup-v3-rehearsal-attestation-v1",
      [attestationMacInput(withoutMac)],
      input.sourceIntegrity,
    ),
  });
  if (!attestationSchema.safeParse(attestation).success) {
    fail("attestation-conflict", "Backup v3 attestation is not metadata-only");
  }
  try {
    await input.source.putMetadataDocument(
      `memberDirectoryRestoreAttestations/${attestationId}`,
      attestation,
    );
  } catch {
    fail("attestation-conflict", "Backup v3 attestation could not be created exactly");
  }
  return Object.freeze({
    attestationId,
    restoredDocumentCount: verifiedTargetRows.length,
    authorityMode,
    targetAuthUserCount: 0,
    attestation,
  });
}
