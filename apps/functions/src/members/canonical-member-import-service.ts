import { memberReportKeys, type MemberReportKey } from "@bpt-jersey/domain/members";
import {
  normalizeAdministrativeIdentifier,
  studentAdminProfileSchema,
  type MemberDirectoryState,
  type StudentAdminProfile,
} from "@bpt-jersey/domain/members/directory";
import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import { parseFamilyRecord, parseFamilyRelationship } from "@bpt-jersey/domain/families";
import {
  deriveParticipantType,
  parseStudentProfileAt,
  trainingCenters,
  trainingTimePreferences,
  type StudentProfile,
} from "@bpt-jersey/domain/profiles";
import { z } from "zod";

import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";
import type {
  CanonicalMemberDirectoryActor,
  MemberDirectoryDocumentData,
  MemberDirectoryDocumentReference,
  MemberDirectoryDocumentSnapshot,
  MemberDirectoryFirestore,
  MemberDirectoryTransaction,
} from "./canonical-member-directory-service.js";
import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";
import {
  buildStudentIdentityKey,
  canonicalizeMemberDirectoryValue,
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
  decodeMemberDirectorySecret,
  deriveStudentIdentityKeyId,
  studentIdentityKeySchema,
  type StudentIdentityKey,
  type StudentIdentityKeyKind,
} from "./member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  assertCanonicalMemberDirectoryWriterReady,
  assertMemberDirectoryControlPlane,
  memberDirectoryRestoreGuardSchema,
  type MemberDirectoryGuardEvent,
  type MemberDirectoryRestoreGuard,
} from "./member-directory-state.js";
import type { ParsedMemberRow } from "./member-pdf-import.js";

export const canonicalMemberImportClassifications = Object.freeze([
  "same-id-compatible",
  "explicit-existing-student-match",
  "createable-adult",
  "minor-requires-family-match",
  "missing-required-fields",
  "identity-conflict",
  "duplicate-membership-number",
  "cross-tenant",
  "invalid-record",
] as const);

export type CanonicalMemberImportClassification =
  (typeof canonicalMemberImportClassifications)[number];

export const MAX_CANONICAL_MEMBER_IMPORT_ROWS = 50;
const MAX_EXISTING_STUDENTS = 400;
const MAX_TRANSACTION_WRITES = 350;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_OPERATION_WINDOW_MS = 30 * 60 * 1000;
const CODE_VERSION = "canonical-member-import-v1";
const SCHEMA_VERSION = "1";

export type CanonicalMemberImportExistingStudent = Readonly<{
  studentId: string;
  student: unknown;
  profileId?: string;
  adminProfile?: unknown;
}>;

export type CanonicalMemberImportReceipt = Readonly<{
  receiptId: string;
  operationId: string;
  academyId: string;
  actorId: string;
  projectId: string;
  targetProjectClassification: string;
  codeVersion: typeof CODE_VERSION;
  schemaVersion: typeof SCHEMA_VERSION;
  operationWriteTime: string;
  expiresAt: string;
  sourceMac: string;
  privateManifestMac: string;
  planMac: string;
  outputSetMac: string;
  digestVersion: "hmac-sha256-v1";
  identitySecretVersion: string;
  integrityMacVersion: "hmac-sha256-v1";
  integritySecretVersion: string;
  identityKeyBaselineMac: string;
  classificationCounts: Readonly<Record<CanonicalMemberImportClassification, number>>;
  preExistingAdmittedStudentCount: number;
  plannedNewStudentCount: number;
  postCutoverAdmittedStudentCount: number;
  reportKeys: readonly MemberReportKey[];
  maximumApprovedRows: typeof MAX_CANONICAL_MEMBER_IMPORT_ROWS;
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  status: "planned";
}>;

export type CanonicalMemberImportPreview = Readonly<{
  classifications: readonly Readonly<{
    rowMac: string;
    classification: CanonicalMemberImportClassification;
  }>[];
  reviewMatches: readonly CanonicalMemberImportReviewMatch[];
  confirmable: boolean;
  receipt: CanonicalMemberImportReceipt;
}>;

export type CanonicalMemberImportReviewMatch = Readonly<{
  rowMac: string;
  sourceName: string;
  candidate: Readonly<{
    studentId: string;
    fullName: string;
    trainingCenter: "Town" | "West";
    membershipReference?: string | undefined;
  }>;
  decision: "pending" | "accepted" | "rejected";
}>;

export type CanonicalMemberImportResult = Readonly<{
  receiptId: string;
  created: number;
  matched: number;
}>;

export type CanonicalMemberImportCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  operationId: string;
  rows: readonly ParsedMemberRow[];
  manifest: unknown;
  now: string;
}>;

export type CanonicalMemberImportConfirmCommand = CanonicalMemberImportCommand &
  Readonly<{ receipt: unknown }>;

export type CanonicalMemberImportService = Readonly<{
  dryRun: (command: CanonicalMemberImportCommand) => Promise<CanonicalMemberImportPreview>;
  confirm: (command: CanonicalMemberImportConfirmCommand) => Promise<CanonicalMemberImportResult>;
}>;

export type CanonicalMemberImportDependencies = Readonly<{
  firestore: MemberDirectoryFirestore;
  scanExistingStudents: (
    transaction: MemberDirectoryTransaction,
    academyId: string,
    limit: number,
  ) => Promise<readonly CanonicalMemberImportExistingStudent[]>;
  projectId: string;
  targetProjectClassification: string;
  identitySecretMaterial: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
  integritySecretVersion: string;
}>;

export class CanonicalMemberImportError extends Error {
  public readonly code:
    "unauthorized" | "invalid" | "unavailable" | "conflict" | "capacity" | "limit" | "replay";

  public constructor(
    code: "unauthorized" | "invalid" | "unavailable" | "conflict" | "capacity" | "limit" | "replay",
    message: string,
  ) {
    super(message);
    this.name = "CanonicalMemberImportError";
    this.code = code;
  }
}

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const administrativeIdentifierPattern = /^[A-Z0-9][A-Z0-9 ./-]{0,63}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/u;
const macPattern = /^[a-f0-9]{64}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const safeIdentifier = z.string().regex(safeIdentifierPattern);
const canonicalText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim() && !controlCharacterPattern.test(value));
const timestamp = z
  .string()
  .regex(utcMillisecondPattern)
  .refine((value) => {
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
  });
const calendarDate = z
  .string()
  .regex(calendarDatePattern)
  .refine((value) => {
    const parsed = Date.parse(value + "T00:00:00.000Z");
    return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
  });
const administrativeIdentifier = canonicalText(64).refine((value) =>
  administrativeIdentifierPattern.test(normalizeAdministrativeIdentifier(value)),
);
const trainingPreferences = z
  .array(z.enum(trainingTimePreferences))
  .min(1)
  .max(trainingTimePreferences.length)
  .refine((values) => new Set(values).size === values.length)
  .readonly();

const sourceRowSchema = z.strictObject({
  sourceReport: z.enum(memberReportKeys),
  sourceRowNumber: z.number().int().positive().max(1_000_000).safe(),
  membershipNumber: administrativeIdentifier.optional(),
  fullName: canonicalText(160),
  email: z
    .string()
    .email()
    .max(320)
    .refine((value) => value === value.trim())
    .optional(),
  idCardNumber: administrativeIdentifier.optional(),
  birthDate: calendarDate.optional(),
  vatNumber: administrativeIdentifier.optional(),
  mobileNumber: canonicalText(64).optional(),
  inactiveAt: calendarDate.optional(),
  membershipStatus: z.enum(["active", "inactive", "suspended"]).optional(),
  paymentStatus: z.literal("regularized").optional(),
});

const manifestEntrySchema = z.strictObject({
  sourceReport: z.enum(memberReportKeys),
  sourceRowNumber: z.number().int().positive().max(1_000_000).safe(),
  targetAcademyId: safeIdentifier,
  classification: z.enum(canonicalMemberImportClassifications),
  trainingCenter: z.enum(trainingCenters).optional(),
  trainingTimePreferences: trainingPreferences.optional(),
  sourceLegacyId: administrativeIdentifier.optional(),
  existingStudentId: safeIdentifier.optional(),
  adminProfileDisposition: z.enum(["create", "existing-compatible"]).optional(),
  reviewedReason: canonicalText(256).optional(),
  familyId: safeIdentifier.optional(),
  relationshipId: safeIdentifier.optional(),
});

const manifestSchema = z.strictObject({
  operationId: safeIdentifier,
  academyId: safeIdentifier,
  operationWriteTime: timestamp,
  expiresAt: timestamp,
  rows: z.array(manifestEntrySchema).min(1).max(MAX_CANONICAL_MEMBER_IMPORT_ROWS).readonly(),
  schemaVersion: z.literal(SCHEMA_VERSION),
});

