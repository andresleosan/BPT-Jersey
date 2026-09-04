import { z } from "zod";

export const BACKUP_V3_SCHEMA_VERSION = 3 as const;
export const BACKUP_V3_ARTIFACT_DISPOSITION_VERSION = "member-directory-restore-v1" as const;
export const BACKUP_V3_INVENTORY_VERSION = "firestore-namespace-inventory-v1" as const;
export const BACKUP_V3_INTEGRITY_MAC_VERSION = "hmac-sha256-v1" as const;

const mebibyte = 1024 * 1024;

export const BACKUP_V3_LIMITS = Object.freeze({
  payload: Object.freeze({
    maxDocumentCount: 10_000,
    maxDecodedBytes: 256 * mebibyte,
  }),
  targetControl: Object.freeze({
    maxDocumentCount: 2_048,
    maxDecodedBytes: 32 * mebibyte,
  }),
  combined: Object.freeze({
    maxDocumentCount: 12_048,
    maxDecodedBytes: 288 * mebibyte,
  }),
  maxVisitedPathCount: 12_049,
} as const);

export const TENANT_BACKUP_V3_DIRECT_COLLECTIONS = Object.freeze([
  "users",
  "families",
  "students",
  "studentAdminProfiles",
  "studentIdentityKeys",
  "studentRestrictedReadLimits",
  "memberDirectoryMigrations",
  "memberDirectoryMigrationChunks",
  "memberDirectoryApprovals",
  "memberDirectoryApprovalConsumptions",
  "memberDirectoryWriteReceipts",
  "profileWriteReceipts",
  "familyWriteReceipts",
  "memberDirectoryImportReceipts",
  "staff",
  "relationships",
  "locations",
  "programs",
  "classes",
  "sessions",
  "plans",
  "bookings",
  "waitlistEntries",
  "sessionCapacityStates",
  "bookingQuotaStates",
  "waitlistPositionStates",
  "attendance",
  "checkouts",
  "memberships",
  "invoices",
  "payments",
  "paymentEvents",
  "assessments",
  "skillProgress",
  "studentLevelProgress",
  "levelPromotions",
  "recognitions",
  "medicalLeaves",
  "retentionAlerts",
  "leads",
  "messages",
  "deliveryEvents",
  "notificationPreferences",
  "familyAchievementSnapshots",
  "healthProfiles",
  "safeguardingCases",
  "waiverVersions",
  "consents",
  "documents",
  "auditEvents",
  "exports",
  "exportRateLimits",
  "regyfitAccessRecords",
  "levelSystems",
  "levelDefinitions",
  "levelRequirements",
  "levelCatalogManifests",
  "members",
] as const);

export const TENANT_BACKUP_V3_NESTED_COLLECTIONS = Object.freeze([
  "evaluations",
  "graduations",
  "medicalLeaves",
] as const);

export const BACKUP_V3_MATERIALIZABLE_PATH_CLASSES = Object.freeze([
  ...TENANT_BACKUP_V3_DIRECT_COLLECTIONS,
  "students/*/evaluations",
  "students/*/graduations",
  "students/*/medicalLeaves",
] as const);

export type BackupV3MaterializablePathClass =
  (typeof BACKUP_V3_MATERIALIZABLE_PATH_CLASSES)[number];
export type BackupV3ArtifactDisposition =
  "materialize-exact" | "verify-only-authority" | "exclude-before-backup";
export type BackupV3TargetPlanSet = "payload" | "target-control";

export type BackupV3ContractErrorCode =
  | "academy-mismatch"
  | "combined-byte-limit"
  | "combined-document-limit"
  | "disposition-mismatch"
  | "duplicate-plan-path"
  | "excluded-source-path"
  | "invalid-academy-id"
  | "invalid-artifact-row"
  | "invalid-manifest"
  | "invalid-missing-anchor"
  | "invalid-plan"
  | "payload-byte-limit"
  | "payload-document-limit"
  | "plan-set-overlap"
  | "remap-forbidden"
  | "source-target-control"
  | "target-control-byte-limit"
  | "target-control-document-limit"
  | "unclassified-plan-path"
  | "unlisted-source-path"
  | "visited-path-limit";

