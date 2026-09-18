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

/**
 * The operator note on a promotion decision: 10–500 characters, trimmed, no control characters
 * other than line breaks. Exported because the assign SERVICE re-checks it at the store, the same
 * way it re-checks the promotion date there: the note is the only record of why somebody was
 * promoted below criteria, on an irreversible audited write, so it is not left to the boundary.
 */
export const promotionNoteSchema = boundedFreeText(10, 500);
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
  note: promotionNoteSchema.optional(),
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
  reason: promotionNoteSchema,
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

/**
 * Stored free text as the HISTORY reads it. A read schema over rows written by earlier code and by
 * the Regyfit import, so it is deliberately wider than the write-side `promotionNoteSchema`
 * (10-500). Exported because the store must normalise with the very schema the row is parsed with:
 * review of Task 10 (Major-2) — a sub-field the read schema cannot take degrades to "not
 * recorded", it never drops the promotion it belongs to.
 */
export const historyFreeTextSchema = boundedFreeText(0, 1000);

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
  note: historyFreeTextSchema.nullable(),
  gaps: gapsSchema,
  /**
   * Review of Task 10 (Major-2), RULING: a void record that exists always marks its promotion
   * voided. Showing a cancelled promotion as still standing is a lie the operator can see and
   * challenge; omitting the promotion is a lie the operator cannot see at all, and it destroys the
   * very evidence the append-only design exists to preserve. So every sub-field degrades to `null`
   * — "not recorded" — exactly the way `decidedByRole` already does, and the row survives. No
   * fallback ever FABRICATES an author or a date on an audited record.
   */
  voided: z
    .strictObject({
      reason: historyFreeTextSchema.nullable(),
      voidedByRole: decisionRoleSchema.nullable(),
      voidedOn: dateOnlySchema.nullable(),
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

/**
 * A batch of ratings: 1-100 of them, each skill named once, each score an integer 1-5. Exported
 * because the assessment SERVICE re-checks it at the store, for the reason `promotionNoteSchema`
 * is re-checked there (Task 9): the batch is an irreversible audited write about a real member,
 * one transaction wide, and the callable boundary that parses it does not exist yet (Task 12).
 * Both sides using this one schema is what stops them drifting.
 */
export const skillRatingsSchema = z
  .array(z.strictObject({ skillKey: identifierSchema, score: scoreSchema }))
  .min(1)
  .max(100)
  .refine((ratings) => new Set(ratings.map((rating) => rating.skillKey)).size === ratings.length, {
    message: "Each skill may be rated once per call",
  });

/**
 * The operator's evidence note on a batch of ratings. Min 1 so an empty note cannot be sent:
 * omitted and "present but empty" must not be the same thing. Exported for the same reason as
 * `skillRatingsSchema` above.
 */
export const assessmentEvidenceNotesSchema = boundedFreeText(1, 1000);

export const recordSkillRatingsInputSchema = z.strictObject({
  studentId: identifierSchema,
  definitionKey: identifierSchema,
  ratings: skillRatingsSchema,
  evidenceNotes: assessmentEvidenceNotesSchema.optional(),
});
export type RecordSkillRatingsInput = z.infer<typeof recordSkillRatingsInputSchema>;

/**
 * T051V2 review fix (Major-2): the result echoes the student the batch was written for, so a
 * caller can tie the confirmation to the member it asked about. Ratings are the input to a
 * promotion decision about a named person, and a count alone is true of any member.
 */
export const recordSkillRatingsResultSchema = z.strictObject({
  studentId: identifierSchema,
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

/**
 * T051V2 review fix (Major-2): `studentId` is required so the skill ratings shown beside a member
 * name can be tied to the member the caller asked about; without it a summary belonging to another
 * member (or to the signed-in coach) parses and renders as theirs. Unknown keys are dropped.
 */
export const studentSkillSummaryResponseSchema = z.object({
  studentId: identifierSchema,
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