type ImportManifest = Readonly<z.infer<typeof manifestSchema>>;
type ImportManifestEntry = Readonly<z.infer<typeof manifestEntrySchema>>;

const classificationCountsSchema = z.strictObject(
  Object.fromEntries(
    canonicalMemberImportClassifications.map((classification) => [
      classification,
      z.number().int().nonnegative().max(MAX_CANONICAL_MEMBER_IMPORT_ROWS).safe(),
    ]),
  ) as Record<CanonicalMemberImportClassification, z.ZodNumber>,
);

const receiptBaseShape = {
  receiptId: z.string().regex(/^import-[a-f0-9]{64}$/u),
  operationId: safeIdentifier,
  academyId: safeIdentifier,
  actorId: safeIdentifier,
  projectId: safeIdentifier,
  targetProjectClassification: safeIdentifier,
  codeVersion: z.literal(CODE_VERSION),
  schemaVersion: z.literal(SCHEMA_VERSION),
  operationWriteTime: timestamp,
  expiresAt: timestamp,
  sourceMac: z.string().regex(macPattern),
  privateManifestMac: z.string().regex(macPattern),
  planMac: z.string().regex(macPattern),
  outputSetMac: z.string().regex(macPattern),
  digestVersion: z.literal("hmac-sha256-v1"),
  identitySecretVersion: safeIdentifier,
  integrityMacVersion: z.literal("hmac-sha256-v1"),
  integritySecretVersion: safeIdentifier,
  identityKeyBaselineMac: z.string().regex(macPattern),
  classificationCounts: classificationCountsSchema,
  preExistingAdmittedStudentCount: z.number().int().nonnegative().max(400).safe(),
  plannedNewStudentCount: z.number().int().nonnegative().max(50).safe(),
  postCutoverAdmittedStudentCount: z.number().int().nonnegative().max(400).safe(),
  reportKeys: z
    .array(z.enum(memberReportKeys))
    .min(1)
    .max(memberReportKeys.length)
    .refine((values) => new Set(values).size === values.length)
    .readonly(),
  maximumApprovedRows: z.literal(MAX_CANONICAL_MEMBER_IMPORT_ROWS),
  stateRevisionBefore: z.number().int().nonnegative().safe(),
  stateRevisionAfter: z.number().int().positive().safe(),
} as const;

const plannedReceiptSchema = z.strictObject({
  ...receiptBaseShape,
  status: z.literal("planned"),
});
const completedReceiptSchema = z.strictObject({
  ...receiptBaseShape,
  status: z.literal("completed"),
});
type CompletedReceipt = Readonly<z.infer<typeof completedReceiptSchema>>;

const canonicalPreviewSchema = z
  .strictObject({
    classifications: z
      .array(
        z.strictObject({
          rowMac: z.string().regex(macPattern),
          classification: z.enum(canonicalMemberImportClassifications),
        }),
      )
      .min(1)
      .max(MAX_CANONICAL_MEMBER_IMPORT_ROWS)
      .refine((rows) => new Set(rows.map((row) => row.rowMac)).size === rows.length)
      .readonly(),
    reviewMatches: z
      .array(
        z.strictObject({
          rowMac: z.string().regex(macPattern),
          sourceName: canonicalText(160),
          candidate: z.strictObject({
            studentId: safeIdentifier,
            fullName: canonicalText(160),
            trainingCenter: z.enum(trainingCenters),
            membershipReference: z
              .string()
              .regex(/^\*{4}.{4}$/u)
              .optional(),
          }),
          decision: z.enum(["pending", "accepted", "rejected"]),
        }),
      )
      .max(MAX_CANONICAL_MEMBER_IMPORT_ROWS)
      .refine((rows) => new Set(rows.map((row) => row.rowMac)).size === rows.length)
      .readonly(),
    confirmable: z.boolean(),
    receipt: plannedReceiptSchema,
  })
  .superRefine((preview, context) => {
    const classifications = new Map(
      preview.classifications.map((row) => [row.rowMac, row.classification]),
    );
    for (const [index, match] of preview.reviewMatches.entries()) {
      const classification = classifications.get(match.rowMac);
      const valid =
        match.decision === "accepted"
          ? classification === "same-id-compatible" ||
            classification === "explicit-existing-student-match"
          : classification === "identity-conflict";
      if (!valid) {
        context.addIssue({
          code: "custom",
          path: ["reviewMatches", index, "decision"],
          message: "Review decision does not match the canonical classification",
        });
      }
    }
  });

const canonicalResultSchema = z.strictObject({
  receiptId: z.string().regex(/^import-[a-f0-9]{64}$/u),
  created: z.number().int().nonnegative().max(MAX_CANONICAL_MEMBER_IMPORT_ROWS).safe(),
  matched: z.number().int().nonnegative().max(MAX_CANONICAL_MEMBER_IMPORT_ROWS).safe(),
});

export function parseCanonicalMemberImportPreview(
  value: unknown,
): CanonicalMemberImportPreview | undefined {
  const parsed = canonicalPreviewSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const counts = emptyClassificationCounts();
  for (const row of parsed.data.classifications) counts[row.classification] += 1;
  if (
    !canonicalMemberImportClassifications.every(
      (classification) =>
        counts[classification] === parsed.data.receipt.classificationCounts[classification],
    )
  ) {
    return undefined;
  }
  return Object.freeze(parsed.data);
}

export function parseCanonicalMemberImportResult(
  value: unknown,
): CanonicalMemberImportResult | undefined {
  const parsed = canonicalResultSchema.safeParse(value);
  return parsed.success &&
    parsed.data.created + parsed.data.matched <= MAX_CANONICAL_MEMBER_IMPORT_ROWS
    ? Object.freeze(parsed.data)
    : undefined;
}

type ParsedSourceRow = Readonly<{
  index: number;
  row?: ParsedMemberRow;
  entry: ImportManifestEntry;
  rowMac: string;
}>;

type ExistingStudent = Readonly<{
  studentId: string;
  student: StudentProfile;
  profile?: StudentAdminProfile;
  crossTenant: boolean;
}>;

type KeyCandidate = Readonly<{
  kind: StudentIdentityKeyKind;
  value: string;
  keyId: string;
  stored?: StudentIdentityKey;
  storedInvalid: boolean;
  storedCrossTenant: boolean;
}>;

type PlannedOutput = Readonly<{
  reference: MemberDirectoryDocumentReference;
  data: MemberDirectoryDocumentData;
}>;

type PreparedCommand = Readonly<{
  actor: CanonicalMemberDirectoryActor;
  operationId: string;
  manifest: ImportManifest;
  rows: readonly ParsedSourceRow[];
  reportKeys: readonly MemberReportKey[];
  sourceMac: string;
  privateManifestMac: string;
  now: string;
}>;

type ControlPlane = Readonly<{
  state: MemberDirectoryState;
  guard: MemberDirectoryRestoreGuard;
  event: MemberDirectoryGuardEvent;
  stateRef: MemberDirectoryDocumentReference;
  guardRef: MemberDirectoryDocumentReference;
}>;

type EvaluatedRow = ParsedSourceRow &
  Readonly<{
    classification: CanonicalMemberImportClassification;
    targetStudentId?: string;
    existing?: ExistingStudent;
    candidates: readonly KeyCandidate[];
  }>;

type EvaluatedPlan = Readonly<{
  prepared: PreparedCommand;
  control: ControlPlane;
  rows: readonly EvaluatedRow[];
  outputs: readonly PlannedOutput[];
  receipt: CanonicalMemberImportReceipt;
  confirmable: boolean;
  created: number;
  matched: number;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requiredIdentifier(value: string, label: string): string {
  if (!safeIdentifierPattern.test(value)) {
    throw new CanonicalMemberImportError("invalid", "Invalid " + label);
  }
  return value;
}

function requiredTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (
    !utcMillisecondPattern.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new CanonicalMemberImportError("invalid", "Invalid " + label);
  }
  return value;
}

function requireAuthorizedActor(actor: CanonicalMemberDirectoryActor): void {
  if (!actor.appCheckVerified) {
    throw new CanonicalMemberImportError("unauthorized", "Verified App Check is required");
  }
  if (!actor.active || (actor.role !== "owner" && actor.role !== "administrator")) {
    throw new CanonicalMemberImportError("unauthorized", "Authorized active admin is required");
  }
  requiredIdentifier(actor.actorId, "actor ID");
  requiredIdentifier(actor.academyId, "academy ID");
}

function documentData(snapshot: MemberDirectoryDocumentSnapshot, label: string): unknown {
  const value = snapshot.data();
  if (!snapshot.exists || value === undefined) {
    throw new CanonicalMemberImportError("unavailable", label + " is unavailable");
  }
  return value;
}