export class BackupV3ContractError extends Error {
  readonly code: BackupV3ContractErrorCode;

  constructor(code: BackupV3ContractErrorCode, message: string) {
    super(message);
    this.name = "BackupV3ContractError";
    this.code = code;
  }
}

type ClassifiedBackupV3SourcePath = Readonly<{
  sourcePath: string;
  disposition: BackupV3ArtifactDisposition;
  targetPlanSet: "payload" | null;
  targetPath: string | null;
}>;

const directCollectionSet = new Set<string>(TENANT_BACKUP_V3_DIRECT_COLLECTIONS);
const nestedCollectionSet = new Set<string>(TENANT_BACKUP_V3_NESTED_COLLECTIONS);
const materializablePathClassSet = new Set<string>(BACKUP_V3_MATERIALIZABLE_PATH_CLASSES);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const pathControlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const macPattern = /^[a-f0-9]{64}$/u;
const utcMillisecondDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function contractError(code: BackupV3ContractErrorCode, message: string): never {
  throw new BackupV3ContractError(code, message);
}

function isValidIdentifier(value: string): boolean {
  return identifierPattern.test(value);
}

function assertAcademyId(academyId: string): void {
  if (!isValidIdentifier(academyId)) {
    contractError("invalid-academy-id", "Backup v3 academy ID is invalid");
  }
}

function splitCanonicalDocumentPath(path: string): readonly string[] | null {
  if (
    path.length === 0 ||
    path.length > 6_144 ||
    path !== path.trim() ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    pathControlCharacterPattern.test(path)
  ) {
    return null;
  }
  const segments = path.split("/");
  if (
    segments.length % 2 !== 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return null;
  }
  return segments;
}

function excludedPathMatches(segments: readonly string[], academyId: string): boolean {
  if (
    segments.length === 4 &&
    segments[0] === "academies" &&
    segments[1] === academyId &&
    (segments[2] === "memberDirectoryCursorStates" ||
      segments[2] === "memberDirectoryImportSessions")
  ) {
    return true;
  }
  if (
    segments[0] === "memberDirectoryRestoreGuards" &&
    segments[1] === academyId &&
    (segments.length === 2 || (segments.length === 4 && segments[2] === "events"))
  ) {
    return true;
  }
  return (
    segments.length === 2 &&
    (segments[0] === "memberDirectoryRestoreAttestations" ||
      segments[0] === "memberDirectoryRestoreAttestationConsumptions")
  );
}

export function classifyBackupV3SourcePath(
  input: Readonly<{
    academyId: string;
    sourcePath: string;
  }>,
): ClassifiedBackupV3SourcePath {
  assertAcademyId(input.academyId);
  const segments = splitCanonicalDocumentPath(input.sourcePath);
  if (!segments) {
    return contractError("unlisted-source-path", "Backup v3 source path is not allowlisted");
  }

  if (segments[0] === "academies" && segments[1] !== input.academyId) {
    return contractError("academy-mismatch", "Backup v3 source path crosses academy scope");
  }
  if (segments[0] === "memberDirectoryRestoreGuards" && segments[1] !== input.academyId) {
    return contractError("academy-mismatch", "Backup v3 source path crosses academy scope");
  }

  if (excludedPathMatches(segments, input.academyId)) {
    return {
      sourcePath: input.sourcePath,
      disposition: "exclude-before-backup",
      targetPlanSet: null,
      targetPath: null,
    };
  }

  if (segments.length === 4 && segments[0] === "academies" && segments[1] === input.academyId) {
    const collection = segments[2];
    const documentId = segments[3];
    if (collection === "memberDirectoryStates" && documentId === "current") {
      return {
        sourcePath: input.sourcePath,
        disposition: "verify-only-authority",
        targetPlanSet: null,
        targetPath: null,
      };
    }
    if (collection && documentId && directCollectionSet.has(collection)) {
      return {
        sourcePath: input.sourcePath,
        disposition: "materialize-exact",
        targetPlanSet: "payload",
        targetPath: input.sourcePath,
      };
    }
  }

  if (
    segments.length === 6 &&
    segments[0] === "academies" &&
    segments[1] === input.academyId &&
    segments[2] === "students" &&
    segments[3] &&
    segments[4] &&
    nestedCollectionSet.has(segments[4]) &&
    segments[5]
  ) {
    return {
      sourcePath: input.sourcePath,
      disposition: "materialize-exact",
      targetPlanSet: "payload",
      targetPath: input.sourcePath,
    };
  }

  return contractError("unlisted-source-path", "Backup v3 source path is not allowlisted");
}

