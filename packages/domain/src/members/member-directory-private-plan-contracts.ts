import { z } from "zod";

import {
  assertChunkSequence,
  isWriteEligibleClassification,
  memberDirectoryDryRunClassifications,
  type MemberDirectoryDryRunClassification,
  type MemberDirectoryOperationReceipt,
} from "./member-directory-migration-contracts";
import { trainingTimePreferences } from "../profiles/profile-contracts";

import {
  memberDirectoryMaxChunksPerOperation,
  memberDirectoryMaxRowsPerChunk,
  memberDirectoryMaxRowsPerOperation,
} from "./member-directory-transitions";

/**
 * The frozen private plan of a member directory migration (T108): the reviewed manifest that says
 * which legacy row becomes which student, and the output plan that says which documents that
 * produces.
 *
 * Both are **Restricted artifacts that never enter Firestore**. Only their MACs and bounded counts
 * reach the operation receipt, which is why compensation can rederive and verify every target
 * without a single identifier living in database metadata. These are the contracts; the store that
 * holds the artifacts and the dry-run that produces them are separate pieces.
 *
 * Three rules from `docs/data/migrations/member-directory-v1.md` are enforced structurally rather
 * than left to the producer:
 *
 * - **The manifest is one-to-one.** A duplicate source ID, a duplicate target ID or one source
 *   mapped twice rejects the whole manifest, so an ambiguous mapping can never be confirmed.
 * - **Every listed row is write eligible.** The manifest describes the rows that will be written,
 *   and confirmation only ever accepts an all-eligible plan; an ineligible row is counted in the
 *   receipt, not carried here as something to skip at commit time.
 * - **The counts are derived, not asserted.** The receipt's `plannedNewStudentCount` and eligible
 *   classification counts are recomputed from the rows, so a receipt that claims a different plan
 *   than the manifest it names cannot be frozen.
 */

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const macPattern = /^[a-f0-9]{64}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const documentPathPattern = /^academies\/[A-Za-z0-9._:-]{1,128}\/[A-Za-z0-9]{1,64}\/[^/]{1,1500}$/u;

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
 * The reviewed reason a human recorded. It is Restricted free text that stays in the artifact and
 * never reaches Firestore, a log or a receipt, so it is bounded but not otherwise constrained.
 */
const reviewedReasonSchema = z.string().min(1).max(512);

/** Only these three can appear in a manifest; the rest are counted and never written. */
const manifestClassificationSchema = z.enum([
  "same-id-compatible",
  "explicit-existing-student-match",
  "createable-adult",
]);

/**
 * The family a minor match is bound to. Both IDs must already exist: migration never creates a
 * family or a relationship (invariant 9), so binding one here is a reference, not a request.
 */
const manifestFamilyBindingSchema = z
  .strictObject({
    familyId: opaqueIdentifierSchema,
    relationshipId: opaqueIdentifierSchema,
  })
  .readonly();

/**
 * The training-time preferences a created student is given.
 *
 * They are reviewed rather than derived because the legacy record has no equivalent field at all,
 * so a default would be exactly the silent guess invariant 11 forbids for the training center. They
 * belong to the manifest and not to the executor's caller because the manifest is the artifact a
 * human approved and the MAC covers: a preference supplied at commit time would be a value nobody
 * reviewed reaching a document the plan already claims to describe.
 */
const manifestTrainingTimePreferencesSchema = z
  .array(z.enum(trainingTimePreferences))
  .min(1)
  .max(trainingTimePreferences.length)
  .refine((values) => new Set(values).size === values.length, "Preferences must not repeat")
  .readonly();