function exactTimestampWindow(operationWriteTime: string, expiresAt: string, now: string): void {
  const start = Date.parse(operationWriteTime);
  const expiry = Date.parse(expiresAt);
  const current = Date.parse(now);
  if (
    expiry <= start ||
    expiry - start > MAX_OPERATION_WINDOW_MS ||
    current < start ||
    current > expiry
  ) {
    throw new CanonicalMemberImportError("invalid", "Import manifest time window is invalid");
  }
}

function statePath(academyId: string): string {
  return "academies/" + academyId + "/memberDirectoryStates/current";
}

function guardPath(academyId: string): string {
  return "memberDirectoryRestoreGuards/" + academyId;
}

function guardEventPath(academyId: string, eventId: string): string {
  return "memberDirectoryRestoreGuards/" + academyId + "/events/" + eventId;
}

function actorPath(academyId: string, actorId: string): string {
  return "academies/" + academyId + "/users/" + actorId;
}

function actorRoleLockPath(academyId: string, actorId: string): string {
  return "academies/" + academyId + "/adminRoleLocks/" + actorId;
}

function studentPath(academyId: string, studentId: string): string {
  return "academies/" + academyId + "/students/" + studentId;
}

function profilePath(academyId: string, studentId: string): string {
  return "academies/" + academyId + "/studentAdminProfiles/" + studentId;
}

function keyPath(academyId: string, keyId: string): string {
  return "academies/" + academyId + "/studentIdentityKeys/" + keyId;
}

function familyPath(academyId: string, familyId: string): string {
  return "academies/" + academyId + "/families/" + familyId;
}

function relationshipPath(academyId: string, relationshipId: string): string {
  return "academies/" + academyId + "/relationships/" + relationshipId;
}

function receiptPath(academyId: string, receiptId: string): string {
  return "academies/" + academyId + "/memberDirectoryImportReceipts/" + receiptId;
}

function auditPath(academyId: string, auditId: string): string {
  return "academies/" + academyId + "/auditEvents/" + auditId;
}

function integrityMac(
  dependencies: CanonicalMemberImportDependencies,
  domain: string,
  values: readonly string[],
): string {
  try {
    return createMemberDirectoryIntegrityMac({
      domain,
      values,
      secretMaterial: dependencies.integritySecretMaterial,
    });
  } catch {
    throw new CanonicalMemberImportError("invalid", "Import integrity binding is invalid");
  }
}

function rowReference(value: unknown): string | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (
    typeof value.sourceReport !== "string" ||
    !memberReportKeys.includes(value.sourceReport as MemberReportKey) ||
    typeof value.sourceRowNumber !== "number" ||
    !Number.isSafeInteger(value.sourceRowNumber) ||
    value.sourceRowNumber < 1
  ) {
    return undefined;
  }
  return value.sourceReport + ":" + String(value.sourceRowNumber);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, current]) => current !== undefined));
}

function prepareCommand(
  dependencies: CanonicalMemberImportDependencies,
  command: CanonicalMemberImportCommand,
): PreparedCommand {
  requireAuthorizedActor(command.actor);
  const operationId = requiredIdentifier(command.operationId, "operation ID");
  const now = requiredTimestamp(command.now, "current timestamp");
  if (
    !Array.isArray(command.rows) ||
    command.rows.length === 0 ||
    command.rows.length > MAX_CANONICAL_MEMBER_IMPORT_ROWS
  ) {
    throw new CanonicalMemberImportError("limit", "Canonical member import row limit exceeded");
  }
  const parsedManifest = manifestSchema.safeParse(command.manifest);
  if (
    !parsedManifest.success ||
    parsedManifest.data.operationId !== operationId ||
    parsedManifest.data.academyId !== command.actor.academyId ||
    parsedManifest.data.rows.length !== command.rows.length
  ) {
    throw new CanonicalMemberImportError("invalid", "Private import manifest is invalid");
  }
  exactTimestampWindow(parsedManifest.data.operationWriteTime, parsedManifest.data.expiresAt, now);

  const manifestByReference = new Map<string, ImportManifestEntry>();
  for (const entry of parsedManifest.data.rows) {
    const reference = entry.sourceReport + ":" + String(entry.sourceRowNumber);
    if (manifestByReference.has(reference)) {
      throw new CanonicalMemberImportError("invalid", "Private import manifest is not one-to-one");
    }
    manifestByReference.set(reference, entry);
  }

  const preparedRows: ParsedSourceRow[] = [];
  const reportKeys: MemberReportKey[] = [];
  const rowMacs: string[] = [];
  const seenSourceRows = new Set<string>();
  for (const [index, raw] of command.rows.entries()) {
    const reference = rowReference(raw);
    if (reference === undefined || seenSourceRows.has(reference)) {
      throw new CanonicalMemberImportError("invalid", "Import source row identity is invalid");
    }
    seenSourceRows.add(reference);
    const entry = manifestByReference.get(reference);
    if (entry === undefined) {
      throw new CanonicalMemberImportError("invalid", "Private import manifest is incomplete");
    }
    const parsed = sourceRowSchema.safeParse(raw);
    const normalized = parsed.success
      ? (Object.freeze(withoutUndefined(parsed.data)) as ParsedMemberRow)
      : undefined;
    const rowMac = integrityMac(dependencies, "bpt-canonical-member-import-source-row-v1", [
      command.actor.academyId,
      operationId,
      String(index),
      normalized === undefined ? "invalid-record" : canonicalizeMemberDirectoryValue(normalized),
    ]);
    preparedRows.push(
      Object.freeze({
        index,
        ...(normalized === undefined ? {} : { row: normalized }),
        entry,
        rowMac,
      }),
    );
    rowMacs.push(rowMac);
    if (
      typeof (raw as Partial<ParsedMemberRow>).sourceReport === "string" &&
      memberReportKeys.includes((raw as Partial<ParsedMemberRow>).sourceReport as MemberReportKey)
    ) {
      const report = (raw as Partial<ParsedMemberRow>).sourceReport as MemberReportKey;
      if (!reportKeys.includes(report)) reportKeys.push(report);
    }
  }
  if (manifestByReference.size !== seenSourceRows.size || reportKeys.length === 0) {
    throw new CanonicalMemberImportError("invalid", "Private import manifest is incomplete");
  }
  const sourceMac = integrityMac(dependencies, "bpt-canonical-member-import-source-v1", [
    command.actor.academyId,
    operationId,
    ...rowMacs,
  ]);
  const privateManifestMac = integrityMac(
    dependencies,
    "bpt-canonical-member-import-private-manifest-v1",
    [canonicalizeMemberDirectoryValue(parsedManifest.data)],
  );
  return Object.freeze({
    actor: command.actor,
    operationId,
    manifest: Object.freeze(parsedManifest.data),
    rows: Object.freeze(preparedRows),
    reportKeys: Object.freeze(reportKeys),
    sourceMac,
    privateManifestMac,
    now,
  });
}

async function assertProvisionedActor(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberImportDependencies,
  actor: CanonicalMemberDirectoryActor,
): Promise<void> {
  const [actorSnapshot, roleLockSnapshot] = await Promise.all([
    transaction.get(dependencies.firestore.doc(actorPath(actor.academyId, actor.actorId))),
    transaction.get(dependencies.firestore.doc(actorRoleLockPath(actor.academyId, actor.actorId))),
  ]);
  const actorData = actorSnapshot.data();
  if (
    actorSnapshot.id !== actor.actorId ||
    !actorSnapshot.exists ||
    actorData === undefined ||
    !matchesProvisionedMemberDirectoryActor(actorData, actor) ||
    roleLockSnapshot.id !== actor.actorId ||
    roleLockSnapshot.exists ||
    roleLockSnapshot.data() !== undefined
  ) {
    throw new CanonicalMemberImportError("unauthorized", "Authorized active admin is required");
  }
}

async function readControlPlane(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberImportDependencies,
  academyId: string,
): Promise<ControlPlane> {
  try {
    const stateRef = dependencies.firestore.doc(statePath(academyId));
    const guardRef = dependencies.firestore.doc(guardPath(academyId));
    const [stateSnapshot, guardSnapshot] = await Promise.all([
      transaction.get(stateRef),
      transaction.get(guardRef),
    ]);
    const state = assertCanonicalMemberDirectoryWriterReady(
      documentData(stateSnapshot, "Member directory state"),
      {
        academyId,
        digestVersion: "hmac-sha256-v1",
        secretVersion: dependencies.identitySecretVersion,
      },
    );
    const guard = memberDirectoryRestoreGuardSchema.safeParse(
      documentData(guardSnapshot, "Member directory restore guard"),
    );
    if (!guard.success) throw new Error("Invalid restore guard");
    const eventSnapshot = await transaction.get(
      dependencies.firestore.doc(guardEventPath(academyId, guard.data.lastEventId)),
    );
    const control = assertMemberDirectoryControlPlane({
      projectId: dependencies.projectId,
      state,
      guard: guard.data,
      event: documentData(eventSnapshot, "Member directory guard event"),
      integritySecretMaterial: dependencies.integritySecretMaterial,
      integritySecretVersion: dependencies.integritySecretVersion,
    });
    return Object.freeze({
      state: control.state,
      guard: control.guard,
      event: control.event,
      stateRef,
      guardRef,
    });
  } catch (error) {
    if (error instanceof CanonicalMemberImportError) throw error;
    throw new CanonicalMemberImportError(
      "unavailable",
      "Canonical member directory control is unavailable",
    );
  }
}