const artifactRowSchema = z.strictObject({
  sourcePath: z.string().min(1).max(6_144),
  disposition: z.enum(["materialize-exact", "verify-only-authority", "exclude-before-backup"]),
  targetPlanSet: z.enum(["payload", "target-control"]).nullable(),
  targetPath: z.string().min(1).max(6_144).nullable(),
});

export type BackupV3ArtifactRow = Readonly<z.infer<typeof artifactRowSchema>>;

export function parseBackupV3ArtifactRow(value: unknown, academyId: string): BackupV3ArtifactRow {
  const result = artifactRowSchema.safeParse(value);
  if (!result.success) {
    return contractError("invalid-artifact-row", "Backup v3 artifact row is invalid");
  }
  if (result.data.targetPlanSet === "target-control") {
    return contractError(
      "source-target-control",
      "Backup v3 source artifacts cannot supply target control",
    );
  }

  const expected = classifyBackupV3SourcePath({ academyId, sourcePath: result.data.sourcePath });
  if (expected.disposition === "exclude-before-backup") {
    return contractError(
      "excluded-source-path",
      "Backup v3 artifact contains an excluded source path",
    );
  }
  if (result.data.targetPath !== null && result.data.targetPath !== result.data.sourcePath) {
    return contractError("remap-forbidden", "Backup v3 artifact path remapping is forbidden");
  }
  if (
    result.data.disposition !== expected.disposition ||
    result.data.targetPlanSet !== expected.targetPlanSet ||
    result.data.targetPath !== expected.targetPath
  ) {
    return contractError(
      "disposition-mismatch",
      "Backup v3 artifact disposition does not match its source path",
    );
  }
  return result.data;
}

const planSchema = z.strictObject({
  academyId: z.string().min(1).max(128),
  payloadPaths: z.array(z.string().min(1).max(6_144)).max(12_049),
  targetControlPaths: z.array(z.string().min(1).max(6_144)).max(12_049),
  payloadDecodedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  targetControlDecodedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  visitedPathCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  missingStructuralAnchorPath: z.string().min(1).max(6_144).optional(),
});

export type BackupV3PlanSummary = Readonly<{
  payloadDocumentCount: number;
  payloadDecodedBytes: number;
  targetControlDocumentCount: number;
  targetControlDecodedBytes: number;
  combinedDocumentCount: number;
  combinedDecodedBytes: number;
  visitedPathCount: number;
}>;

function isTargetControlPath(academyId: string, path: string): boolean {
  const segments = splitCanonicalDocumentPath(path);
  if (!segments) return false;
  if (
    segments.length === 4 &&
    segments[0] === "academies" &&
    segments[1] === academyId &&
    segments[3]
  ) {
    return (
      (segments[2] === "memberDirectoryStates" && segments[3] === "current") ||
      segments[2] === "memberDirectoryMigrations" ||
      segments[2] === "memberDirectoryMigrationChunks" ||
      segments[2] === "memberDirectoryApprovalConsumptions" ||
      segments[2] === "auditEvents"
    );
  }
  return (
    (segments.length === 2 &&
      segments[0] === "memberDirectoryRestoreGuards" &&
      segments[1] === academyId) ||
    (segments.length === 4 &&
      segments[0] === "memberDirectoryRestoreGuards" &&
      segments[1] === academyId &&
      segments[2] === "events" &&
      Boolean(segments[3]))
  );
}

