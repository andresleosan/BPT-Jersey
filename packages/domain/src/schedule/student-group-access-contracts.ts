import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
// Office-only context for the exception. Both stay optional on reads so member responses, and
// documents saved before 2026-09-21, keep their original shape.
const grantContext = {
  reason: z.string().trim().max(500).optional(),
  expiresOn: dateKey.nullable().optional(),
};
export const studentGroupAccessQuerySchema = z.strictObject({ studentId: id });
export const studentGroupAccessSchema = z.strictObject({
  studentId: id,
  programIds: z
    .array(id)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length),
  revision: z.number().int().nonnegative(),
  dateOfBirth: dateKey.nullable(),
  ...grantContext,
});
export const saveStudentGroupAccessSchema = studentGroupAccessSchema
  .omit({ dateOfBirth: true })
  .refine((input) => input.programIds.length === 0 || (input.reason?.length ?? 0) >= 2, {
    path: ["reason"],
    message: "A reason is required to grant additional group access",
  });

/** A grant past its expiry date (Jersey calendar day, inclusive) authorises nothing. */
export function effectiveGroupProgramIds(
  access: Pick<StudentGroupAccess, "programIds" | "expiresOn">,
  todayKey: string,
): readonly string[] {
  return access.expiresOn && access.expiresOn < todayKey ? [] : access.programIds;
}
export type StudentGroupAccess = z.infer<typeof studentGroupAccessSchema>;
export type SaveStudentGroupAccess = z.infer<typeof saveStudentGroupAccessSchema>;