function parseExistingStudents(
  values: readonly CanonicalMemberImportExistingStudent[],
  academyId: string,
  effectiveDate: string,
): readonly ExistingStudent[] {
  if (values.length > MAX_EXISTING_STUDENTS) {
    throw new CanonicalMemberImportError("limit", "Existing student scan limit exceeded");
  }
  const seen = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      const studentId = requiredIdentifier(value.studentId, "existing student ID");
      if (seen.has(studentId)) {
        throw new CanonicalMemberImportError(
          "unavailable",
          "Existing student inventory is ambiguous",
        );
      }
      seen.add(studentId);
      const parsedStudent = parseStudentProfileAt(value.student, effectiveDate);
      if (!parsedStudent.ok || parsedStudent.value.studentId !== studentId) {
        throw new CanonicalMemberImportError(
          "unavailable",
          "Existing student inventory is invalid",
        );
      }
      let profile: StudentAdminProfile | undefined;
      if (value.adminProfile !== undefined) {
        const parsedProfile = studentAdminProfileSchema.safeParse(value.adminProfile);
        if (
          !parsedProfile.success ||
          value.profileId !== studentId ||
          parsedProfile.data.studentId !== studentId
        ) {
          throw new CanonicalMemberImportError(
            "unavailable",
            "Existing admin profile inventory is invalid",
          );
        }
        profile = Object.freeze(parsedProfile.data);
      } else if (value.profileId !== undefined) {
        throw new CanonicalMemberImportError(
          "unavailable",
          "Existing admin profile inventory is invalid",
        );
      }
      return Object.freeze({
        studentId,
        student: parsedStudent.value,
        ...(profile === undefined ? {} : { profile }),
        crossTenant:
          parsedStudent.value.academyId !== academyId ||
          (profile !== undefined && profile.academyId !== academyId),
      });
    }),
  );
}

function identityValues(
  row: ParsedMemberRow,
  entry: ImportManifestEntry,
): readonly Readonly<{ kind: StudentIdentityKeyKind; value: string }>[] {
  const values = [
    ["membership-number", row.membershipNumber],
    ["id-card-number", row.idCardNumber],
    ["vat-number", row.vatNumber],
    ["legacy-member-id", entry.sourceLegacyId],
  ] as const;
  return Object.freeze(
    values.flatMap(([kind, value]) =>
      value === undefined ? [] : [Object.freeze({ kind, value })],
    ),
  );
}

