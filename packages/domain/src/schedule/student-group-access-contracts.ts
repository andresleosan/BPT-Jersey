import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const studentGroupAccessQuerySchema = z.strictObject({ studentId: id });
export const studentGroupAccessSchema = z.strictObject({
  studentId: id,
  programIds: z.array(id).max(200).refine((ids) => new Set(ids).size === ids.length),
  revision: z.number().int().nonnegative(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
});
export const saveStudentGroupAccessSchema = studentGroupAccessSchema.omit({ dateOfBirth: true });
export type StudentGroupAccess = z.infer<typeof studentGroupAccessSchema>;
export type SaveStudentGroupAccess = z.infer<typeof saveStudentGroupAccessSchema>;