const manifestRowSchema = z
  .strictObject({
    /** The `members/{sourceLegacyId}` document this row migrates. */
    sourceLegacyId: opaqueIdentifierSchema,
    /** The exact stored version of that row as the dry-run read it. */
    sourceUpdatedAt: auditDateTimeSchema,
    /** The fingerprint of that row, recomputed and compared before any write. */
    sourceRowMac: macSchema,
    classification: manifestClassificationSchema,
    /**
     * The existing student a match keeps, or the backend-generated opaque ID a create uses. Never
     * derived from the legacy ID for a create (invariant 28).
     */
    targetStudentId: opaqueIdentifierSchema,
    /** Present for, and only for, a reviewed match. */
    reviewedReason: reviewedReasonSchema.optional(),
    /** Present for, and only for, a match against an existing minor. */
    family: manifestFamilyBindingSchema.optional(),
    /** Present for, and only for, a row that creates a student. */
    trainingTimePreferences: manifestTrainingTimePreferencesSchema.optional(),
  })
  .superRefine((row, context) => {
    const isMatch = row.classification !== "createable-adult";
    if (isMatch && row.reviewedReason === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reviewedReason"],
        message: "A match must record the reviewed reason",
      });
    }
    if (!isMatch && row.reviewedReason !== undefined) {
      // A create is not a review decision, and a reason on one would look like authority it does
      // not carry.
      context.addIssue({
        code: "custom",
        path: ["reviewedReason"],
        message: "A created student has no reviewed match to explain",
      });
    }
    if (!isMatch && row.family !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["family"],
        message: "A created student is an adult and binds no family",
      });
    }
    if (!isMatch && row.trainingTimePreferences === undefined) {
      context.addIssue({
        code: "custom",
        path: ["trainingTimePreferences"],
        message: "A created student must carry its reviewed training time preferences",
      });
    }
    if (isMatch && row.trainingTimePreferences !== undefined) {
      // A match writes no student document, so preferences on one would be a reviewed value with
      // nowhere to land - and a reader could reasonably expect them to have been applied.
      context.addIssue({
        code: "custom",
        path: ["trainingTimePreferences"],
        message: "A matched student keeps its own training time preferences",
      });
    }
    if (row.classification === "same-id-compatible" && row.targetStudentId !== row.sourceLegacyId) {
      // `same-id-compatible` means exactly one thing: a student document that already carried that
      // ID before the operation. Any other target is a different case wearing its label.
      context.addIssue({
        code: "custom",
        path: ["targetStudentId"],
        message: "A same-ID coincidence must target the student that already had that ID",
      });
    }
    if (row.classification !== "same-id-compatible" && row.targetStudentId === row.sourceLegacyId) {
      // Both other cases would be a same-ID coincidence in another name, which is how a row gets
      // around the review the manifest rule demands for one.
      context.addIssue({
        code: "custom",
        path: ["targetStudentId"],
        message: "A row whose target is its own legacy ID is a same-ID coincidence",
      });
    }
    if (!isWriteEligibleClassification(row.classification, { explicitlyReviewed: isMatch })) {
      context.addIssue({
        code: "custom",
        path: ["classification"],
        message: "A manifest row must be write eligible",
      });
    }
  });

export type MemberDirectoryPrivateManifestRow = Readonly<z.infer<typeof manifestRowSchema>>;

export const memberDirectoryPrivateManifestSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    manifestId: opaqueIdentifierSchema,
    operationId: opaqueIdentifierSchema,
    academyId: opaqueIdentifierSchema,
    targetProjectClassification: z.enum(["emulator", "staging", "production"]),
    codeVersion: opaqueIdentifierSchema,
    preparedAt: auditDateTimeSchema,
    expiresAt: auditDateTimeSchema,
    rows: z.array(manifestRowSchema).min(1).max(memberDirectoryMaxRowsPerOperation),
  })
  .superRefine((manifest, context) => {
    if (Date.parse(manifest.expiresAt) <= Date.parse(manifest.preparedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Manifest expiry must be after it was prepared",
      });
    }
    const sources = new Set<string>();
    const targets = new Set<string>();
    manifest.rows.forEach((row, index) => {
      if (sources.has(row.sourceLegacyId)) {
        context.addIssue({
          code: "custom",
          path: ["rows", index, "sourceLegacyId"],
          message: "One source row may be mapped only once",
        });
      }
      sources.add(row.sourceLegacyId);
      if (targets.has(row.targetStudentId)) {
        // Two sources on one student is the merge nobody reviewed: the second row would find the
        // admin profile the first created and there is no rule for which legacy ID wins.
        context.addIssue({
          code: "custom",
          path: ["rows", index, "targetStudentId"],
          message: "Two source rows may not map to one student",
        });
      }
      targets.add(row.targetStudentId);
    });
  });