async function readKeyCandidates(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
): Promise<readonly (readonly KeyCandidate[])[]> {
  const perRow = prepared.rows.map((source) => {
    if (source.row === undefined) return [] as const;
    return identityValues(source.row, source.entry).map((candidate) => {
      try {
        return Object.freeze({
          ...candidate,
          keyId: deriveStudentIdentityKeyId({
            academyId: prepared.actor.academyId,
            kind: candidate.kind,
            value: candidate.value,
            secretMaterial: dependencies.identitySecretMaterial,
          }),
        });
      } catch {
        throw new CanonicalMemberImportError(
          "invalid",
          "Import administrative identifier is invalid",
        );
      }
    });
  });
  const uniqueIds = [...new Set(perRow.flat().map((candidate) => candidate.keyId))];
  const snapshots = await Promise.all(
    uniqueIds.map((keyId) =>
      transaction.get(dependencies.firestore.doc(keyPath(prepared.actor.academyId, keyId))),
    ),
  );
  const storedById = new Map<
    string,
    Readonly<{
      stored?: StudentIdentityKey;
      storedInvalid: boolean;
      storedCrossTenant: boolean;
    }>
  >();
  uniqueIds.forEach((keyId, index) => {
    const snapshot = snapshots[index];
    if (snapshot === undefined || !snapshot.exists) {
      storedById.set(keyId, {
        storedInvalid: snapshot === undefined || snapshot.data() !== undefined,
        storedCrossTenant: false,
      });
      return;
    }
    const parsed = studentIdentityKeySchema.safeParse(snapshot.data());
    storedById.set(keyId, {
      ...(parsed.success ? { stored: Object.freeze(parsed.data) } : {}),
      storedInvalid:
        !parsed.success || snapshot.id !== keyId || (parsed.success && parsed.data.keyId !== keyId),
      storedCrossTenant: parsed.success && parsed.data.academyId !== prepared.actor.academyId,
    });
  });
  return Object.freeze(
    perRow.map((values) =>
      Object.freeze(
        values.map((candidate) => {
          const stored = storedById.get(candidate.keyId);
          return Object.freeze({
            ...candidate,
            ...(stored?.stored === undefined ? {} : { stored: stored.stored }),
            storedInvalid: stored?.storedInvalid ?? true,
            storedCrossTenant: stored?.storedCrossTenant ?? false,
          });
        }),
      ),
    ),
  );
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function samePreferences(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function studentIsCompatible(
  row: ParsedMemberRow,
  entry: ImportManifestEntry,
  existing: ExistingStudent,
): boolean {
  const student = existing.student;
  return (
    normalizeText(student.fullName) === normalizeText(row.fullName) &&
    student.dateOfBirth === row.birthDate &&
    student.trainingCenter === entry.trainingCenter &&
    entry.trainingTimePreferences !== undefined &&
    samePreferences(student.trainingTimePreferences, entry.trainingTimePreferences) &&
    (row.email === undefined ||
      (student.email !== undefined && normalizeText(student.email) === normalizeText(row.email))) &&
    (row.mobileNumber === undefined || student.phoneNumber === row.mobileNumber)
  );
}

function profileIsCompatible(row: ParsedMemberRow, profile: StudentAdminProfile): boolean {
  const pairs = [
    [row.membershipNumber, profile.membershipNumber],
    [row.idCardNumber, profile.idCardNumber],
    [row.vatNumber, profile.vatNumber],
  ] as const;
  return pairs.every(
    ([source, current]) =>
      source === undefined ||
      (current !== undefined &&
        normalizeAdministrativeIdentifier(source) === normalizeAdministrativeIdentifier(current)),
  );
}

function derivedStudentId(
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
  rowMac: string,
): string {
  return (
    "student-" +
    integrityMac(dependencies, "bpt-canonical-member-import-target-student-v1", [
      prepared.actor.academyId,
      prepared.operationId,
      rowMac,
    ])
  );
}

function receiptId(
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
): string {
  return (
    "import-" +
    integrityMac(dependencies, "bpt-canonical-member-import-receipt-id-v1", [
      prepared.actor.academyId,
      prepared.actor.actorId,
      prepared.operationId,
    ])
  );
}

function auditId(
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
): string {
  return (
    "audit-" +
    integrityMac(dependencies, "bpt-canonical-member-import-audit-id-v1", [
      prepared.actor.academyId,
      prepared.actor.actorId,
      prepared.operationId,
    ])
  );
}

function buildImportedStudent(
  prepared: PreparedCommand,
  source: ParsedSourceRow,
  studentId: string,
): StudentProfile {
  if (
    source.row?.birthDate === undefined ||
    source.entry.trainingCenter === undefined ||
    source.entry.trainingTimePreferences === undefined
  ) {
    throw new CanonicalMemberImportError("invalid", "Import student plan is incomplete");
  }
  const record = {
    studentId,
    academyId: prepared.actor.academyId,
    fullName: source.row.fullName,
    dateOfBirth: source.row.birthDate,
    ...(source.row.mobileNumber === undefined ? {} : { phoneNumber: source.row.mobileNumber }),
    ...(source.row.email === undefined ? {} : { email: source.row.email }),
    trainingCenter: source.entry.trainingCenter,
    trainingTimePreferences: source.entry.trainingTimePreferences,
    participantType: "adult" as const,
    active: false,
    status: "inactive" as const,
    schemaVersion: "1" as const,
    createdAt: prepared.manifest.operationWriteTime,
    createdBy: prepared.actor.actorId,
    updatedAt: prepared.manifest.operationWriteTime,
    updatedBy: prepared.actor.actorId,
  };
  const parsed = parseStudentProfileAt(record, prepared.manifest.operationWriteTime.slice(0, 10));
  if (!parsed.ok) {
    throw new CanonicalMemberImportError("invalid", "Import student plan is invalid");
  }
  return parsed.value;
}

function buildImportedProfile(
  prepared: PreparedCommand,
  source: ParsedSourceRow,
  studentId: string,
): StudentAdminProfile {
  if (source.row === undefined) {
    throw new CanonicalMemberImportError("invalid", "Import profile plan is incomplete");
  }
  const parsed = studentAdminProfileSchema.safeParse({
    studentId,
    academyId: prepared.actor.academyId,
    ...(source.row.membershipNumber === undefined
      ? {}
      : {
          membershipNumber: normalizeAdministrativeIdentifier(source.row.membershipNumber),
        }),
    ...(source.row.idCardNumber === undefined
      ? {}
      : { idCardNumber: normalizeAdministrativeIdentifier(source.row.idCardNumber) }),
    ...(source.row.vatNumber === undefined
      ? {}
      : { vatNumber: normalizeAdministrativeIdentifier(source.row.vatNumber) }),
    gender: "unknown",
    source: "member-pdf-import",
    importRunId: prepared.operationId,
    schemaVersion: "1",
    createdAt: prepared.manifest.operationWriteTime,
    createdBy: prepared.actor.actorId,
    updatedAt: prepared.manifest.operationWriteTime,
    updatedBy: prepared.actor.actorId,
  });
  if (!parsed.success) {
    throw new CanonicalMemberImportError("invalid", "Import profile plan is invalid");
  }
  return Object.freeze(parsed.data);
}

function buildImportedKeys(
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
  source: ParsedSourceRow,
  studentId: string,
): readonly StudentIdentityKey[] {
  if (source.row === undefined) return Object.freeze([]);
  return Object.freeze(
    identityValues(source.row, source.entry).map((candidate) =>
      buildStudentIdentityKey({
        academyId: prepared.actor.academyId,
        kind: candidate.kind,
        value: candidate.value,
        ownerStudentId: studentId,
        secretMaterial: dependencies.identitySecretMaterial,
        secretVersion: dependencies.identitySecretVersion,
        now: prepared.manifest.operationWriteTime,
        actorId: prepared.actor.actorId,
      }),
    ),
  );
}

function outputSetMac(
  dependencies: CanonicalMemberImportDependencies,
  operationId: string,
  outputs: readonly PlannedOutput[],
): string {
  const leaves = outputs
    .map((output) =>
      integrityMac(dependencies, "bpt-member-directory-output-leaf-v1", [
        output.reference.path,
        canonicalizeMemberDirectoryValue(output.data),
      ]),
    )
    .sort();
  return integrityMac(dependencies, "bpt-member-directory-output-root-v1", [
    operationId,
    "canonical-import",
    "1",
    ...leaves,
  ]);
}

function emptyClassificationCounts(): Record<CanonicalMemberImportClassification, number> {
  return Object.fromEntries(
    canonicalMemberImportClassifications.map((classification) => [classification, 0]),
  ) as Record<CanonicalMemberImportClassification, number>;
}

function manifestEntrySupports(
  row: EvaluatedRow,
  participantType: "adult" | "minor" | undefined,
): boolean {
  const entry = row.entry;
  if (entry.classification !== row.classification) return false;
  if (row.classification === "createable-adult") {
    return (
      participantType === "adult" &&
      entry.existingStudentId === undefined &&
      entry.adminProfileDisposition === undefined &&
      entry.reviewedReason === undefined &&
      entry.familyId === undefined &&
      entry.relationshipId === undefined
    );
  }
  if (
    row.classification === "same-id-compatible" ||
    row.classification === "explicit-existing-student-match"
  ) {
    const common =
      entry.existingStudentId !== undefined &&
      entry.adminProfileDisposition !== undefined &&
      entry.reviewedReason !== undefined;
    if (!common) return false;
    if (
      row.classification === "same-id-compatible" &&
      (entry.sourceLegacyId === undefined || entry.sourceLegacyId !== entry.existingStudentId)
    ) {
      return false;
    }
    return participantType !== "minor"
      ? entry.familyId === undefined && entry.relationshipId === undefined
      : entry.familyId !== undefined && entry.relationshipId !== undefined;
  }
  return true;
}

async function readFamilyMatch(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberImportDependencies,
  academyId: string,
  source: ParsedSourceRow,
  existing: ExistingStudent,
): Promise<"ok" | "missing" | "cross-tenant"> {
  const familyId = source.entry.familyId;
  const relationshipId = source.entry.relationshipId;
  if (familyId === undefined || relationshipId === undefined) return "missing";
  const [familySnapshot, relationshipSnapshot] = await Promise.all([
    transaction.get(dependencies.firestore.doc(familyPath(academyId, familyId))),
    transaction.get(dependencies.firestore.doc(relationshipPath(academyId, relationshipId))),
  ]);
  if (!familySnapshot.exists || !relationshipSnapshot.exists) return "missing";
  const familyValue = familySnapshot.data();
  const relationshipValue = relationshipSnapshot.data();
  if (
    isPlainRecord(familyValue) &&
    typeof familyValue.academyId === "string" &&
    familyValue.academyId !== academyId
  ) {
    return "cross-tenant";
  }
  if (
    isPlainRecord(relationshipValue) &&
    typeof relationshipValue.academyId === "string" &&
    relationshipValue.academyId !== academyId
  ) {
    return "cross-tenant";
  }
  const family = parseFamilyRecord(familyValue);
  const relationship = parseFamilyRelationship(relationshipValue);
  if (
    !family.ok ||
    !relationship.ok ||
    family.value.academyId !== academyId ||
    relationship.value.academyId !== academyId
  ) {
    return "missing";
  }
  return family.value.familyId === familyId &&
    family.value.active &&
    family.value.status === "active" &&
    relationship.value.relationshipId === relationshipId &&
    relationship.value.familyId === familyId &&
    relationship.value.studentId === existing.studentId &&
    relationship.value.adultUserId === family.value.primaryContactUserId &&
    relationship.value.active &&
    relationship.value.status === "active" &&
    existing.student.familyId === familyId &&
    existing.student.active &&
    existing.student.status === "active"
    ? "ok"
    : "missing";
}

function candidateOwners(candidates: readonly KeyCandidate[]): ReadonlySet<string> {
  return new Set(
    candidates.flatMap((candidate) =>
      candidate.stored === undefined ? [] : [candidate.stored.ownerStudentId],
    ),
  );
}

async function evaluatePlan(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
): Promise<EvaluatedPlan> {
  const control = await readControlPlane(transaction, dependencies, prepared.actor.academyId);
  const scanned = await dependencies.scanExistingStudents(
    transaction,
    prepared.actor.academyId,
    MAX_EXISTING_STUDENTS + 1,
  );
  if (!Array.isArray(scanned) || scanned.length > MAX_EXISTING_STUDENTS) {
    throw new CanonicalMemberImportError("limit", "Existing student scan limit exceeded");
  }
  const existing = parseExistingStudents(
    scanned,
    prepared.actor.academyId,
    prepared.manifest.operationWriteTime.slice(0, 10),
  );
  if (control.state.rollbackEligibleStudentCount !== existing.length) {
    throw new CanonicalMemberImportError(
      "unavailable",
      "Existing student inventory does not match canonical control",
    );
  }
  const existingById = new Map(existing.map((value) => [value.studentId, value]));
  const globalCrossTenant = existing.some((value) => value.crossTenant);
  const candidates = await readKeyCandidates(transaction, dependencies, prepared);

  const duplicateMembershipRows = new Set<number>();
  const membershipRows = new Map<string, number[]>();
  for (const source of prepared.rows) {
    if (source.row?.membershipNumber === undefined) continue;
    const normalized = normalizeAdministrativeIdentifier(source.row.membershipNumber);
    const indices = membershipRows.get(normalized) ?? [];
    indices.push(source.index);
    membershipRows.set(normalized, indices);
  }
  for (const indices of membershipRows.values()) {
    if (indices.length > 1) indices.forEach((index) => duplicateMembershipRows.add(index));
  }

  const duplicateIdentityRows = new Set<number>();
  const candidateRows = new Map<string, number[]>();
  candidates.forEach((rowCandidates, index) => {
    for (const candidate of rowCandidates) {
      const indices = candidateRows.get(candidate.keyId) ?? [];
      indices.push(index);
      candidateRows.set(candidate.keyId, indices);
    }
  });
  for (const indices of candidateRows.values()) {
    if (indices.length > 1) indices.forEach((index) => duplicateIdentityRows.add(index));
  }
  const duplicateTargetRows = new Set<number>();
  const targetRows = new Map<string, number[]>();
  prepared.rows.forEach((source) => {
    const target = source.entry.existingStudentId;
    if (target === undefined) return;
    const indices = targetRows.get(target) ?? [];
    indices.push(source.index);
    targetRows.set(target, indices);
  });
  for (const indices of targetRows.values()) {
    if (indices.length > 1) indices.forEach((index) => duplicateTargetRows.add(index));
  }

  const newTargetSnapshots = new Map<
    number,
    Readonly<{
      studentId: string;
      student: MemberDirectoryDocumentSnapshot;
      profile: MemberDirectoryDocumentSnapshot;
    }>
  >();
  for (const source of prepared.rows) {
    if (source.row === undefined || source.entry.existingStudentId !== undefined) continue;
    const studentId = derivedStudentId(dependencies, prepared, source.rowMac);
    const [studentSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(dependencies.firestore.doc(studentPath(prepared.actor.academyId, studentId))),
      transaction.get(dependencies.firestore.doc(profilePath(prepared.actor.academyId, studentId))),
    ]);
    newTargetSnapshots.set(
      source.index,
      Object.freeze({
        studentId,
        student: studentSnapshot,
        profile: profileSnapshot,
      }),
    );
  }

  const evaluated: EvaluatedRow[] = [];
  for (const source of prepared.rows) {
    const rowCandidates = candidates[source.index] ?? [];
    const row = source.row;
    let participantType: "adult" | "minor" | undefined;
    let classification: CanonicalMemberImportClassification | undefined;
    let targetStudentId: string | undefined;
    let current: ExistingStudent | undefined;

    if (row === undefined) {
      classification = "invalid-record";
    } else if (
      globalCrossTenant ||
      source.entry.targetAcademyId !== prepared.actor.academyId ||
      rowCandidates.some((candidate) => candidate.storedCrossTenant)
    ) {
      classification = "cross-tenant";
    } else if (duplicateMembershipRows.has(source.index)) {
      classification = "duplicate-membership-number";
    } else if (source.entry.trainingCenter === undefined || row.birthDate === undefined) {
      classification = "missing-required-fields";
    } else {
      try {
        participantType = deriveParticipantType(
          row.birthDate,
          prepared.manifest.operationWriteTime.slice(0, 10),
        );
      } catch {
        classification = "invalid-record";
      }
      if (classification === undefined) {
        const owners = candidateOwners(rowCandidates);
        current =
          source.entry.existingStudentId === undefined
            ? undefined
            : existingById.get(source.entry.existingStudentId);
        const keyInvalid = rowCandidates.some(
          (candidate) =>
            candidate.storedInvalid ||
            (candidate.stored !== undefined &&
              (candidate.stored.secretVersion !== dependencies.identitySecretVersion ||
                candidate.stored.digestVersion !== "hmac-sha256-v1" ||
                !existingById.has(candidate.stored.ownerStudentId))),
        );
        if (
          keyInvalid ||
          duplicateIdentityRows.has(source.index) ||
          duplicateTargetRows.has(source.index) ||
          (source.entry.existingStudentId === undefined &&
            source.entry.sourceLegacyId !== undefined &&
            existingById.has(source.entry.sourceLegacyId)) ||
          owners.size > 1 ||
          (owners.size === 1 &&
            (source.entry.existingStudentId === undefined ||
              !owners.has(source.entry.existingStudentId)))
        ) {
          classification = "identity-conflict";
        } else if (source.entry.existingStudentId !== undefined) {
          if (
            current === undefined ||
            !studentIsCompatible(row, source.entry, current) ||
            (current.profile !== undefined && !profileIsCompatible(row, current.profile)) ||
            (current.profile === undefined &&
              rowCandidates.some((candidate) => candidate.stored !== undefined)) ||
            (current.profile !== undefined &&
              rowCandidates.some((candidate) => candidate.stored === undefined)) ||
            (current.profile === undefined && source.entry.adminProfileDisposition !== "create") ||
            (current.profile !== undefined &&
              source.entry.adminProfileDisposition !== "existing-compatible")
          ) {
            classification = "identity-conflict";
          } else if (participantType === "minor") {
            const familyMatch = await readFamilyMatch(
              transaction,
              dependencies,
              prepared.actor.academyId,
              source,
              current,
            );
            classification =
              familyMatch === "cross-tenant"
                ? "cross-tenant"
                : familyMatch === "ok" && source.entry.reviewedReason !== undefined
                  ? source.entry.sourceLegacyId === current.studentId
                    ? "same-id-compatible"
                    : "explicit-existing-student-match"
                  : "minor-requires-family-match";
          } else if (source.entry.reviewedReason === undefined) {
            classification = "identity-conflict";
          } else {
            classification =
              source.entry.sourceLegacyId === current.studentId
                ? "same-id-compatible"
                : "explicit-existing-student-match";
          }
          targetStudentId = current?.studentId;
        } else if (participantType === "minor") {
          classification = "minor-requires-family-match";
        } else if (owners.size > 0) {
          classification = "identity-conflict";
        } else {
          const target = newTargetSnapshots.get(source.index);
          if (
            target === undefined ||
            target.student.exists ||
            target.profile.exists ||
            source.entry.sourceLegacyId === target.studentId
          ) {
            classification = "identity-conflict";
          } else {
            classification = "createable-adult";
            targetStudentId = target.studentId;
          }
        }
      }
    }
    if (classification === undefined) {
      throw new CanonicalMemberImportError(
        "invalid",
        "Canonical import row classification is unavailable",
      );
    }
    const evaluatedRow: EvaluatedRow = Object.freeze({
      ...source,
      classification,
      ...(targetStudentId === undefined ? {} : { targetStudentId }),
      ...(current === undefined ? {} : { existing: current }),
      candidates: Object.freeze(rowCandidates),
    });
    evaluated.push(evaluatedRow);
  }

  const outputs: PlannedOutput[] = [];
  for (const row of evaluated) {
    if (
      row.classification !== "createable-adult" &&
      row.classification !== "same-id-compatible" &&
      row.classification !== "explicit-existing-student-match"
    ) {
      continue;
    }
    if (row.targetStudentId === undefined || row.row === undefined) {
      throw new CanonicalMemberImportError("invalid", "Eligible import row is incomplete");
    }
    if (row.classification === "createable-adult") {
      outputs.push(
        Object.freeze({
          reference: dependencies.firestore.doc(
            studentPath(prepared.actor.academyId, row.targetStudentId),
          ),
          data: buildImportedStudent(prepared, row, row.targetStudentId),
        }),
      );
    }
    if (
      row.classification === "createable-adult" ||
      row.entry.adminProfileDisposition === "create"
    ) {
      outputs.push(
        Object.freeze({
          reference: dependencies.firestore.doc(
            profilePath(prepared.actor.academyId, row.targetStudentId),
          ),
          data: buildImportedProfile(prepared, row, row.targetStudentId),
        }),
      );
      for (const key of buildImportedKeys(dependencies, prepared, row, row.targetStudentId)) {
        outputs.push(
          Object.freeze({
            reference: dependencies.firestore.doc(keyPath(prepared.actor.academyId, key.keyId)),
            data: key,
          }),
        );
      }
    }
  }
  const outputPaths = outputs.map((output) => output.reference.path);
  if (
    new Set(outputPaths).size !== outputPaths.length ||
    outputs.length + 5 > MAX_TRANSACTION_WRITES ||
    Buffer.byteLength(
      outputs.map((output) => canonicalizeMemberDirectoryValue(output.data)).join(""),
      "utf8",
    ) > MAX_OUTPUT_BYTES
  ) {
    throw new CanonicalMemberImportError("limit", "Canonical import transaction budget exceeded");
  }

  const counts = emptyClassificationCounts();
  for (const row of evaluated) counts[row.classification] += 1;
  const created = counts["createable-adult"];
  const matched = counts["same-id-compatible"] + counts["explicit-existing-student-match"];
  const postCutoverCount = existing.length + created;
  if (postCutoverCount > control.state.rollbackCapacityLimit) {
    throw new CanonicalMemberImportError(
      "capacity",
      "Member directory rollback capacity is exhausted",
    );
  }
  const manifestConsistent = evaluated.every((row) => {
    let participantType: "adult" | "minor" | undefined;
    if (row.row?.birthDate !== undefined) {
      try {
        participantType = deriveParticipantType(
          row.row.birthDate,
          prepared.manifest.operationWriteTime.slice(0, 10),
        );
      } catch {
        participantType = undefined;
      }
    }
    return manifestEntrySupports(row, participantType);
  });
  const eligibleCount = created + matched;
  const confirmable = manifestConsistent && eligibleCount === evaluated.length;
  const generatedReceiptId = receiptId(dependencies, prepared);
  const generatedOutputSetMac = outputSetMac(dependencies, prepared.operationId, outputs);
  const receiptWithoutPlanMac = {
    receiptId: generatedReceiptId,
    operationId: prepared.operationId,
    academyId: prepared.actor.academyId,
    actorId: prepared.actor.actorId,
    projectId: dependencies.projectId,
    targetProjectClassification: dependencies.targetProjectClassification,
    codeVersion: CODE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    operationWriteTime: prepared.manifest.operationWriteTime,
    expiresAt: prepared.manifest.expiresAt,
    sourceMac: prepared.sourceMac,
    privateManifestMac: prepared.privateManifestMac,
    outputSetMac: generatedOutputSetMac,
    digestVersion: "hmac-sha256-v1" as const,
    identitySecretVersion: dependencies.identitySecretVersion,
    integrityMacVersion: "hmac-sha256-v1" as const,
    integritySecretVersion: dependencies.integritySecretVersion,
    identityKeyBaselineMac: control.state.identityKeyBaselineMac,
    classificationCounts: Object.freeze(counts),
    preExistingAdmittedStudentCount: existing.length,
    plannedNewStudentCount: created,
    postCutoverAdmittedStudentCount: postCutoverCount,
    reportKeys: prepared.reportKeys,
    maximumApprovedRows: MAX_CANONICAL_MEMBER_IMPORT_ROWS,
    stateRevisionBefore: control.state.stateRevision,
    stateRevisionAfter: control.state.stateRevision + 1,
    status: "planned" as const,
  };
  if (receiptWithoutPlanMac.identityKeyBaselineMac === undefined) {
    throw new CanonicalMemberImportError("unavailable", "Identity key baseline is unavailable");
  }
  const generatedPlanMac = integrityMac(dependencies, "bpt-canonical-member-import-plan-v1", [
    canonicalizeMemberDirectoryValue(receiptWithoutPlanMac),
    manifestConsistent ? "manifest-consistent" : "manifest-divergent",
  ]);
  const receipt = plannedReceiptSchema.parse({
    ...receiptWithoutPlanMac,
    planMac: generatedPlanMac,
  }) as CanonicalMemberImportReceipt;
  return Object.freeze({
    prepared,
    control,
    rows: Object.freeze(evaluated),
    outputs: Object.freeze(outputs),
    receipt: Object.freeze(receipt),
    confirmable,
    created,
    matched,
  });
}

function sameReceipt(
  left: CanonicalMemberImportReceipt,
  right: CanonicalMemberImportReceipt,
): boolean {
  return (
    constantTimeMacEquals(left.planMac, right.planMac) &&
    canonicalizeMemberDirectoryValue(left) === canonicalizeMemberDirectoryValue(right)
  );
}

function auditDraft(
  prepared: PreparedCommand,
  receipt: CanonicalMemberImportReceipt,
): AuditEventDraft {
  const parsed = parseAuditEventDraft({
    academyId: prepared.actor.academyId,
    actorId: prepared.actor.actorId,
    action: "member.import.confirmed",
    targetRef: receiptPath(prepared.actor.academyId, receipt.receiptId),
    purpose: "confirmed canonical member PDF import",
    correlationId: receipt.receiptId,
    imported: receipt.classificationCounts["createable-adult"],
    updated:
      receipt.classificationCounts["same-id-compatible"] +
      receipt.classificationCounts["explicit-existing-student-match"],
    conflicts: 0,
    sourceHash: receipt.sourceMac,
    reportKeys: receipt.reportKeys,
  });
  if (!parsed.ok) {
    throw new CanonicalMemberImportError("invalid", "Import audit event is invalid");
  }
  return parsed.value;
}

function outputsFromReviewedManifest(
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
): readonly PlannedOutput[] {
  const outputs: PlannedOutput[] = [];
  for (const source of prepared.rows) {
    if (
      source.row === undefined ||
      (source.entry.classification !== "createable-adult" &&
        source.entry.classification !== "same-id-compatible" &&
        source.entry.classification !== "explicit-existing-student-match")
    ) {
      continue;
    }
    const targetStudentId =
      source.entry.classification === "createable-adult"
        ? derivedStudentId(dependencies, prepared, source.rowMac)
        : source.entry.existingStudentId;
    if (targetStudentId === undefined) {
      throw new CanonicalMemberImportError("replay", "Import replay target is invalid");
    }
    if (source.entry.classification === "createable-adult") {
      outputs.push({
        reference: dependencies.firestore.doc(
          studentPath(prepared.actor.academyId, targetStudentId),
        ),
        data: buildImportedStudent(prepared, source, targetStudentId),
      });
    }
    if (
      source.entry.classification === "createable-adult" ||
      source.entry.adminProfileDisposition === "create"
    ) {
      outputs.push({
        reference: dependencies.firestore.doc(
          profilePath(prepared.actor.academyId, targetStudentId),
        ),
        data: buildImportedProfile(prepared, source, targetStudentId),
      });
      for (const key of buildImportedKeys(dependencies, prepared, source, targetStudentId)) {
        outputs.push({
          reference: dependencies.firestore.doc(keyPath(prepared.actor.academyId, key.keyId)),
          data: key,
        });
      }
    }
  }
  return Object.freeze(outputs.map((output) => Object.freeze(output)));
}

function validatePresentedReceipt(
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
  value: unknown,
): CanonicalMemberImportReceipt {
  const parsed = plannedReceiptSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.operationId !== prepared.operationId ||
    parsed.data.academyId !== prepared.actor.academyId ||
    parsed.data.actorId !== prepared.actor.actorId ||
    parsed.data.projectId !== dependencies.projectId ||
    parsed.data.targetProjectClassification !== dependencies.targetProjectClassification ||
    parsed.data.sourceMac !== prepared.sourceMac ||
    parsed.data.privateManifestMac !== prepared.privateManifestMac ||
    parsed.data.identitySecretVersion !== dependencies.identitySecretVersion ||
    parsed.data.integritySecretVersion !== dependencies.integritySecretVersion ||
    parsed.data.operationWriteTime !== prepared.manifest.operationWriteTime ||
    parsed.data.expiresAt !== prepared.manifest.expiresAt ||
    parsed.data.stateRevisionAfter !== parsed.data.stateRevisionBefore + 1
  ) {
    throw new CanonicalMemberImportError("replay", "Import receipt is invalid");
  }
  const receipt = Object.freeze(parsed.data) as CanonicalMemberImportReceipt;
  const { planMac: storedPlanMac, ...withoutPlanMac } = receipt;
  const expectedPlanMac = integrityMac(dependencies, "bpt-canonical-member-import-plan-v1", [
    canonicalizeMemberDirectoryValue(withoutPlanMac),
    "manifest-consistent",
  ]);
  if (!constantTimeMacEquals(storedPlanMac, expectedPlanMac)) {
    throw new CanonicalMemberImportError("replay", "Import receipt is divergent");
  }
  const outputs = outputsFromReviewedManifest(dependencies, prepared);
  const expectedOutputSetMac = outputSetMac(dependencies, prepared.operationId, outputs);
  if (!constantTimeMacEquals(receipt.outputSetMac, expectedOutputSetMac)) {
    throw new CanonicalMemberImportError("replay", "Import output plan is divergent");
  }
  return receipt;
}

