import { z } from "zod";

import { isLevelCalendarDate } from "./level-progress";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
// Promotion ids embed the student id, the level key and an ISO instant, so they outgrow 128.
const recordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,383}$/u);
const dateOnlySchema = z.string().refine(isLevelCalendarDate);
const countSchema = z.number().int().min(0).max(1_000_000);
const decisionRoleSchema = z.enum(["headCoach", "owner"]);
const scoreSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

// Tab (0x09) and line feed (0x0a) are allowed in operator free text; every other C0 control and
// DEL is not. The control-character rule is byte-identical to Plan B's `internalNotes`
// (packages/domain/src/members/member-directory-contracts.ts), but the whitespace rule is
// DELIBERATELY DIFFERENT: Plan B rejects any value that is not already trimmed and bounds the raw
// string, while this helper normalises CRLF to LF and trims, then bounds the trimmed value. These
// fields are browser textareas, where padding is an artefact of typing and not an attack, so
// normalising beats rejecting. Consequence: a padded value that trims into range is accepted here
// and refused by Plan B, and a padded value that trims out of range is refused here.
const notesControlCharacterPattern = /[\u0000-\u0008\u000b-\u001f\u007f]/u;

/** Operator free text: trimmed, length-bounded, no control characters other than line breaks. */
function boundedFreeText(min: number, max: number) {
  return (
    z
      .string()
      // A browser textarea submits CRLF, and a stored carriage return is a control character the
      // rule below refuses, so the line breaks are normalised before the bounds apply.
      .transform((value) => value.replace(/\r\n?/gu, "\n"))
      .pipe(
        z
          .string()
          .trim()
          .min(min)
          .max(max)
          .refine((value) => !notesControlCharacterPattern.test(value), {
            message: "Text must contain no control characters other than line breaks",
          }),
      )
  );
}

const noteSchema = boundedFreeText(10, 500);
// Gaps are rendered in the assign dialog and the history table, so they carry the same rule.
const gapsSchema = z.array(boundedFreeText(1, 120)).max(10);

/**
 * The wire form of `ImportedBaseline` (declared in `./level-progress`, Task 5). Only the schema
 * lives here; re-declaring the type would collide on the `@bpt-jersey/domain/levels` barrel.
 *
 * Spec §6.5: `cutoff` is the FIRST day counted from BPT attendance — the day after the last day
 * already included in `classes` — not simply "the import date". The invariant it guarantees is that
 * every class is counted exactly once: dated before `cutoff` it is already inside `classes`, dated
 * on or after it, it is counted from BPT attendance (`countClassesAtLevel`).
 */
export const importedBaselineSchema = z.strictObject({
  classes: countSchema,
  cutoff: dateOnlySchema,
  source: z.literal("regyfit-import"),
});

export const assignLevelInputSchema = z.strictObject({
  studentId: identifierSchema,
  fromDefinitionKey: identifierSchema,
  toDefinitionKey: identifierSchema,
  // A "not in the future" bound is clock- and timezone-dependent, so it is not a contract rule:
  // the assign service (Task 8) owns it, as the open service (Task 9) owns it for `startedOn`.
  promotedOn: dateOnlySchema,
  note: noteSchema.optional(),
});
export type AssignLevelInput = z.infer<typeof assignLevelInputSchema>;

export const assignLevelResultSchema = z.strictObject({
  promotionId: recordIdSchema,
  toDefinitionKey: identifierSchema,
  promotedOn: dateOnlySchema,
  gaps: gapsSchema,
});
export type AssignLevelResult = z.infer<typeof assignLevelResultSchema>;

export const voidPromotionInputSchema = z.strictObject({
  studentId: identifierSchema,
  promotionId: recordIdSchema,
  reason: noteSchema,
});
export type VoidPromotionInput = z.infer<typeof voidPromotionInputSchema>;

export const voidPromotionResultSchema = z.strictObject({
  voidId: recordIdSchema,
  voidsPromotionId: recordIdSchema,
  restoredDefinitionKey: identifierSchema,
});
export type VoidPromotionResult = z.infer<typeof voidPromotionResultSchema>;

