import { z } from "zod";

import { isLevelCalendarDate } from "./level-progress";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
// Promotion ids embed an ISO instant; attendance ids are `sessionId__studentId`.
const recordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,383}$/u);
const daySchema = z.string().refine(isLevelCalendarDate, "Use a real date (YYYY-MM-DD).");
const classesSchema = z.number().int().min(0).max(10_000);
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
  reason: reasonSchema,
});
export type SetProgressLevelInput = z.input<typeof setProgressLevelInputSchema>;

export const setProgressClassCountInputSchema = z.strictObject({
  studentId: identifierSchema,
  classes: classesSchema,
  reason: reasonSchema,
});
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
  /** D13: attendance dated before this day is already inside the owner's count. */
  baselineCutoff: daySchema.nullable(),
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