function invalidMatchedReplay(): never {
  throw new CanonicalMemberImportError(
    "replay",
    "Completed import matched target replay is invalid",
  );
}

async function assertMatchedReplayTargets(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
): Promise<void> {
  for (const source of prepared.rows) {
    if (
      source.entry.classification !== "same-id-compatible" &&
      source.entry.classification !== "explicit-existing-student-match"
    ) {
      continue;
    }
    const row = source.row;
    const studentId = source.entry.existingStudentId;
    if (row === undefined || studentId === undefined) invalidMatchedReplay();

    const studentSnapshot = await transaction.get(
      dependencies.firestore.doc(studentPath(prepared.actor.academyId, studentId)),
    );
    const studentData = studentSnapshot.data();
    if (studentSnapshot.id !== studentId || !studentSnapshot.exists || studentData === undefined) {
      invalidMatchedReplay();
    }

    let profileData: MemberDirectoryDocumentData | undefined;
    if (source.entry.adminProfileDisposition === "existing-compatible") {
      const profileSnapshot = await transaction.get(
        dependencies.firestore.doc(profilePath(prepared.actor.academyId, studentId)),
      );
      profileData = profileSnapshot.data();
      if (
        profileSnapshot.id !== studentId ||
        !profileSnapshot.exists ||
        profileData === undefined
      ) {
        invalidMatchedReplay();
      }
    }

    let existing: ExistingStudent | undefined;
    try {
      [existing] = parseExistingStudents(
        [
          Object.freeze({
            studentId,
            student: studentData,
            ...(profileData === undefined
              ? {}
              : { profileId: studentId, adminProfile: profileData }),
          }),
        ],
        prepared.actor.academyId,
        prepared.manifest.operationWriteTime.slice(0, 10),
      );
    } catch {
      invalidMatchedReplay();
    }
    if (
      existing === undefined ||
      existing.crossTenant ||
      !studentIsCompatible(row, source.entry, existing) ||
      (source.entry.adminProfileDisposition === "existing-compatible" &&
        (existing.profile === undefined || !profileIsCompatible(row, existing.profile)))
    ) {
      invalidMatchedReplay();
    }

    let participantType: "adult" | "minor";
    try {
      participantType = deriveParticipantType(
        row.birthDate ?? "",
        prepared.manifest.operationWriteTime.slice(0, 10),
      );
    } catch {
      invalidMatchedReplay();
    }
    if (
      !manifestEntrySupports(
        { ...source, classification: source.entry.classification, candidates: [] },
        participantType,
      )
    ) {
      invalidMatchedReplay();
    }
    if (
      participantType === "minor" &&
      (await readFamilyMatch(
        transaction,
        dependencies,
        prepared.actor.academyId,
        source,
        existing,
      )) !== "ok"
    ) {
      invalidMatchedReplay();
    }

    if (source.entry.adminProfileDisposition === "existing-compatible") {
      for (const candidate of identityValues(row, source.entry)) {
        const keyId = deriveStudentIdentityKeyId({
          academyId: prepared.actor.academyId,
          kind: candidate.kind,
          value: candidate.value,
          secretMaterial: dependencies.identitySecretMaterial,
        });
        const keySnapshot = await transaction.get(
          dependencies.firestore.doc(keyPath(prepared.actor.academyId, keyId)),
        );
        const key = studentIdentityKeySchema.safeParse(keySnapshot.data());
        if (
          keySnapshot.id !== keyId ||
          !keySnapshot.exists ||
          !key.success ||
          key.data.keyId !== keyId ||
          key.data.academyId !== prepared.actor.academyId ||
          key.data.kind !== candidate.kind ||
          key.data.ownerStudentId !== studentId ||
          key.data.digestVersion !== "hmac-sha256-v1" ||
          key.data.secretVersion !== dependencies.identitySecretVersion
        ) {
          invalidMatchedReplay();
        }
      }
    }
  }
}