export type MemberDirectoryPrivateManifest = Readonly<
  z.infer<typeof memberDirectoryPrivateManifestSchema>
>;

/**
 * One document the plan expects a chunk to create.
 *
 * `priorAbsence` is a literal `true` rather than a boolean: v1 has no target that may already
 * exist, and a plan that could say `false` would be a plan that authorises an overwrite.
 */
const planTargetSchema = z
  .strictObject({
    path: z.string().regex(documentPathPattern),
    priorAbsence: z.literal(true),
    /** The canonical content MAC of the document the chunk must produce, byte for byte. */
    contentMac: macSchema,
  })
  .readonly();

const planChunkSchema = z
  .strictObject({
    chunkNo: z.number().int().positive().max(memberDirectoryMaxChunksPerOperation).safe(),
    /** The manifest rows this chunk covers, in the order the frozen scan fixed. */
    sourceLegacyIds: z.array(opaqueIdentifierSchema).min(1).max(memberDirectoryMaxRowsPerChunk),
    targets: z.array(planTargetSchema).min(1),
    /** The output-set root the chunk's receipt must carry. */
    expectedOutputSetMac: macSchema,
  })
  .readonly();

export const memberDirectoryPrivateOutputPlanSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    planId: opaqueIdentifierSchema,
    operationId: opaqueIdentifierSchema,
    academyId: opaqueIdentifierSchema,
    /** The manifest this plan was derived from; the two are frozen together or not at all. */
    manifestId: opaqueIdentifierSchema,
    privateManifestMac: macSchema,
    chunks: z.array(planChunkSchema).min(1).max(memberDirectoryMaxChunksPerOperation),
  })
  .superRefine((plan, context) => {
    try {
      assertChunkSequence(plan.chunks.map((chunk) => chunk.chunkNo));
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["chunks"],
        message: error instanceof Error ? error.message : "Invalid chunk sequence",
      });
    }
    const paths = new Set<string>();
    const sources = new Set<string>();
    let rowCount = 0;
    plan.chunks.forEach((chunk, chunkIndex) => {
      rowCount += chunk.sourceLegacyIds.length;
      chunk.sourceLegacyIds.forEach((sourceLegacyId, rowIndex) => {
        if (sources.has(sourceLegacyId)) {
          context.addIssue({
            code: "custom",
            path: ["chunks", chunkIndex, "sourceLegacyIds", rowIndex],
            message: "One source row may be planned into only one chunk",
          });
        }
        sources.add(sourceLegacyId);
      });
      chunk.targets.forEach((target, targetIndex) => {
        if (paths.has(target.path)) {
          // Two chunks writing one path means the second one's prior-absence assertion is already
          // false when it is planned, so the plan contradicts itself before anything runs.
          context.addIssue({
            code: "custom",
            path: ["chunks", chunkIndex, "targets", targetIndex, "path"],
            message: "One document may be planned only once",
          });
        }
        paths.add(target.path);
      });
    });
    if (rowCount > memberDirectoryMaxRowsPerOperation) {
      context.addIssue({
        code: "custom",
        path: ["chunks"],
        message: `A plan covers at most ${String(memberDirectoryMaxRowsPerOperation)} rows`,
      });
    }
  });

export type MemberDirectoryPrivateOutputPlan = Readonly<
  z.infer<typeof memberDirectoryPrivateOutputPlanSchema>
>;

/**
 * The plan and the manifest must describe the same work.
 *
 * They are two artifacts, frozen together, and nothing else in the system would notice if they
 * drifted: the executor reads its rows from the manifest and the compensation reads its targets
 * from the plan, so a row present in one and absent from the other would be migrated with nothing
 * able to reverse it, or reversed having never been written.
 */
