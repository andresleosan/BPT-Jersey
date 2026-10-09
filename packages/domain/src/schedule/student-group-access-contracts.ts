import { z } from "zod";
import { programAgeLimits, type ProgramAgeRange } from "./classes-services-contracts";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
// Office-only context for the exception. Both stay optional on reads so member responses, and
// documents saved before 2026-09-21, keep their original shape.
const grantContext = {
  reason: z.string().trim().max(500).optional(),
  expiresOn: dateKey.nullable().optional(),
};

const age = z.number().int().min(programAgeLimits.min).max(programAgeLimits.max);
const ageBounds = { minAge: age, maxAge: age.nullable() };
const ordered = (range: { minAge: number; maxAge: number | null }) =>
  range.maxAge === null || range.maxAge >= range.minAge;
/** The office's training age range. Members only ever receive minAge/maxAge. */
export const memberAgeRangeSchema = z
  .strictObject({ ...ageBounds, ...grantContext })
  .refine(ordered, "The upper age must not be below the lower age.");
export type MemberAgeRange = z.infer<typeof memberAgeRangeSchema>;
export const studentGroupAccessQuerySchema = z.strictObject({ studentId: id });
export const studentGroupAccessSchema = z.strictObject({
  studentId: id,
  programIds: z
    .array(id)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length),
  revision: z.number().int().nonnegative(),
  dateOfBirth: dateKey.nullable(),
  ageRange: memberAgeRangeSchema.nullable().optional(),
  ...grantContext,
});
// The reason is optional since 2026-09-23 (office request).
export const saveStudentGroupAccessSchema = studentGroupAccessSchema.omit({
  dateOfBirth: true,
  ageRange: true,
});

export const saveStudentAgeRangeSchema = z.strictObject({
  studentId: id,
  revision: z.number().int().nonnegative(),
  ageRange: z
    .strictObject({
      ...ageBounds,
      reason: z.string().trim().min(1).max(500),
      expiresOn: dateKey.nullable(),
    })
    .refine(ordered, "The upper age must not be below the lower age.")
    .nullable(),
});
export type SaveStudentAgeRange = z.infer<typeof saveStudentAgeRangeSchema>;

/** A grant past its expiry date (Jersey calendar day, inclusive) authorises nothing. */
export function effectiveGroupProgramIds(
  access: Pick<StudentGroupAccess, "programIds" | "expiresOn">,
  todayKey: string,
): readonly string[] {
  return access.expiresOn && access.expiresOn < todayKey ? [] : access.programIds;
}
export type StudentGroupAccess = z.infer<typeof studentGroupAccessSchema>;
export type SaveStudentGroupAccess = z.infer<typeof saveStudentGroupAccessSchema>;

/** The range still in force today (Jersey day, inclusive), without the office-only context. */
export function effectiveAgeRange(
  access: Pick<StudentGroupAccess, "ageRange">,
  todayKey: string,
): ProgramAgeRange | null {
  const range = access.ageRange;
  if (!range || (range.expiresOn && range.expiresOn < todayKey)) return null;
  return { minAge: range.minAge, maxAge: range.maxAge };
}

/** A class type opens through the range when both age ranges overlap. */
export function ageRangeAdmits(program: ProgramAgeRange, range: ProgramAgeRange): boolean {
  const programTop = program.maxAge ?? Number.POSITIVE_INFINITY;
  const rangeTop = range.maxAge ?? Number.POSITIVE_INFINITY;
  return program.minAge <= rangeTop && range.minAge <= programTop;
}

/** Class types the range opens today; callers add them to the extra groups (same waivers). */
export function rangeExtraProgramIds(
  access: Pick<StudentGroupAccess, "ageRange">,
  programs: readonly Readonly<{ programId: string; ageRange?: ProgramAgeRange | null }>[],
  todayKey: string,
): string[] {
  const range = effectiveAgeRange(access, todayKey);
  if (!range) return [];
  // ponytail: an all-ages type already admits everyone, so the range adds nothing for it.
  return programs
    .filter((p) => p.ageRange && ageRangeAdmits(p.ageRange, range))
    .map((p) => p.programId);
}

export function ageSpanLabel(range: ProgramAgeRange): string {
  return range.maxAge === null ? `${range.minAge}+` : `${range.minAge}–${range.maxAge}`;
}

/** The range in force on a Jersey day, read from this member's stored studentGroupAccess doc. */
export function storedTrainingRange(
  data: unknown,
  academyId: string,
  studentId: string,
  todayKey: string,
): ProgramAgeRange | null {
  if (typeof data !== "object" || data === null) return null;
  const doc = data as Readonly<Record<string, unknown>>;
  if (doc.academyId !== academyId || doc.studentId !== studentId) return null;
  const parsed = memberAgeRangeSchema.safeParse(doc.ageRange).data;
  return effectiveAgeRange({ ageRange: parsed ?? null }, todayKey);
}

/** storedTrainingRange for every document of the studentGroupAccess collection, by member id. */
export function trainingRangesById(
  docs: readonly Readonly<{ id: string; data(): unknown }>[],
  academyId: string,
  todayKey: string,
): Map<string, ProgramAgeRange | null> {
  return new Map(
    docs.map((d) => [d.id, storedTrainingRange(d.data(), academyId, d.id, todayKey)]),
  );
}
