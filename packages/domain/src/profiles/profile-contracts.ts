import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const trainingCenters = Object.freeze(["Town", "West"] as const);
export type TrainingCenter = (typeof trainingCenters)[number];

export const trainingTimePreferences = Object.freeze(["morning", "afternoon", "evening"] as const);
export type TrainingTimePreference = (typeof trainingTimePreferences)[number];

export const participantTypes = Object.freeze(["adult", "minor"] as const);
export type ParticipantType = (typeof participantTypes)[number];

const profileStatuses = Object.freeze(["active", "inactive", "suspended"] as const);
type ProfileStatus = (typeof profileStatuses)[number];

type ProfileAuditFields = Readonly<{
  active: boolean;
  status: ProfileStatus;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type UserProfile = Readonly<{
  userId: string;
  academyId: string;
  accountType: "client";
  displayName: string;
  email: string;
  phoneNumber: string;
}> &
  ProfileAuditFields;

export type StudentProfile = Readonly<{
  studentId: string;
  academyId: string;
  familyId?: string;
  userId?: string;
  fullName: string;
  dateOfBirth: string;
  phoneNumber?: string;
  email?: string;
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
  participantType: ParticipantType;
}> &
  ProfileAuditFields;

export type ClientProfileProjection = Readonly<{
  user: UserProfile;
  student: StudentProfile;
}>;

const userProfileFields = Object.freeze([
  "userId",
  "academyId",
  "accountType",
  "displayName",
  "email",
  "phoneNumber",
  "active",
  "status",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);

const studentProfileFields = Object.freeze([
  "studentId",
  "academyId",
  "familyId",
  "userId",
  "fullName",
  "dateOfBirth",
  "phoneNumber",
  "email",
  "trainingCenter",
  "trainingTimePreferences",
  "participantType",
  "active",
  "status",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);
const studentRequiredProfileFields = Object.freeze(
  studentProfileFields.filter(
    (field) => !["familyId", "userId", "phoneNumber", "email"].includes(field),
  ),
);

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return { path, code };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every(
      (key) => typeof key === "string" && (required.includes(key) || optional.includes(key)),
    ) && required.every((key) => Object.hasOwn(value, key))
  );
}

function isValidCalendarDate(value: string): boolean {
  if (!dateOnlyPattern.test(value) && !dateTimePattern.test(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNonEmptyText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
  );
}

function isEmail(value: unknown): value is string {
  return isNonEmptyText(value, 320) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function validateAuditFields(value: Record<string, unknown>, issues: ValidationIssue[]): void {
  if (typeof value.active !== "boolean") issues.push(issue(["active"], "invalid_type"));
  if (!profileStatuses.includes(value.status as ProfileStatus)) {
    issues.push(issue(["status"], "unknown_enum"));
  }
  if (value.schemaVersion !== "1") issues.push(issue(["schemaVersion"], "unknown_version"));
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (
      typeof value[field] !== "string" ||
      !dateTimePattern.test(value[field]) ||
      !isValidCalendarDate(value[field])
    ) {
      issues.push(issue([field], "invalid_iso_datetime"));
    }
  }
  for (const field of ["createdBy", "updatedBy"] as const) {
    if (!isNonEmptyText(value[field], 128)) issues.push(issue([field], "invalid_text"));
  }
}

function validateCommonIdentity(
  value: Record<string, unknown>,
  fields: readonly string[],
  issues: ValidationIssue[],
  optionalFields: readonly string[] = [],
): void {
  if (!isPlainRecord(value)) {
    issues.push(issue([], "invalid_type"));
    return;
  }
  if (!hasExactFields(value, fields, optionalFields)) {
    issues.push(issue([], "unexpected_property"));
  }
  for (const field of ["userId", "studentId", "academyId", "familyId"] as const) {
    if (field in value && !isNonEmptyText(value[field], 128)) {
      issues.push(issue([field], "invalid_text"));
    }
  }
  validateAuditFields(value, issues);
}

function parseOptionalText(
  value: Record<string, unknown>,
  field: "familyId" | "userId" | "phoneNumber" | "email",
  maxLength: number,
  issues: ValidationIssue[],
): string | undefined {
  if (!Object.hasOwn(value, field)) return undefined;
  const current = value[field];
  const valid = field === "email" ? isEmail(current) : isNonEmptyText(current, maxLength);
  if (!valid) issues.push(issue([field], field === "email" ? "invalid_email" : "invalid_text"));
  return valid ? (current as string) : undefined;
}

function parseProfileResult<T>(
  value: T,
  issues: readonly ValidationIssue[],
): Result<T, readonly ValidationIssue[]> {
  return issues.length === 0 ? ok(Object.freeze(value)) : err(Object.freeze([...issues]));
}

export function parseUserProfile(value: unknown): Result<UserProfile, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
  validateCommonIdentity(value, userProfileFields, issues);
  if (value.accountType !== "client") issues.push(issue(["accountType"], "unknown_enum"));
  for (const field of ["displayName", "phoneNumber"] as const) {
    if (!isNonEmptyText(value[field], field === "displayName" ? 160 : 64)) {
      issues.push(issue([field], "invalid_text"));
    }
  }
  if (!isEmail(value.email)) issues.push(issue(["email"], "invalid_email"));
  return parseProfileResult(value as UserProfile, issues);
}

export function parseStudentProfile(
  value: unknown,
): Result<StudentProfile, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
  validateCommonIdentity(value, studentRequiredProfileFields, issues, [
    "familyId",
    "userId",
    "phoneNumber",
    "email",
  ]);
  if (!isNonEmptyText(value.fullName, 160)) issues.push(issue(["fullName"], "invalid_text"));
  if (
    typeof value.dateOfBirth !== "string" ||
    !dateOnlyPattern.test(value.dateOfBirth) ||
    !isValidCalendarDate(value.dateOfBirth) ||
    value.dateOfBirth > new Date().toISOString().slice(0, 10)
  ) {
    issues.push(issue(["dateOfBirth"], "invalid_date"));
  }
  parseOptionalText(value, "familyId", 128, issues);
  parseOptionalText(value, "userId", 128, issues);
  parseOptionalText(value, "phoneNumber", 64, issues);
  parseOptionalText(value, "email", 320, issues);
  if (!trainingCenters.includes(value.trainingCenter as TrainingCenter)) {
    issues.push(issue(["trainingCenter"], "unknown_enum"));
  }
  if (
    !Array.isArray(value.trainingTimePreferences) ||
    value.trainingTimePreferences.length === 0 ||
    new Set(value.trainingTimePreferences).size !== value.trainingTimePreferences.length ||
    value.trainingTimePreferences.some(
      (preference) => !trainingTimePreferences.includes(preference as TrainingTimePreference),
    )
  ) {
    issues.push(issue(["trainingTimePreferences"], "invalid_preferences"));
  }
  if (!participantTypes.includes(value.participantType as ParticipantType)) {
    issues.push(issue(["participantType"], "unknown_enum"));
  }
  const parsed = {
    ...(value as StudentProfile),
    ...(Array.isArray(value.trainingTimePreferences)
      ? { trainingTimePreferences: Object.freeze([...value.trainingTimePreferences]) }
      : {}),
  } as StudentProfile;
  return parseProfileResult(parsed, issues);
}

export function deriveParticipantType(dateOfBirth: string, today: string): ParticipantType {
  if (
    !dateOnlyPattern.test(dateOfBirth) ||
    !isValidCalendarDate(dateOfBirth) ||
    !dateOnlyPattern.test(today) ||
    !isValidCalendarDate(today) ||
    dateOfBirth > today
  ) {
    throw new Error("Invalid participant date");
  }
  const birthday = new Date(dateOfBirth);
  const current = new Date(today);
  let age = current.getUTCFullYear() - birthday.getUTCFullYear();
  const birthdayNotReached =
    current.getUTCMonth() < birthday.getUTCMonth() ||
    (current.getUTCMonth() === birthday.getUTCMonth() &&
      current.getUTCDate() < birthday.getUTCDate());
  if (birthdayNotReached) age -= 1;
  return age >= 18 ? "adult" : "minor";
}