export function assertMemberDirectoryPlanCoversManifest(
  manifest: MemberDirectoryPrivateManifest,
  plan: MemberDirectoryPrivateOutputPlan,
): void {
  if (plan.operationId !== manifest.operationId || plan.academyId !== manifest.academyId) {
    throw new Error("The output plan belongs to another operation or academy");
  }
  if (plan.manifestId !== manifest.manifestId) {
    throw new Error("The output plan was derived from another manifest");
  }
  const planned = plan.chunks.flatMap((chunk) => chunk.sourceLegacyIds);
  if (planned.length !== manifest.rows.length) {
    throw new Error("The output plan and the manifest cover a different number of rows");
  }
  const manifestSources = new Set(manifest.rows.map((row) => row.sourceLegacyId));
  for (const sourceLegacyId of planned) {
    if (!manifestSources.has(sourceLegacyId)) {
      throw new Error(`The output plan covers a row the manifest does not map: ${sourceLegacyId}`);
    }
  }
}

/**
 * The eligible classification counts a manifest implies. Ineligible rows are deliberately absent -
 * they never reach the manifest - so this answers only for the three that do.
 */
export function countMemberDirectoryManifestClassifications(
  manifest: MemberDirectoryPrivateManifest,
): Readonly<Record<MemberDirectoryDryRunClassification, number>> {
  const counts = Object.fromEntries(
    memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
  ) as Record<MemberDirectoryDryRunClassification, number>;
  for (const row of manifest.rows) {
    counts[row.classification] += 1;
  }
  return Object.freeze(counts);
}

/**
 * The receipt must describe the manifest it names, or it is not evidence of anything.
 *
 * The three eligible counts and `plannedNewStudentCount` are **recomputed from the rows** rather
 * than compared to numbers the producer supplied alongside them. `plannedNewStudentCount` counts
 * `createable-adult` alone, because a match creates no student: counting matches there would make
 * the capacity equation admit more students than the tenant will end up holding, which is the one
 * number the rollback limit is built on.
 */
export function assertMemberDirectoryReceiptMatchesManifest(
  receipt: MemberDirectoryOperationReceipt,
  manifest: MemberDirectoryPrivateManifest,
): void {
  if (receipt.operationId !== manifest.operationId || receipt.academyId !== manifest.academyId) {
    throw new Error("The receipt belongs to another operation or academy");
  }
  if (receipt.targetProjectClassification !== manifest.targetProjectClassification) {
    throw new Error("The receipt and the manifest target different project classifications");
  }
  if (receipt.codeVersion !== manifest.codeVersion) {
    throw new Error("The receipt and the manifest were produced by different code versions");
  }
  const counts = countMemberDirectoryManifestClassifications(manifest);
  for (const classification of ["same-id-compatible", "explicit-existing-student-match"] as const) {
    if (receipt.classificationCounts[classification] !== counts[classification]) {
      throw new Error(`The receipt miscounts ${classification} rows`);
    }
  }
  const createable = counts["createable-adult"];
  if (receipt.classificationCounts["createable-adult"] !== createable) {
    throw new Error("The receipt miscounts createable-adult rows");
  }
  if (receipt.plannedNewStudentCount !== createable) {
    throw new Error("Planned new students must be exactly the createable-adult rows");
  }
  if (manifest.rows.length > receipt.maximumApprovedRows) {
    throw new Error("The manifest maps more rows than the receipt approved");
  }
}

/**
 * A manifest is only usable inside its own window.
 *
 * The expiry is checked against the operation clock rather than trusted from the artifact's own
 * `preparedAt`, so a manifest reopened long after review cannot confirm on the strength of having
 * once been valid.
 */
export function assertMemberDirectoryManifestUnexpired(
  manifest: MemberDirectoryPrivateManifest,
  now: string,
): void {
  const instant = Date.parse(now);
  if (!Number.isFinite(instant)) {
    throw new Error("Invalid manifest validity instant");
  }
  if (instant < Date.parse(manifest.preparedAt)) {
    throw new Error("A manifest cannot be used before it was prepared");
  }
  if (instant >= Date.parse(manifest.expiresAt)) {
    // The expiry instant already counts as expired, for the same reason a lease does: a window that
    // is still open at its own end is the off-by-one that lets a run start it cannot finish.
    throw new Error("The reviewed manifest has expired");
  }
}