export const studentLevelHistoryRequestSchema = z.strictObject({ studentId: identifierSchema });
export type StudentLevelHistoryRequest = z.infer<typeof studentLevelHistoryRequestSchema>;

const criterionAtAssignmentSchema = z.strictObject({
  done: countSchema,
  min: countSchema.nullable(),
});

export const levelHistoryEntrySchema = z.strictObject({
  entryId: recordIdSchema,
  kind: z.enum(["opening", "promotion"]),
  definitionKey: identifierSchema,
  fromDefinitionKey: identifierSchema.nullable(),
  assignedOn: dateOnlySchema,
  classes: criterionAtAssignmentSchema.nullable(),
  days: criterionAtAssignmentSchema.nullable(),
  decidedByRole: decisionRoleSchema.nullable(),
  source: z.enum(["bpt", "regyfit-import"]),
  // A read schema over stored data: a stored note that is empty, or that trims to empty, must not
  // fail the whole history. Task 10 maps such a note to `null`. Write-side notes stay at min 10.
  note: boundedFreeText(0, 1000).nullable(),
  gaps: gapsSchema,
  voided: z
    .strictObject({
      reason: noteSchema,
      voidedByRole: decisionRoleSchema,
      voidedOn: dateOnlySchema,
    })
    .nullable(),
});
export type LevelHistoryEntry = z.infer<typeof levelHistoryEntrySchema>;

export const studentLevelHistorySchema = z.strictObject({
  studentId: identifierSchema,
  currentDefinitionKey: identifierSchema.nullable(),
  entries: z.array(levelHistoryEntrySchema).max(400),
});
export type StudentLevelHistory = z.infer<typeof studentLevelHistorySchema>;

export const recordSkillRatingsInputSchema = z.strictObject({
  studentId: identifierSchema,
  definitionKey: identifierSchema,
  ratings: z
    .array(z.strictObject({ skillKey: identifierSchema, score: scoreSchema }))
    .min(1)
    .max(100)
    .refine(
      (ratings) => new Set(ratings.map((rating) => rating.skillKey)).size === ratings.length,
      {
        message: "Each skill may be rated once per call",
      },
    ),
  // Min 1 so an empty note cannot be sent: omitted and "present but empty" must not be the same.
  evidenceNotes: boundedFreeText(1, 1000).optional(),
});
export type RecordSkillRatingsInput = z.infer<typeof recordSkillRatingsInputSchema>;

export const recordSkillRatingsResultSchema = z.strictObject({
  recorded: z.number().int().min(1).max(100),
});
export type RecordSkillRatingsResult = z.infer<typeof recordSkillRatingsResultSchema>;

/** The part of getStudentProgressSummary the IBJJF card reads; unknown keys are dropped. */
export const studentLevelCardSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("uninitialized"), studentId: identifierSchema }),
  z.object({
    state: z.literal("initialized"),
    studentId: identifierSchema,
    currentDefinition: z.object({ definitionKey: identifierSchema }),
    targetDefinition: z.object({ definitionKey: identifierSchema }).nullable(),
    currentLevelStartedAt: z.string().nullable(),
    // Spec 6.2: `null` at the top of the catalogue, where there is no next level. It is not 0%.
    progressPercent: z.number().int().min(0).max(100).nullable(),
    criteria: z.object({
      classes: z.object({
        required: countSchema.nullable(),
        completed: countSchema,
        imported: countSchema,
        met: z.boolean(),
      }),
      time: z.object({
        requiredDays: countSchema.nullable(),
        elapsedDays: countSchema,
        met: z.boolean(),
      }),
    }),
  }),
]);
export type StudentLevelCard = z.infer<typeof studentLevelCardSchema>;

export const studentSkillSummaryResponseSchema = z.object({
  summary: z.record(
    identifierSchema,
    z.object({
      count: countSchema,
      maxScore: scoreSchema,
      latestScore: scoreSchema,
      lastEvaluatedAt: z.string(),
    }),
  ),
});
export type StudentSkillSummaryResponse = z.infer<typeof studentSkillSummaryResponseSchema>;
