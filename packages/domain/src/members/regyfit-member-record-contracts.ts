import { z } from "zod";

import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";
import { memberGenders } from "./member-contracts";

export const regyfitMemberRecordSources = Object.freeze(["regyfit-admin-capture"] as const);

export const regyfitMembershipStates = Object.freeze(["active", "inactive"] as const);

export const regyfitAttendanceStatuses = Object.freeze([
  "present",
  "absent",
  "no-data",
  "unknown",
] as const);

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;
const utcMillisecondDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const recordIdPattern = /^[0-9]{1,12}$/u;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isCanonicalText(value: string): boolean {
  return value === value.trim() && !hasControlCharacter(value);
}

function isCalendarDate(value: string): boolean {
  if (!dateOnlyPattern.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (year === undefined || month === undefined || day === undefined) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function canonicalText(max: number) {
  return z.string().min(1).max(max).refine(isCanonicalText);
}

const dateOnlySchema = z.string().refine(isCalendarDate);
const capturedAtSchema = z.string().regex(utcMillisecondDateTimePattern);
const countSchema = z.number().int().min(0).max(100000);

export const regyfitGraduationSchema = z.strictObject({
  modality: canonicalText(120).optional(),
  belt: canonicalText(160).optional(),
  nextGraduationDate: canonicalText(40).optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  classesProgress: canonicalText(24).optional(),
  daysProgress: canonicalText(24).optional(),
});

export const regyfitAppAccessSchema = z.strictObject({
  login: canonicalText(64).optional(),
  password: canonicalText(64).optional(),
  logins: countSchema.optional(),
  lastLogin: canonicalText(64).optional(),
});

export const regyfitPlanSchema = z.strictObject({
  membershipPlan: canonicalText(160).optional(),
  paymentMode: canonicalText(64).optional(),
  amount: canonicalText(24).optional(),
  validFrom: dateOnlySchema.optional(),
  validUntil: dateOnlySchema.optional(),
  frequency: canonicalText(64).optional(),
  discount: canonicalText(64).optional(),
});

export const regyfitAttendanceRecordSchema = z.strictObject({
  date: canonicalText(40),
  time: canonicalText(40).optional(),
  className: canonicalText(160).optional(),
  status: z.enum(regyfitAttendanceStatuses),
});

export const regyfitAttendanceSchema = z.strictObject({
  registrations: countSchema.optional(),
  attended: countSchema.optional(),
  absences: countSchema.optional(),
  thisMonth: countSchema.optional(),
  last30Days: countSchema.optional(),
  lastAttendance: canonicalText(64).optional(),
  advantage: canonicalText(64).optional(),
  records: z.array(regyfitAttendanceRecordSchema).max(50).readonly(),
});

export const regyfitPaymentSchema = z.strictObject({
  date: canonicalText(40).optional(),
  description: canonicalText(240).optional(),
  amount: canonicalText(40).optional(),
});

export const regyfitMemberRecordSchema = z.strictObject({
  recordId: z.string().regex(recordIdPattern),
  memberNumber: canonicalText(24).optional(),
  fullName: canonicalText(160),
  nickname: canonicalText(80).optional(),
  // Captured verbatim from Regyfit: the source holds a few malformed addresses.
  email: canonicalText(320).optional(),
  mobile: canonicalText(64).optional(),
  emergencyContact: canonicalText(64).optional(),
  address: canonicalText(240).optional(),
  locality: canonicalText(120).optional(),
  postcode: canonicalText(40).optional(),
  country: canonicalText(80).optional(),
  idCardNumber: canonicalText(64).optional(),
  idCardDue: dateOnlySchema.optional(),
  healthNumber: canonicalText(64).optional(),
  vatNumber: canonicalText(64).optional(),
  profession: canonicalText(120).optional(),
  gender: z.enum(memberGenders),
  birthDate: dateOnlySchema.optional(),
  age: z.number().int().min(0).max(120).optional(),
  registrationDate: dateOnlySchema.optional(),
  membershipState: z.enum(regyfitMembershipStates),
  responsibleTrainer: canonicalText(120).optional(),
  accountManager: canonicalText(120).optional(),
  notes: canonicalText(2000).optional(),
  appAccess: regyfitAppAccessSchema,
  graduation: regyfitGraduationSchema,
  plan: regyfitPlanSchema,
  attendance: regyfitAttendanceSchema,
  payments: z.array(regyfitPaymentSchema).max(50).readonly(),
  capturedAt: capturedAtSchema,
  source: z.enum(regyfitMemberRecordSources),
  schemaVersion: z.literal("1"),
});

export type RegyfitMemberRecord = Readonly<z.infer<typeof regyfitMemberRecordSchema>>;
export type RegyfitGraduation = Readonly<z.infer<typeof regyfitGraduationSchema>>;
export type RegyfitPlan = Readonly<z.infer<typeof regyfitPlanSchema>>;
export type RegyfitAttendance = Readonly<z.infer<typeof regyfitAttendanceSchema>>;
export type RegyfitPayment = Readonly<z.infer<typeof regyfitPaymentSchema>>;
export type RegyfitMemberRecordSource = (typeof regyfitMemberRecordSources)[number];
export type RegyfitMembershipState = (typeof regyfitMembershipStates)[number];
export type RegyfitAttendanceStatus = (typeof regyfitAttendanceStatuses)[number];

export const regyfitMemberDirectoryRowSchema = z.strictObject({
  recordId: z.string().regex(recordIdPattern),
  memberNumber: canonicalText(24).optional(),
  fullName: canonicalText(160),
  // Captured verbatim from Regyfit: the source holds a few malformed addresses.
  email: canonicalText(320).optional(),
  mobile: canonicalText(64).optional(),
  birthDate: dateOnlySchema.optional(),
  membershipState: z.enum(regyfitMembershipStates),
  paymentMode: canonicalText(64).optional(),
  membershipPlan: canonicalText(160).optional(),
  belt: canonicalText(160).optional(),
});

export type RegyfitMemberDirectoryRow = Readonly<z.infer<typeof regyfitMemberDirectoryRowSchema>>;

export const regyfitMemberDirectoryPageSchema = z.strictObject({
  rows: z.array(regyfitMemberDirectoryRowSchema).max(500).readonly(),
  total: countSchema,
  capturedAt: capturedAtSchema.optional(),
});

export type RegyfitMemberDirectoryPage = Readonly<z.infer<typeof regyfitMemberDirectoryPageSchema>>;

export function toRegyfitMemberDirectoryRow(
  record: RegyfitMemberRecord,
): RegyfitMemberDirectoryRow {
  return Object.freeze({
    recordId: record.recordId,
    ...(record.memberNumber === undefined ? {} : { memberNumber: record.memberNumber }),
    fullName: record.fullName,
    ...(record.email === undefined ? {} : { email: record.email }),
    ...(record.mobile === undefined ? {} : { mobile: record.mobile }),
    ...(record.birthDate === undefined ? {} : { birthDate: record.birthDate }),
    membershipState: record.membershipState,
    ...(record.plan.paymentMode === undefined ? {} : { paymentMode: record.plan.paymentMode }),
    ...(record.plan.membershipPlan === undefined
      ? {}
      : { membershipPlan: record.plan.membershipPlan }),
    ...(record.graduation.belt === undefined ? {} : { belt: record.graduation.belt }),
  });
}

function zodIssues(error: z.ZodError): readonly ValidationIssue[] {
  return Object.freeze(
    error.issues.map((issue) =>
      Object.freeze({
        path: Object.freeze(issue.path.map((segment) => String(segment))),
        code: issue.code,
      }),
    ),
  );
}

function isPlainData(value: unknown): boolean {
  if (value === null || typeof value !== "object") return typeof value !== "function";
  if (Array.isArray(value)) return value.every(isPlainData);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every(isPlainData);
}

export function parseRegyfitMemberRecord(
  value: unknown,
): Result<RegyfitMemberRecord, readonly ValidationIssue[]> {
  if (!isPlainData(value)) {
    return err(Object.freeze([{ path: Object.freeze([]), code: "invalid_plain_data" }]));
  }
  const parsed = regyfitMemberRecordSchema.safeParse(value);
  if (!parsed.success) return err(zodIssues(parsed.error));
  return ok(Object.freeze(parsed.data) as RegyfitMemberRecord);
}

export function parseRegyfitMemberDirectoryPage(
  value: unknown,
): Result<RegyfitMemberDirectoryPage, readonly ValidationIssue[]> {
  if (!isPlainData(value)) {
    return err(Object.freeze([{ path: Object.freeze([]), code: "invalid_plain_data" }]));
  }
  const parsed = regyfitMemberDirectoryPageSchema.safeParse(value);
  if (!parsed.success) return err(zodIssues(parsed.error));
  return ok(Object.freeze(parsed.data) as RegyfitMemberDirectoryPage);
}
