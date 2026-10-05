import { z } from "zod";

import { isLevelCalendarDate, minimumDaysOf } from "./level-progress";
import type { LevelDefinitionRecord } from "./level-contracts";

/** Manual edits stop before the next rank's requirements; earned progress is never capped. */
export function manualProgressLimits(
  definitions: readonly LevelDefinitionRecord[],
  definitionKey: string,
) {
  const current = definitions.find((definition) => definition.definitionKey === definitionKey);
  const next = current === undefined ? undefined : definitions.find(
    (definition) => definition.sequence === current.sequence + 1,
  );
  const below = (minimum: number | null | undefined, ceiling: number) =>
    minimum === null || minimum === undefined || minimum <= 0
      ? null
      : Math.min(minimum - 1, ceiling);
  return {
    classes: below(next?.criteria.minClasses, 10_000),
    days: below(minimumDaysOf(next?.criteria.minimumTime ?? null), 100_000),
  };
}

export function manualProgressError(
  limits: ReturnType<typeof manualProgressLimits>,
  input: Readonly<{ classes?: number | undefined; days?: number | undefined }>,
): string | null {
  for (const field of ["classes", "days"] as const) {
    const value = input[field];
    if (value === undefined) continue;
    const max = limits[field];
    if (max === null) return `This level has no ${field} requirement to adjust.`;
    if (!Number.isSafeInteger(value) || value < 0 || value > max) {
      return `Enter ${field} as a whole number from 0 to ${max}.`;
    }
  }
  return null;
}

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
// Promotion ids embed an ISO instant; attendance ids are `sessionId__studentId`.
const recordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,383}$/u);
const daySchema = z.string().refine(isLevelCalendarDate, "Use a real date (YYYY-MM-DD).");
const classesSchema = z.number().int().min(0).max(10_000);
const daysSchema = z.number().int().min(0).max(100_000);
/** D11: optional everywhere; blank or missing is stored as null. */
const reasonSchema = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((value) => (value ? value : null));

export const progressStudentInputSchema = z.strictObject({ studentId: identifierSchema });

export const setProgressLevelInputSchema = z.strictObject({
  studentId: identifierSchema,
  definitionKey: identifierSchema,
  startedOn: daySchema,
  /** D12: omitted means the count restarts at 0 for the new level. */
  classes: classesSchema.optional(),
  days: daysSchema.optional(),
  reason: reasonSchema,
});
export type SetProgressLevelInput = z.input<typeof setProgressLevelInputSchema>;

export const setProgressClassCountInputSchema = z.strictObject({
  studentId: identifierSchema,
  // The profile sends the level it displayed to reject a concurrent level change.
  definitionKey: identifierSchema.optional(),
  classes: classesSchema.optional(),
  days: daysSchema.optional(),
  reason: reasonSchema,
}).refine((input) => input.classes !== undefined || input.days !== undefined,
  "Enter a class count or a day count.");
export type SetProgressClassCountInput = z.input<typeof setProgressClassCountInputSchema>;

export const addManualAttendanceInputSchema = z.strictObject({
  studentId: identifierSchema,
  date: daySchema,
  reason: reasonSchema,
});
export type AddManualAttendanceInput = z.input<typeof addManualAttendanceInputSchema>;

export const setAttendanceVoidInputSchema = z.strictObject({
  studentId: identifierSchema,
  kind: z.enum(["attendance", "manual"]),
  id: recordIdSchema,
  voided: z.boolean(),
  reason: reasonSchema,
});
export type SetAttendanceVoidInput = z.input<typeof setAttendanceVoidInputSchema>;

/**
 * Level history editing (2026-10-03): the office adds, corrects or removes history rows, and the
 * member's current level is always the row with the latest date.
 */
export const editLevelHistoryInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("add"),
    studentId: identifierSchema,
    definitionKey: identifierSchema,
    assignedOn: daySchema,
    note: reasonSchema,
  }),
  z.strictObject({
    action: z.literal("update"),
    studentId: identifierSchema,
    entryId: recordIdSchema,
    definitionKey: identifierSchema,
    assignedOn: daySchema,
  }),
  z.strictObject({
    action: z.literal("delete"),
    studentId: identifierSchema,
    entryId: recordIdSchema,
  }),
]);
export type EditLevelHistoryInput = z.input<typeof editLevelHistoryInputSchema>;

export const progressAttendanceRowSchema = z.strictObject({
  id: recordIdSchema,
  kind: z.enum(["attendance", "manual"]),
  date: daySchema,
  /** The class title, or "Added by owner". */
  label: z.string().max(200),
  openMat: z.boolean(),
  voided: z.boolean(),
  reason: z.string().max(300).nullable(),
});
export type ProgressAttendanceRow = z.infer<typeof progressAttendanceRowSchema>;

export const progressChangeSchema = z.strictObject({
  at: z.string().max(40),
  by: z.string().max(200),
  summary: z.string().max(300),
  reason: z.string().max(300).nullable(),
});

export const progressManagementSchema = z.strictObject({
  studentId: identifierSchema,
  /** False when the member has no level head yet (spec deviation 3). */
  initialized: z.boolean(),
  currentDefinitionKey: identifierSchema.nullable(),
  startedOn: daySchema.nullable(),
  classesAtLevel: z.number().int().min(0),
  daysAtLevel: z.number().int().min(0),
  /** D13: attendance dated before this day is already inside the owner's count. */
  baselineCutoff: daySchema.nullable(),
  baselineCountedThrough: z.string().datetime().nullish(),
  /** The head's latest promotion when it is an owner level change, so the tab can offer Undo. */
  undoPromotionId: recordIdSchema.nullable(),
  attendance: z.array(progressAttendanceRowSchema).max(1000),
  history: z.array(progressChangeSchema).max(200),
});
export type ProgressManagement = z.infer<typeof progressManagementSchema>;

/** Spec §C. ponytail: UTC noon is the same calendar day in Jersey in both GMT and BST. */
export function manualAttendanceInstant(date: string): string {
  return `${date}T12:00:00.000Z`;
}