async function resolveReplay(
  transaction: MemberDirectoryTransaction,
  dependencies: CanonicalMemberImportDependencies,
  prepared: PreparedCommand,
  presented: CanonicalMemberImportReceipt,
  storedValue: unknown,
): Promise<CanonicalMemberImportResult> {
  const stored = completedReceiptSchema.safeParse(storedValue);
  const expectedCompleted = completedReceiptSchema.parse({
    ...presented,
    status: "completed",
  });
  if (
    !stored.success ||
    !constantTimeMacEquals(stored.data.planMac, expectedCompleted.planMac) ||
    canonicalizeMemberDirectoryValue(stored.data) !==
      canonicalizeMemberDirectoryValue(expectedCompleted)
  ) {
    throw new CanonicalMemberImportError("replay", "Divergent import confirmation replay");
  }
  const outputs = outputsFromReviewedManifest(dependencies, prepared);
  const outputSnapshots = await Promise.all(
    outputs.map((output) => transaction.get(output.reference)),
  );
  for (const [index, output] of outputs.entries()) {
    const snapshot = outputSnapshots[index];
    if (
      snapshot === undefined ||
      !snapshot.exists ||
      snapshot.id !== output.reference.id ||
      snapshot.data() === undefined ||
      canonicalizeMemberDirectoryValue(snapshot.data()) !==
        canonicalizeMemberDirectoryValue(output.data)
    ) {
      throw new CanonicalMemberImportError("replay", "Completed import output replay is invalid");
    }
  }
  await assertMatchedReplayTargets(transaction, dependencies, prepared);
  const generatedAuditId = auditId(dependencies, prepared);
  const auditSnapshot = await transaction.get(
    dependencies.firestore.doc(auditPath(prepared.actor.academyId, generatedAuditId)),
  );
  if (
    !auditSnapshot.exists ||
    !matchesAuditEventReplay(
      auditSnapshot.data(),
      generatedAuditId,
      auditDraft(prepared, presented),
    )
  ) {
    throw new CanonicalMemberImportError("replay", "Completed import audit replay is invalid");
  }
  return Object.freeze({
    receiptId: presented.receiptId,
    created: presented.classificationCounts["createable-adult"],
    matched:
      presented.classificationCounts["same-id-compatible"] +
      presented.classificationCounts["explicit-existing-student-match"],
  });
}

