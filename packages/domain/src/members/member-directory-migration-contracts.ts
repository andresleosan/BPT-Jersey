import { z } from "zod";

import { memberDirectoryOperationPhases } from "./member-directory-contracts";

/**
 * Contracts for the member directory v1 migration operations (T108).
 *
 * These are the pieces every executor needs before any of them can exist: how a legacy row is
 * classified, how a chunk is named and bounded, and what a receipt is allowed to contain. The
 * executors themselves are not here.
 *
 * Two rules from `docs/data/migrations/member-directory-v1.md` are load-bearing and are enforced
 * structurally rather than by convention:
 *
 * - Receipts and chunks carry no personal data. Every schema below is a `strictObject` over an
 *   explicit field list, so a name, membership number or raw source value cannot be added by
 *   accident - it fails parsing (invariant 18).
 * - Capacity is decided before any write, from the plan, never from the source row count
 *   (invariant 30 and the forward dry-run bound).
 */

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const macPattern = /^[a-f0-9]{64}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const opaqueIdentifierSchema = z.string().regex(identifierPattern);
const macSchema = z.string().regex(macPattern);
const auditDateTimeSchema = z
  .string()
  .regex(utcMillisecondPattern)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  }, "Expected an RFC 3339 UTC timestamp with millisecond precision");

/**
 * Every legacy row receives exactly one of these. The names are the non-PII vocabulary the receipt
 * is allowed to count by; they never carry the value that caused the classification.
 */
export const memberDirectoryDryRunClassifications = Object.freeze([
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

export type MemberDirectoryDryRunClassification =
  (typeof memberDirectoryDryRunClassifications)[number];

/**
 * `same-id-compatible` is deliberately absent: it is eligible only after an explicit human review,
 * so it cannot be derived from the classification alone. Asking for eligibility without saying
 * whether the row was reviewed is a question with no safe default, which is why
 * `isWriteEligibleClassification` takes the review flag rather than defaulting it.
 */
const unconditionallyEligible: ReadonlySet<MemberDirectoryDryRunClassification> = new Set([
  "explicit-existing-student-match",
  "createable-adult",
]);

export function isWriteEligibleClassification(
  classification: MemberDirectoryDryRunClassification,
  options: Readonly<{ explicitlyReviewed: boolean }>,
): boolean {
  if (classification === "same-id-compatible") {
    return options.explicitlyReviewed;
  }
  return unconditionallyEligible.has(classification);
}

/**
 * The phases that own chunks. `idle` never does, and the three restore phases are backup v3's, not
 * a migration operation's.
 */
export const memberDirectoryMigrationPhases = Object.freeze([
  "bootstrap",
  "identity-reconcile",
  "forward",
  "compensation",
  "rollback-projection",
  "rollback-readonly",
  "canonical-recovery",
] as const);

export type MemberDirectoryMigrationPhase = (typeof memberDirectoryMigrationPhases)[number];

const migrationPhaseSchema = z.enum(memberDirectoryMigrationPhases);

/** Every migration phase must also be a phase the control-plane state machine knows about. */
const knownOperationPhases: ReadonlySet<string> = new Set(memberDirectoryOperationPhases);
for (const phase of memberDirectoryMigrationPhases) {
  if (!knownOperationPhases.has(phase)) {
    throw new Error(`Unknown member directory operation phase: ${phase}`);
  }
}

/** Chunk numbers start at 1 per phase, not at 0: 0 is the "no chunk committed" state value. */
const chunkNoSchema = z.number().int().positive().safe();

export const memberDirectoryChunkIdSchema = z.string().refine((value) => {
  const segments = value.split(":");
  if (segments.length !== 3) {
    return false;
  }
  const [operationId, phase, chunkNo] = segments;
  return (
    opaqueIdentifierSchema.safeParse(operationId).success &&
    migrationPhaseSchema.safeParse(phase).success &&
    /^[1-9][0-9]{0,14}$/u.test(chunkNo ?? "")
  );
}, "Expected a chunk ID of the form {operationId}:{phase}:{chunkNo}");

export function buildMemberDirectoryChunkId(
  input: Readonly<{
    operationId: string;
    phase: MemberDirectoryMigrationPhase;
    chunkNo: number;
  }>,
): string {
  const operationId = opaqueIdentifierSchema.parse(input.operationId);
  const phase = migrationPhaseSchema.parse(input.phase);
  const chunkNo = chunkNoSchema.parse(input.chunkNo);
  return `${operationId}:${phase}:${String(chunkNo)}`;
}

export function parseMemberDirectoryChunkId(value: string): Readonly<{
  operationId: string;
  phase: MemberDirectoryMigrationPhase;
  chunkNo: number;
}> {
  memberDirectoryChunkIdSchema.parse(value);
  const [operationId, phase, chunkNo] = value.split(":") as [
    string,
    MemberDirectoryMigrationPhase,
    string,
  ];
  return Object.freeze({ operationId, phase, chunkNo: Number(chunkNo) });
}

/**
 * A chunk receipt stores counts and one output MAC, never IDs or payloads, so that compensation can
 * rederive and verify targets from the private plan without any of that living in Firestore.
 */
export const memberDirectoryChunkReceiptSchema = z.strictObject({
  chunkId: memberDirectoryChunkIdSchema,
  operationId: opaqueIdentifierSchema,
  academyId: opaqueIdentifierSchema,
  phase: migrationPhaseSchema,
  chunkNo: chunkNoSchema,
  outputSetMac: macSchema,
  writtenCount: z.number().int().nonnegative().safe(),
  quarantinedCount: z.number().int().nonnegative().safe(),
  integrityMacVersion: z.literal("hmac-sha256-v1"),
  integritySecretVersion: opaqueIdentifierSchema,
  schemaVersion: z.literal("1"),
  createdAt: auditDateTimeSchema,
  createdBy: opaqueIdentifierSchema,
});

export type MemberDirectoryChunkReceipt = Readonly<
  z.infer<typeof memberDirectoryChunkReceiptSchema>
>;

const countSchema = z.number().int().nonnegative().safe();

/**
 * Spelled out rather than derived from the classification list: `satisfies` then makes adding a
 * classification a compile error here, which is the reminder you want - a new classification that
 * nothing counts is a silent hole in the receipt.
 */
const classificationCountsShape = {
  "same-id-compatible": countSchema,
  "explicit-existing-student-match": countSchema,
  "createable-adult": countSchema,
  "minor-requires-family-match": countSchema,
  "missing-required-fields": countSchema,
  "identity-conflict": countSchema,
  "duplicate-membership-number": countSchema,
  "cross-tenant": countSchema,
  "invalid-record": countSchema,
} satisfies Record<MemberDirectoryDryRunClassification, typeof countSchema>;

/**
 * The dry-run receipt. `strictObject` over exactly the fields the spec lists is what keeps a name,
 * an email or a membership number from ever reaching it.
 */
export const memberDirectoryOperationReceiptSchema = z
  .strictObject({
    operationId: opaqueIdentifierSchema,
    academyId: opaqueIdentifierSchema,
    phase: migrationPhaseSchema,
    targetProjectClassification: z.enum(["emulator", "staging", "production"]),
    codeVersion: opaqueIdentifierSchema,
    schemaVersion: z.literal("1"),
    effectiveDate: auditDateTimeSchema,
    expiresAt: auditDateTimeSchema,
    sourceMac: macSchema,
    privateManifestMac: macSchema,
    planMac: macSchema,
    digestVersion: z.literal("hmac-sha256-v1"),
    secretVersion: opaqueIdentifierSchema,
    identityKeyBaselineMac: macSchema,
    expectedOutputSetMacRoots: z.array(macSchema).max(1000),
    classificationCounts: z.strictObject(classificationCountsShape),
    preExistingAdmittedStudentCount: z.number().int().nonnegative().max(401).safe(),
    plannedNewStudentCount: z.number().int().nonnegative().max(401).safe(),
    postCutoverAdmittedStudentCount: z.number().int().nonnegative().max(401).safe(),
    maximumApprovedRows: z.number().int().nonnegative().safe(),
    integrityMacVersion: z.literal("hmac-sha256-v1"),
    integritySecretVersion: opaqueIdentifierSchema,
    operationWriteTime: auditDateTimeSchema,
    createdAt: auditDateTimeSchema,
    createdBy: opaqueIdentifierSchema,
  })
  .superRefine((receipt, context) => {
    if (Date.parse(receipt.expiresAt) <= Date.parse(receipt.effectiveDate)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Receipt expiry must be after its effective date",
      });
    }
    const capacity = assertForwardCapacityResult({
      preExistingAdmittedStudentCount: receipt.preExistingAdmittedStudentCount,
      plannedNewStudentCount: receipt.plannedNewStudentCount,
      postCutoverAdmittedStudentCount: receipt.postCutoverAdmittedStudentCount,
    });
    if (capacity !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["postCutoverAdmittedStudentCount"],
        message: capacity,
      });
    }
  });

