import type { ValidationIssue } from "../errors";
import type {
  StudentProfile,
  TrainingCenter,
  TrainingTimePreference,
  UserProfile,
} from "../profiles/profile-contracts";
import { err, ok, type Result } from "../result";

export const familyStatuses = Object.freeze(["active", "inactive"] as const);
export type FamilyStatus = (typeof familyStatuses)[number];

export const relationshipStatuses = Object.freeze(["active", "inactive"] as const);
export type RelationshipStatus = (typeof relationshipStatuses)[number];

export const relationshipTypes = Object.freeze(["guardian"] as const);
export type RelationshipType = (typeof relationshipTypes)[number];

export const familyPermissions = Object.freeze(["readProfile"] as const);
export type FamilyPermission = (typeof familyPermissions)[number];

type FamilyAuditFields = Readonly<{
  active: boolean;
  status: FamilyStatus;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type FamilyRecord = Readonly<{
  familyId: string;
  academyId: string;
  primaryContactUserId: string;
  billingContactUserId: string;
}> &
  FamilyAuditFields;

export type FamilyRelationship = Readonly<{
  relationshipId: string;
  academyId: string;
  familyId: string;
  studentId: string;
  adultUserId: string;
  relationshipType: RelationshipType;
  permissions: readonly FamilyPermission[];
  validFrom: string;
  validTo?: string;
}> &
  Readonly<{
    active: boolean;
    status: RelationshipStatus;
    schemaVersion: "1";
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
  }>;

export type FamilyStudentDraft = Readonly<{
  fullName: string;
  dateOfBirth: string;
  phoneNumber?: string;
  email?: string;
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
}>;

export type StaffFamilyProjection = Readonly<{
  family: FamilyRecord;
  students: readonly StudentProfile[];
  relationships: readonly FamilyRelationship[];
}>;

export type GuardianFamilyProjection = Readonly<{
  family: Readonly<Pick<FamilyRecord, "familyId" | "active" | "status">>;
  tutor: Readonly<Pick<UserProfile, "userId" | "displayName" | "email" | "phoneNumber">>;
  students: readonly Readonly<
    Pick<
      StudentProfile,
      | "studentId"
      | "fullName"
      | "dateOfBirth"
      | "trainingCenter"
      | "trainingTimePreferences"
      | "active"
      | "status"
    >
  >[];
}>;

const familyFields = Object.freeze([
  "familyId",
  "academyId",
  "primaryContactUserId",
  "billingContactUserId",
  "active",
  "status",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);

const relationshipFields = Object.freeze([
  "relationshipId",
  "academyId",
  "familyId",
  "studentId",
  "adultUserId",
  "relationshipType",
  "permissions",
  "validFrom",
  "validTo",
  "active",
  "status",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);

const relationshipRequiredFields = relationshipFields.filter((field) => field !== "validTo");
const studentDraftFields = Object.freeze([
  "fullName",
  "dateOfBirth",
  "phoneNumber",
  "email",
  "trainingCenter",
  "trainingTimePreferences",
] as const);
const studentDraftRequiredFields = studentDraftFields.filter(
  (field) => field !== "phoneNumber" && field !== "email",
);

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
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

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
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

function isValidCalendarDate(value: string, dateTime = false): boolean {
  const pattern = dateTime ? dateTimePattern : dateOnlyPattern;
  if (!pattern.test(value)) return false;
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

function validateAuditFields(
  value: Record<string, unknown>,
  issues: ValidationIssue[],
  statuses: readonly string[],
): void {
  if (typeof value.active !== "boolean") issues.push(issue(["active"], "invalid_type"));
  if (!statuses.includes(value.status as string)) issues.push(issue(["status"], "unknown_enum"));
  if (value.schemaVersion !== "1") issues.push(issue(["schemaVersion"], "unknown_version"));
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (typeof value[field] !== "string" || !isValidCalendarDate(value[field], true)) {
      issues.push(issue([field], "invalid_iso_datetime"));
    }
  }
  for (const field of ["createdBy", "updatedBy"] as const) {
    if (!isIdentifier(value[field])) issues.push(issue([field], "invalid_id"));
  }
}

function validateIds(
  value: Record<string, unknown>,
  fields: readonly string[],
  issues: ValidationIssue[],
): void {
  for (const field of fields) {
    if (!isIdentifier(value[field])) issues.push(issue([field], "invalid_id"));
  }
}

function parseResult<T>(
  value: T,
  issues: readonly ValidationIssue[],
): Result<T, readonly ValidationIssue[]> {
  return issues.length === 0 ? ok(Object.freeze(value)) : err(Object.freeze([...issues]));
}

export function parseFamilyRecord(
  value: unknown,
): Result<FamilyRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
  if (!hasExactFields(value, familyFields)) issues.push(issue([], "unexpected_property"));
  validateIds(
    value,
    ["familyId", "academyId", "primaryContactUserId", "billingContactUserId"],
    issues,
  );
  validateAuditFields(value, issues, familyStatuses);
  if (value.primaryContactUserId !== value.billingContactUserId) {
    issues.push(issue(["billingContactUserId"], "must_match_primary_contact"));
  }
  if (value.active !== (value.status === "active"))
    issues.push(issue(["active"], "status_mismatch"));
  return parseResult({ ...(value as FamilyRecord) }, issues);
}

export function parseFamilyRelationship(
  value: unknown,
): Result<FamilyRelationship, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
  if (!hasExactFields(value, relationshipRequiredFields, ["validTo"])) {
    issues.push(issue([], "unexpected_property"));
  }
  validateIds(
    value,
    ["relationshipId", "academyId", "familyId", "studentId", "adultUserId"],
    issues,
  );
  if (!relationshipTypes.includes(value.relationshipType as RelationshipType)) {
    issues.push(issue(["relationshipType"], "unknown_enum"));
  }
  if (
    !Array.isArray(value.permissions) ||
    value.permissions.length !== 1 ||
    value.permissions[0] !== "readProfile" ||
    new Set(value.permissions).size !== value.permissions.length
  ) {
    issues.push(issue(["permissions"], "invalid_permissions"));
  }
  for (const field of ["validFrom", "validTo"] as const) {
    if (field === "validTo" && !Object.hasOwn(value, field)) continue;
    if (typeof value[field] !== "string" || !isValidCalendarDate(value[field], true)) {
      issues.push(issue([field], "invalid_iso_datetime"));
    }
  }
  validateAuditFields(value, issues, relationshipStatuses);
  if (value.active !== (value.status === "active"))
    issues.push(issue(["active"], "status_mismatch"));
  if (
    typeof value.validFrom === "string" &&
    typeof value.validTo === "string" &&
    value.validTo < value.validFrom
  ) {
    issues.push(issue(["validTo"], "invalid_range"));
  }
  const parsed = {
    ...(value as FamilyRelationship),
    permissions: Array.isArray(value.permissions)
      ? Object.freeze([...value.permissions] as FamilyPermission[])
      : value.permissions,
  } as FamilyRelationship;
  return parseResult(parsed, issues);
}

export function parseFamilyStudentDraft(
  value: unknown,
): Result<FamilyStudentDraft, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
  if (!hasExactFields(value, studentDraftRequiredFields, ["phoneNumber", "email"])) {
    issues.push(issue([], "unexpected_property"));
  }
  if (!isNonEmptyText(value.fullName, 160)) issues.push(issue(["fullName"], "invalid_text"));
  if (
    typeof value.dateOfBirth !== "string" ||
    !isValidCalendarDate(value.dateOfBirth) ||
    value.dateOfBirth > new Date().toISOString().slice(0, 10)
  ) {
    issues.push(issue(["dateOfBirth"], "invalid_date"));
  }
  if (!isIdentifier(value.trainingCenter)) issues.push(issue(["trainingCenter"], "unknown_enum"));
  if (!(value.trainingCenter === "Town" || value.trainingCenter === "West")) {
    issues.push(issue(["trainingCenter"], "unknown_enum"));
  }
  if (
    !Array.isArray(value.trainingTimePreferences) ||
    value.trainingTimePreferences.length === 0 ||
    new Set(value.trainingTimePreferences).size !== value.trainingTimePreferences.length ||
    value.trainingTimePreferences.some(
      (preference) =>
        preference !== "morning" && preference !== "afternoon" && preference !== "evening",
    )
  ) {
    issues.push(issue(["trainingTimePreferences"], "invalid_preferences"));
  }
  for (const field of ["phoneNumber", "email"] as const) {
    if (!Object.hasOwn(value, field)) continue;
    const valid = field === "email" ? isEmail(value[field]) : isNonEmptyText(value[field], 64);
    if (!valid) issues.push(issue([field], field === "email" ? "invalid_email" : "invalid_text"));
  }
  const parsed = {
    ...(value as FamilyStudentDraft),
    trainingTimePreferences: Array.isArray(value.trainingTimePreferences)
      ? Object.freeze([...value.trainingTimePreferences] as TrainingTimePreference[])
      : value.trainingTimePreferences,
  } as FamilyStudentDraft;
  return parseResult(parsed, issues);
}