export function createCanonicalMemberImportService(
  dependencies: CanonicalMemberImportDependencies,
): CanonicalMemberImportService {
  requiredIdentifier(dependencies.projectId, "project ID");
  requiredIdentifier(dependencies.targetProjectClassification, "target project classification");
  requiredIdentifier(dependencies.identitySecretVersion, "identity secret version");
  requiredIdentifier(dependencies.integritySecretVersion, "integrity secret version");
  const identity = decodeMemberDirectorySecret(dependencies.identitySecretMaterial, "identity");
  const integrity = decodeMemberDirectorySecret(dependencies.integritySecretMaterial, "integrity");
  if (
    identity.length === integrity.length &&
    constantTimeMacEquals(
      createMemberDirectoryIntegrityMac({
        domain: "bpt-canonical-import-secret-distinct-v1",
        values: [],
        secretMaterial: dependencies.identitySecretMaterial,
      }),
      createMemberDirectoryIntegrityMac({
        domain: "bpt-canonical-import-secret-distinct-v1",
        values: [],
        secretMaterial: dependencies.integritySecretMaterial,
      }),
    )
  ) {
    throw new CanonicalMemberImportError("invalid", "Purpose secrets must be distinct");
  }

  return Object.freeze({
    async dryRun(command) {
      const prepared = prepareCommand(dependencies, command);
      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertProvisionedActor(transaction, dependencies, prepared.actor);
        const plan = await evaluatePlan(transaction, dependencies, prepared);
        return Object.freeze({
          classifications: Object.freeze(
            plan.rows.map((row) =>
              Object.freeze({
                rowMac: row.rowMac,
                classification: row.classification,
              }),
            ),
          ),
          reviewMatches: Object.freeze([]),
          confirmable: plan.confirmable,
          receipt: plan.receipt,
        });
      });
    },

    async confirm(command) {
      const prepared = prepareCommand(dependencies, command);
      const presented = validatePresentedReceipt(dependencies, prepared, command.receipt);
      const storedReceiptRef = dependencies.firestore.doc(
        receiptPath(prepared.actor.academyId, presented.receiptId),
      );
      return dependencies.firestore.runTransaction(async (transaction) => {
        await assertProvisionedActor(transaction, dependencies, prepared.actor);
        const storedReceipt = await transaction.get(storedReceiptRef);
        if (storedReceipt.exists) {
          return resolveReplay(
            transaction,
            dependencies,
            prepared,
            presented,
            storedReceipt.data(),
          );
        }
        if (storedReceipt.data() !== undefined) {
          throw new CanonicalMemberImportError("replay", "Import receipt absence is invalid");
        }
        const plan = await evaluatePlan(transaction, dependencies, prepared);
        if (!sameReceipt(plan.receipt, presented)) {
          throw new CanonicalMemberImportError(
            "replay",
            "Import receipt no longer matches the canonical plan",
          );
        }
        if (!plan.confirmable) {
          throw new CanonicalMemberImportError(
            "conflict",
            "Canonical member import contains conflicts",
          );
        }
        const nextState: MemberDirectoryState = {
          ...plan.control.state,
          stateRevision: plan.control.state.stateRevision + 1,
          rollbackEligibleStudentCount:
            plan.control.state.rollbackEligibleStudentCount + plan.created,
          updatedAt: prepared.manifest.operationWriteTime,
          updatedBy: prepared.actor.actorId,
        };
        let nextControl;
        try {
          nextControl = advanceMemberDirectoryControlPlane({
            projectId: dependencies.projectId,
            state: plan.control.state,
            guard: plan.control.guard,
            event: plan.control.event,
            nextState,
            operationId: presented.receiptId,
            transitionKind:
              plan.created > 0 ? "canonical-identity-create" : "canonical-identity-update",
            integritySecretMaterial: dependencies.integritySecretMaterial,
            integritySecretVersion: dependencies.integritySecretVersion,
            now: prepared.manifest.operationWriteTime,
            actorId: prepared.actor.actorId,
          });
        } catch {
          throw new CanonicalMemberImportError(
            "unavailable",
            "Canonical member directory transition is unavailable",
          );
        }
        const completed: CompletedReceipt = completedReceiptSchema.parse({
          ...presented,
          status: "completed",
        });
        for (const output of plan.outputs) {
          transaction.create(output.reference, output.data);
        }
        transaction.set(plan.control.stateRef, nextState);
        transaction.set(plan.control.guardRef, nextControl.guard);
        transaction.create(
          dependencies.firestore.doc(
            guardEventPath(prepared.actor.academyId, nextControl.event.eventId),
          ),
          nextControl.event,
        );
        const generatedAuditId = auditId(dependencies, prepared);
        appendAuditEventInTransaction(
          transaction,
          dependencies.firestore.doc(auditPath(prepared.actor.academyId, generatedAuditId)),
          auditDraft(prepared, presented),
        );
        transaction.create(storedReceiptRef, completed);
        return Object.freeze({
          receiptId: presented.receiptId,
          created: plan.created,
          matched: plan.matched,
        });
      });
    },
  });
}
