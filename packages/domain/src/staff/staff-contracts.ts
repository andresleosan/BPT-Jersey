import type { ValidationIssue } from "../errors";
import type { AcademyId, StaffId, UserId } from "../identifiers";
import { err, ok, type Result } from "../result";

export const staffRoles = Object.freeze(["headCoach", "coach"] as const);
export type StaffRole = (typeof staffRoles)[number];

export const staffStatuses = Object.freeze(["active", "inactive"] as const);
export type StaffStatus = (typeof staffStatuses)[number];

export const staffAssignmentTargetTypes = Object.freeze(["location", "program", "class"] as const);
export type StaffAssignmentTargetType = (typeof staffAssignmentTargetTypes)[number];

export type StaffProfile = Readonly<{
  staffId: StaffId;
  academyId: AcademyId;
  userId: UserId;
  role: StaffRole;
  active: boolean;
  status: StaffStatus;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type StaffRoleAssignment = Readonly<{
  academyId: AcademyId;
  staffId: StaffId;
  targetType: StaffAssignmentTargetType;
  targetId: string;
}>;

export type StaffAvailabilityWindow = Readonly<{
  academyId: AcademyId;
  staffId: StaffId;
  weekday: number;
  startLocal: string;
  endLocal: string;
  timezone: string;
}>;

const staffProfileFields = Object.freeze([
  "staffId",
  "academyId",
  "userId",
  "role",
  "active",
  "status",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);

const staffAssignmentFields = Object.freeze([
  "academyId",
  "staffId",
  "targetType",
  "targetId",
] as const);

const staffAvailabilityFields = Object.freeze([
  "academyId",
  "staffId",
  "weekday",
  "startLocal",
  "endLocal",
  "timezone",
] as const);

const isoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

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

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => {
      if (typeof key !== "string" || !fields.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor?.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined &&
        Object.hasOwn(descriptor, "value")
      );
    })
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

function isIdentifier(value: unknown): value is string {
  return isNonEmptyText(value, 128) && identifierPattern.test(value);
}

function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && localTimePattern.test(value);
}

function isIsoDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !isoDateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function parseResult<T>(
  value: T,
  issues: readonly ValidationIssue[],
): Result<T, readonly ValidationIssue[]> {
  return issues.length === 0 ? ok(Object.freeze(value)) : err(Object.freeze([...issues]));
}

function validateTenantIdentity(value: Record<string, unknown>, issues: ValidationIssue[]): void {
  for (const field of ["academyId", "staffId"] as const) {
    if (!isIdentifier(value[field])) issues.push(issue([field], "invalid_id"));
  }
}

export function parseStaffProfile(
  value: unknown,
): Result<StaffProfile, readonly ValidationIssue[]> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
    if (!hasExactFields(value, staffProfileFields)) issues.push(issue([], "unexpected_property"));
    validateTenantIdentity(value, issues);
    if (!isIdentifier(value.userId)) issues.push(issue(["userId"], "invalid_id"));
    if (!staffRoles.includes(value.role as StaffRole)) issues.push(issue(["role"], "unknown_role"));
    if (typeof value.active !== "boolean") issues.push(issue(["active"], "invalid_type"));
    if (!staffStatuses.includes(value.status as StaffStatus)) {
      issues.push(issue(["status"], "unknown_status"));
    }
    if (
      typeof value.active === "boolean" &&
      staffStatuses.includes(value.status as StaffStatus) &&
      value.active !== (value.status === "active")
    ) {
      issues.push(issue([], "inconsistent_status"));
    }
    if (value.schemaVersion !== "1") issues.push(issue(["schemaVersion"], "unknown_version"));
    for (const field of ["createdAt", "updatedAt"] as const) {
      if (!isIsoDateTime(value[field])) issues.push(issue([field], "invalid_iso_datetime"));
    }
    for (const field of ["createdBy", "updatedBy"] as const) {
      if (!isIdentifier(value[field])) issues.push(issue([field], "invalid_actor"));
    }
    return parseResult(value as StaffProfile, issues);
  } catch {
    return err([issue([], "invalid_input")]);
  }
}

export function parseStaffRoleAssignment(
  value: unknown,
): Result<StaffRoleAssignment, readonly ValidationIssue[]> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
    if (!hasExactFields(value, staffAssignmentFields))
      issues.push(issue([], "unexpected_property"));
    validateTenantIdentity(value, issues);
    if (!staffAssignmentTargetTypes.includes(value.targetType as StaffAssignmentTargetType)) {
      issues.push(issue(["targetType"], "unknown_target_type"));
    }
    if (!isIdentifier(value.targetId)) issues.push(issue(["targetId"], "invalid_id"));
    return parseResult(value as StaffRoleAssignment, issues);
  } catch {
    return err([issue([], "invalid_input")]);
  }
}

export function parseStaffAvailabilityWindow(
  value: unknown,
): Result<StaffAvailabilityWindow, readonly ValidationIssue[]> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainRecord(value)) return err([issue([], "invalid_type")]);
    if (!hasExactFields(value, staffAvailabilityFields))
      issues.push(issue([], "unexpected_property"));
    validateTenantIdentity(value, issues);
    if (
      typeof value.weekday !== "number" ||
      !Number.isInteger(value.weekday) ||
      value.weekday < 0 ||
      value.weekday > 6
    ) {
      issues.push(issue(["weekday"], "invalid_weekday"));
    }
    if (!isLocalTime(value.startLocal)) issues.push(issue(["startLocal"], "invalid_local_time"));
    if (!isLocalTime(value.endLocal)) issues.push(issue(["endLocal"], "invalid_local_time"));
    if (
      isLocalTime(value.startLocal) &&
      isLocalTime(value.endLocal) &&
      value.startLocal >= value.endLocal
    ) {
      issues.push(issue(["endLocal"], "window_not_positive"));
    }
    if (!isNonEmptyText(value.timezone, 128)) {
      issues.push(issue(["timezone"], "invalid_timezone"));
    } else {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format();
      } catch {
        issues.push(issue(["timezone"], "invalid_timezone"));
      }
    }
    return parseResult(value as StaffAvailabilityWindow, issues);
  } catch {
    return err([issue([], "invalid_input")]);
  }
}