export type MemberDirectoryOperationReceipt = Readonly<
  z.infer<typeof memberDirectoryOperationReceiptSchema>
>;

export const memberDirectoryRollbackCapacityLimit = 400;

function assertForwardCapacityResult(
  counts: Readonly<{
    preExistingAdmittedStudentCount: number;
    plannedNewStudentCount: number;
    postCutoverAdmittedStudentCount: number;
  }>,
): string | undefined {
  const sum = counts.preExistingAdmittedStudentCount + counts.plannedNewStudentCount;
  if (sum !== counts.postCutoverAdmittedStudentCount) {
    return "Post-cutover admitted students must equal pre-existing plus planned new";
  }
  if (counts.postCutoverAdmittedStudentCount > memberDirectoryRollbackCapacityLimit) {
    return `Post-cutover admitted students must not exceed ${String(memberDirectoryRollbackCapacityLimit)}`;
  }
  return undefined;
}

/**
 * The forward dry-run capacity bound. It is a plan-level check on purpose: 399 existing plus two
 * creates is rejected here, before any freeze or write, rather than discovered at row 400.
 */
export function assertForwardCapacity(
  counts: Readonly<{
    preExistingAdmittedStudentCount: number;
    plannedNewStudentCount: number;
    postCutoverAdmittedStudentCount: number;
  }>,
): void {
  const failure = assertForwardCapacityResult(counts);
  if (failure !== undefined) {
    throw new Error(failure);
  }
}

/**
 * Chunk numbers must start at 1 and advance without gaps within a phase. A gap means a chunk was
 * lost or replayed out of order, and the spec's convergence rule requires failing closed rather
 * than continuing over the hole.
 */
export function assertChunkSequence(chunkNos: readonly number[]): void {
  chunkNos.forEach((chunkNo, index) => {
    const expected = index + 1;
    if (chunkNoSchema.safeParse(chunkNo).success === false || chunkNo !== expected) {
      throw new Error(
        `Member directory chunk sequence must start at 1 and advance without gaps; expected ${String(expected)} but found ${String(chunkNo)}`,
      );
    }
  });
}