function assertUniquePaths(paths: readonly string[]): Set<string> {
  const unique = new Set(paths);
  if (unique.size !== paths.length) {
    return contractError("duplicate-plan-path", "Backup v3 plan contains a duplicate path");
  }
  return unique;
}

export function validateBackupV3Plan(value: unknown): BackupV3PlanSummary {
  const result = planSchema.safeParse(value);
  if (!result.success) {
    return contractError("invalid-plan", "Backup v3 plan is invalid");
  }
  const plan = result.data;
  assertAcademyId(plan.academyId);

  const payloadDocumentCount = plan.payloadPaths.length;
  const targetControlDocumentCount = plan.targetControlPaths.length;
  const combinedDocumentCount = payloadDocumentCount + targetControlDocumentCount;
  const combinedDecodedBytes = plan.payloadDecodedBytes + plan.targetControlDecodedBytes;

  if (combinedDocumentCount > BACKUP_V3_LIMITS.combined.maxDocumentCount) {
    return contractError("combined-document-limit", "Backup v3 combined document limit exceeded");
  }
  if (combinedDecodedBytes > BACKUP_V3_LIMITS.combined.maxDecodedBytes) {
    return contractError("combined-byte-limit", "Backup v3 combined byte limit exceeded");
  }
  if (payloadDocumentCount > BACKUP_V3_LIMITS.payload.maxDocumentCount) {
    return contractError("payload-document-limit", "Backup v3 payload document limit exceeded");
  }
  if (plan.payloadDecodedBytes > BACKUP_V3_LIMITS.payload.maxDecodedBytes) {
    return contractError("payload-byte-limit", "Backup v3 payload byte limit exceeded");
  }
  if (targetControlDocumentCount > BACKUP_V3_LIMITS.targetControl.maxDocumentCount) {
    return contractError(
      "target-control-document-limit",
      "Backup v3 target-control document limit exceeded",
    );
  }
  if (plan.targetControlDecodedBytes > BACKUP_V3_LIMITS.targetControl.maxDecodedBytes) {
    return contractError(
      "target-control-byte-limit",
      "Backup v3 target-control byte limit exceeded",
    );
  }
  if (plan.visitedPathCount > BACKUP_V3_LIMITS.maxVisitedPathCount) {
    return contractError("visited-path-limit", "Backup v3 visited-path limit exceeded");
  }

  const payloadSet = assertUniquePaths(plan.payloadPaths);
  const targetControlSet = assertUniquePaths(plan.targetControlPaths);
  if ([...payloadSet].some((path) => targetControlSet.has(path))) {
    return contractError("plan-set-overlap", "Backup v3 plan sets overlap");
  }

  for (const path of payloadSet) {
    try {
      if (
        classifyBackupV3SourcePath({ academyId: plan.academyId, sourcePath: path }).disposition !==
        "materialize-exact"
      ) {
        return contractError(
          "unclassified-plan-path",
          "Backup v3 payload contains an unclassified path",
        );
      }
    } catch {
      return contractError(
        "unclassified-plan-path",
        "Backup v3 payload contains an unclassified path",
      );
    }
  }
  if ([...targetControlSet].some((path) => !isTargetControlPath(plan.academyId, path))) {
    return contractError(
      "unclassified-plan-path",
      "Backup v3 target-control contains an unclassified path",
    );
  }

  const exactAnchor = `academies/${plan.academyId}`;
  const missingPathCount = plan.visitedPathCount - combinedDocumentCount;
  if (
    missingPathCount < 0 ||
    missingPathCount > 1 ||
    (missingPathCount === 0 && plan.missingStructuralAnchorPath !== undefined) ||
    (missingPathCount === 1 && plan.missingStructuralAnchorPath !== exactAnchor)
  ) {
    return contractError(
      "invalid-missing-anchor",
      "Backup v3 permits only the exact missing academy structural anchor",
    );
  }

  return Object.freeze({
    payloadDocumentCount,
    payloadDecodedBytes: plan.payloadDecodedBytes,
    targetControlDocumentCount,
    targetControlDecodedBytes: plan.targetControlDecodedBytes,
    combinedDocumentCount,
    combinedDecodedBytes,
    visitedPathCount: plan.visitedPathCount,
  });
}

const nonnegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const boundedStudentCountSchema = nonnegativeSafeIntegerSchema.max(400);
const opaqueIdentifierSchema = z.string().regex(identifierPattern);
const macSchema = z.string().regex(macPattern);
const timestampSchema = z.string().refine((value) => {
  if (!utcMillisecondDateTimePattern.test(value)) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
});
const pathClassSummarySchema = z.strictObject({
  pathClass: z.string().refine((value) => materializablePathClassSet.has(value)),
  documentCount: nonnegativeSafeIntegerSchema,
  rootMac: macSchema,
});

export const backupV3ManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(BACKUP_V3_SCHEMA_VERSION),
    artifactDispositionVersion: z.literal(BACKUP_V3_ARTIFACT_DISPOSITION_VERSION),
    inventoryVersion: z.literal(BACKUP_V3_INVENTORY_VERSION),
    sourceProjectId: z.literal("demo-bpt-jersey"),
    academyId: opaqueIdentifierSchema,
    snapshotReadTime: timestampSchema,
    sourceStatePath: z.string().min(1).max(6_144),
    sourceStateDocumentCount: z.literal(1),
    sourceStateDisposition: z.literal("verify-only-authority"),
    sourceStateTargetPlanSet: z.null(),
    sourceStateRevision: nonnegativeSafeIntegerSchema,
    sourceGlobalLegacyReadEliminated: z.boolean(),
    sourceReaderVersion: z.enum(["legacy-v1", "canonical-v1", "legacy-rollback-v1"]),
    sourceDirectoryWriteMode: z.enum(["legacy-v1", "canonical-v1", "blocked"]),
    sourceFreezeStatus: z.enum(["open", "frozen"]),
    sourceOperationPhase: z.enum(["idle", "rollback-readonly"]),
    sourceRollbackProtocolVersion: z.enum(["legacy-projection-v1", "disabled"]),
    sourceRollbackEligibleStudentCount: boundedStudentCountSchema,
    sourceGuardRevision: nonnegativeSafeIntegerSchema,
    sourceGuardGlobalLegacyReadEliminated: z.boolean(),
    sourceGuardStudentCount: boundedStudentCountSchema,
    sourceGuardRestoreEpoch: nonnegativeSafeIntegerSchema,
    sourceGuardEventMac: macSchema,
    codeVersion: opaqueIdentifierSchema,
    dataSchemaVersion: opaqueIdentifierSchema,
    pathClassSummaries: z
      .array(pathClassSummarySchema)
      .length(BACKUP_V3_MATERIALIZABLE_PATH_CLASSES.length),
    backupDocumentCount: nonnegativeSafeIntegerSchema,
    backupRootMac: macSchema,
    payloadDocumentCount: nonnegativeSafeIntegerSchema.max(
      BACKUP_V3_LIMITS.payload.maxDocumentCount,
    ),
    payloadDecodedBytes: nonnegativeSafeIntegerSchema.max(BACKUP_V3_LIMITS.payload.maxDecodedBytes),
    payloadRootMac: macSchema,
    identityKeyDigestVersion: z.literal(BACKUP_V3_INTEGRITY_MAC_VERSION),
    identityKeySecretVersion: opaqueIdentifierSchema,
    identityKeyBaselineMac: macSchema,
    identityKeyBaselineArtifactId: opaqueIdentifierSchema,
    cursorMacVersion: z.literal(BACKUP_V3_INTEGRITY_MAC_VERSION),
    cursorSecretVersion: opaqueIdentifierSchema,
    integrityMacVersion: z.literal(BACKUP_V3_INTEGRITY_MAC_VERSION),
    integritySecretVersion: opaqueIdentifierSchema,
    privateManifestMac: macSchema,
    sourceStateEvidenceMac: macSchema,
    backupManifestMac: macSchema,
  })
  .superRefine((manifest, context) => {
    const expectedStatePath = `academies/${manifest.academyId}/memberDirectoryStates/current`;
    if (manifest.sourceStatePath !== expectedStatePath) {
      context.addIssue({
        code: "custom",
        path: ["sourceStatePath"],
        message: "Source state path must be the exact singleton",
      });
    }

    const summaryClasses = new Set(manifest.pathClassSummaries.map(({ pathClass }) => pathClass));
    if (
      summaryClasses.size !== BACKUP_V3_MATERIALIZABLE_PATH_CLASSES.length ||
      BACKUP_V3_MATERIALIZABLE_PATH_CLASSES.some((pathClass) => !summaryClasses.has(pathClass))
    ) {
      context.addIssue({
        code: "custom",
        path: ["pathClassSummaries"],
        message: "Path class summaries must cover the closed v3 allowlist exactly once",
      });
    }

    const summarizedPayloadCount = manifest.pathClassSummaries.reduce(
      (total, summary) => total + summary.documentCount,
      0,
    );
    if (summarizedPayloadCount !== manifest.payloadDocumentCount) {
      context.addIssue({
        code: "custom",
        path: ["payloadDocumentCount"],
        message: "Payload count does not reconcile with path class summaries",
      });
    }
    if (manifest.backupDocumentCount !== manifest.payloadDocumentCount + 1) {
      context.addIssue({
        code: "custom",
        path: ["backupDocumentCount"],
        message: "Backup count must contain payload plus exactly one source state",
      });
    }

    if (
      manifest.sourceStateRevision !== manifest.sourceGuardRevision ||
      manifest.sourceGlobalLegacyReadEliminated !==
        manifest.sourceGuardGlobalLegacyReadEliminated ||
      manifest.sourceRollbackEligibleStudentCount !== manifest.sourceGuardStudentCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceGuardRevision"],
        message: "Source state and guard snapshot evidence diverge",
      });
    }

    const stableTuple = [
      manifest.sourceReaderVersion,
      manifest.sourceDirectoryWriteMode,
      manifest.sourceFreezeStatus,
      manifest.sourceOperationPhase,
      String(manifest.sourceGlobalLegacyReadEliminated),
    ].join("|");
    const stableTuples = new Set([
      "legacy-v1|legacy-v1|open|idle|false",
      "canonical-v1|canonical-v1|open|idle|false",
      "canonical-v1|canonical-v1|open|idle|true",
      "legacy-rollback-v1|blocked|frozen|rollback-readonly|false",
    ]);
    if (!stableTuples.has(stableTuple)) {
      context.addIssue({
        code: "custom",
        path: ["sourceOperationPhase"],
        message: "Backup v3 source state is not a stable rehearsal-eligible tuple",
      });
    }

    const expectedRollbackProtocol = manifest.sourceGlobalLegacyReadEliminated
      ? "disabled"
      : "legacy-projection-v1";
    if (manifest.sourceRollbackProtocolVersion !== expectedRollbackProtocol) {
      context.addIssue({
        code: "custom",
        path: ["sourceRollbackProtocolVersion"],
        message: "Rollback protocol does not match the source global marker",
      });
    }
  });

export type BackupV3Manifest = Readonly<z.infer<typeof backupV3ManifestSchema>>;

export function parseBackupV3Manifest(value: unknown): BackupV3Manifest {
  const result = backupV3ManifestSchema.safeParse(value);
  if (!result.success) {
    return contractError("invalid-manifest", "Backup v3 manifest is invalid");
  }
  return result.data;
}
