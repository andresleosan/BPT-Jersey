import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const waitlistStatuses = Object.freeze([
  "waiting",
  "offered",
  "accepted",
  "expired",
  "cancelled",
] as const);
export type WaitlistStatus = (typeof waitlistStatuses)[number];

export type JoinWaitlistInput = Readonly<{
  sessionId: string;
  studentId: string;
  membershipId: string;
}>;

export type WaitlistEntryRecord = Readonly<{
  waitlistId: string;
  academyId: string;
  sessionId: string;
  studentId: string;
  membershipId: string;
  position: number;
  status: WaitlistStatus;
  requestedAt: string;
  offeredAt: string | null;
  offerExpiresAt: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export const bookingCreditReasons = Object.freeze([
  "late_cancel",
  "session_cancelled",
  "admin_grant",
  "manual_adjustment",
] as const);
export type BookingCreditReason = (typeof bookingCreditReasons)[number];

export const bookingCreditStatuses = Object.freeze([
  "available",
  "exhausted",
  "expired",
  "voided",
] as const);
export type BookingCreditStatus = (typeof bookingCreditStatuses)[number];

export type GrantBookingCreditInput = Readonly<{
  studentId: string;
  units: number;
  reason: BookingCreditReason;
  expiresAt: string | null;
  relatedSessionId: string | null;
}>;

export type BookingCreditRecord = Readonly<{
  creditId: string;
  academyId: string;
  studentId: string;
  units: number;
  remainingUnits: number;
  reason: BookingCreditReason;
  expiresAt: string | null;
  relatedSessionId: string | null;
  status: BookingCreditStatus;
  issuedAt: string;
  issuedBy: string;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type BookingCreditBalance = Readonly<{
  units: number;
  remainingUnits: number;
  status: Extract<BookingCreditStatus, "available" | "exhausted">;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return Object.freeze({ path: Object.freeze([...path]), code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isTrimmedIdentifier(value: unknown): value is string {
  return typeof value === "string" && isIdentifier(value.trim());
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isDateTime(value);
}

function isNullableIdentifier(value: unknown): value is string | null {
  return value === null || isIdentifier(value);
}

function readFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  issues: ValidationIssue[],
): Record<string, unknown> {
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor =
      typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (
      typeof key !== "string" ||
      !fields.includes(key) ||
      descriptor?.enumerable !== true ||
      descriptor?.get !== undefined ||
      descriptor?.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      issues.push(issue(typeof key === "string" ? [key] : [], "unexpected_property"));
    } else {
      snapshot[key] = descriptor.value;
    }
  }
  for (const field of fields) {
    if (!Object.hasOwn(snapshot, field)) issues.push(issue([field], "missing_property"));
  }
  return snapshot;
}

function parseResult<T>(
  value: T | undefined,
  issues: readonly ValidationIssue[],
): Result<T, readonly ValidationIssue[]> {
  return issues.length === 0 && value !== undefined
    ? ok(Object.freeze(value))
    : err(Object.freeze([...issues]));
}

function validateDateOrder(
  start: unknown,
  end: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (isDateTime(start) && isDateTime(end) && Date.parse(end) <= Date.parse(start)) {
    issues.push(issue([path], "invalid_datetime_order"));
  }
}

export function buildWaitlistId(sessionId: string, studentId: string): string {
  return sessionId.trim() + "__" + studentId.trim();
}

export function parseJoinWaitlistInput(
  input: unknown,
): Result<JoinWaitlistInput, readonly ValidationIssue[]> {
  if (!isRecord(input)) return err(Object.freeze([issue([], "not_an_object")]));
  const issues: ValidationIssue[] = [];
  const value = readFields(input, ["sessionId", "studentId", "membershipId"], issues);
  for (const field of ["sessionId", "studentId", "membershipId"] as const) {
    if (!isTrimmedIdentifier(value[field])) issues.push(issue([field], "invalid_identifier"));
  }
  return parseResult(
    issues.length === 0
      ? Object.freeze({
          sessionId: (value.sessionId as string).trim(),
          studentId: (value.studentId as string).trim(),
          membershipId: (value.membershipId as string).trim(),
        })
      : undefined,
    issues,
  );
}

const waitlistFields = [
  "waitlistId",
  "academyId",
  "sessionId",
  "studentId",
  "membershipId",
  "position",
  "status",
  "requestedAt",
  "offeredAt",
  "offerExpiresAt",
  "acceptedAt",
  "cancelledAt",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const;

export function parseWaitlistEntryRecord(
  input: unknown,
): Result<WaitlistEntryRecord, readonly ValidationIssue[]> {
  if (!isRecord(input)) return err(Object.freeze([issue([], "not_an_object")]));
  const issues: ValidationIssue[] = [];
  const value = readFields(input, waitlistFields, issues);
  for (const field of [
    "waitlistId",
    "academyId",
    "sessionId",
    "studentId",
    "membershipId",
    "createdBy",
    "updatedBy",
  ] as const) {
    if (!isIdentifier(value[field])) issues.push(issue([field], "invalid_identifier"));
  }
  if (
    typeof value.position !== "number" ||
    !Number.isInteger(value.position) ||
    value.position < 1 ||
    value.position > 10000
  ) {
    issues.push(issue(["position"], "invalid_position"));
  }
  if (!waitlistStatuses.includes(value.status as WaitlistStatus))
    issues.push(issue(["status"], "unknown_enum"));
  for (const field of ["requestedAt", "createdAt", "updatedAt"] as const) {
    if (!isDateTime(value[field])) issues.push(issue([field], "invalid_iso_datetime"));
  }
  for (const field of ["offeredAt", "offerExpiresAt", "acceptedAt", "cancelledAt"] as const) {
    if (!isNullableDateTime(value[field])) issues.push(issue([field], "invalid_iso_datetime"));
  }
  if (value.schemaVersion !== "1") issues.push(issue(["schemaVersion"], "unsupported_version"));

  const status = value.status as WaitlistStatus;
  const offeredAt = value.offeredAt as string | null;
  const offerExpiresAt = value.offerExpiresAt as string | null;
  const acceptedAt = value.acceptedAt as string | null;
  const cancelledAt = value.cancelledAt as string | null;
  const invalidTimestamps =
    status === "waiting"
      ? offeredAt !== null || offerExpiresAt !== null || acceptedAt !== null || cancelledAt !== null
      : status === "offered"
        ? offeredAt === null ||
          offerExpiresAt === null ||
          acceptedAt !== null ||
          cancelledAt !== null
        : status === "accepted"
          ? offeredAt === null || acceptedAt === null || cancelledAt !== null
          : status === "expired"
            ? offeredAt === null ||
              offerExpiresAt === null ||
              acceptedAt !== null ||
              cancelledAt !== null
            : status === "cancelled"
              ? cancelledAt === null || acceptedAt !== null
              : false;
  if (invalidTimestamps) issues.push(issue(["status"], "invalid_status_timestamps"));
  validateDateOrder(offeredAt, offerExpiresAt, "offerExpiresAt", issues);

  return parseResult(
    issues.length === 0
      ? Object.freeze({
          waitlistId: value.waitlistId as string,
          academyId: value.academyId as string,
          sessionId: value.sessionId as string,
          studentId: value.studentId as string,
          membershipId: value.membershipId as string,
          position: value.position as number,
          status,
          requestedAt: value.requestedAt as string,
          offeredAt,
          offerExpiresAt,
          acceptedAt,
          cancelledAt,
          schemaVersion: "1" as const,
          createdAt: value.createdAt as string,
          createdBy: value.createdBy as string,
          updatedAt: value.updatedAt as string,
          updatedBy: value.updatedBy as string,
        })
      : undefined,
    issues,
  );
}

const creditGrantFields = [
  "studentId",
  "units",
  "reason",
  "expiresAt",
  "relatedSessionId",
] as const;

export function parseGrantBookingCreditInput(
  input: unknown,
): Result<GrantBookingCreditInput, readonly ValidationIssue[]> {
  if (!isRecord(input)) return err(Object.freeze([issue([], "not_an_object")]));
  const issues: ValidationIssue[] = [];
  const value = readFields(input, creditGrantFields, issues);
  if (!isTrimmedIdentifier(value.studentId))
    issues.push(issue(["studentId"], "invalid_identifier"));
  if (
    typeof value.units !== "number" ||
    !Number.isInteger(value.units) ||
    value.units < 1 ||
    value.units > 10000
  ) {
    issues.push(issue(["units"], "invalid_units"));
  }
  if (!bookingCreditReasons.includes(value.reason as BookingCreditReason))
    issues.push(issue(["reason"], "unknown_enum"));
  if (!isNullableDateTime(value.expiresAt))
    issues.push(issue(["expiresAt"], "invalid_iso_datetime"));
  if (!isNullableIdentifier(value.relatedSessionId))
    issues.push(issue(["relatedSessionId"], "invalid_identifier"));
  return parseResult(
    issues.length === 0
      ? Object.freeze({
          studentId: (value.studentId as string).trim(),
          units: value.units as number,
          reason: value.reason as BookingCreditReason,
          expiresAt: value.expiresAt as string | null,
          relatedSessionId: value.relatedSessionId as string | null,
        })
      : undefined,
    issues,
  );
}

const creditRecordFields = [
  "creditId",
  "academyId",
  "studentId",
  "units",
  "remainingUnits",
  "reason",
  "expiresAt",
  "relatedSessionId",
  "status",
  "issuedAt",
  "issuedBy",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const;

export function parseBookingCreditRecord(
  input: unknown,
): Result<BookingCreditRecord, readonly ValidationIssue[]> {
  if (!isRecord(input)) return err(Object.freeze([issue([], "not_an_object")]));
  const issues: ValidationIssue[] = [];
  const value = readFields(input, creditRecordFields, issues);
  for (const field of [
    "creditId",
    "academyId",
    "studentId",
    "issuedBy",
    "createdBy",
    "updatedBy",
  ] as const) {
    if (!isIdentifier(value[field])) issues.push(issue([field], "invalid_identifier"));
  }
  for (const field of ["units", "remainingUnits"] as const) {
    if (
      typeof value[field] !== "number" ||
      !Number.isInteger(value[field]) ||
      value[field] < 0 ||
      value[field] > 10000
    ) {
      issues.push(issue([field], "invalid_units"));
    }
  }
  if (
    typeof value.units === "number" &&
    typeof value.remainingUnits === "number" &&
    value.remainingUnits > value.units
  ) {
    issues.push(issue(["remainingUnits"], "exceeds_units"));
  }
  if (!bookingCreditReasons.includes(value.reason as BookingCreditReason))
    issue(["reason"], "unknown_enum");
  if (!bookingCreditStatuses.includes(value.status as BookingCreditStatus))
    issues.push(issue(["status"], "unknown_enum"));
  if (!isNullableDateTime(value.expiresAt)) issue(["expiresAt"], "invalid_iso_datetime");
  if (!isNullableIdentifier(value.relatedSessionId))
    issue(["relatedSessionId"], "invalid_identifier");
  for (const field of ["issuedAt", "createdAt", "updatedAt"] as const) {
    if (!isDateTime(value[field])) issues.push(issue([field], "invalid_iso_datetime"));
  }
  if (value.schemaVersion !== "1") issues.push(issue(["schemaVersion"], "unsupported_version"));
  if (value.status === "available" && value.remainingUnits === 0)
    issues.push(issue(["status"], "available_requires_balance"));
  if (value.status === "exhausted" && value.remainingUnits !== 0) {
    issues.push(issue(["status"], "exhausted_requires_zero_balance"));
  }
  return parseResult(
    issues.length === 0
      ? Object.freeze({
          creditId: value.creditId as string,
          academyId: value.academyId as string,
          studentId: value.studentId as string,
          units: value.units as number,
          remainingUnits: value.remainingUnits as number,
          reason: value.reason as BookingCreditReason,
          expiresAt: value.expiresAt as string | null,
          relatedSessionId: value.relatedSessionId as string | null,
          status: value.status as BookingCreditStatus,
          issuedAt: value.issuedAt as string,
          issuedBy: value.issuedBy as string,
          schemaVersion: "1" as const,
          createdAt: value.createdAt as string,
          createdBy: value.createdBy as string,
          updatedAt: value.updatedAt as string,
          updatedBy: value.updatedBy as string,
        })
      : undefined,
    issues,
  );
}

function validateBalance(balance: BookingCreditBalance): string | null {
  if (!Number.isInteger(balance.units) || balance.units < 1)
    return "units must be a positive integer";
  if (!Number.isInteger(balance.remainingUnits) || balance.remainingUnits < 0) {
    return "remainingUnits must be a non-negative integer";
  }
  if (balance.remainingUnits > balance.units) return "remainingUnits cannot exceed units";
  if (balance.status === "available" && balance.remainingUnits === 0) {
    return "available balance must be greater than zero";
  }
  if (balance.status === "exhausted" && balance.remainingUnits !== 0) {
    return "exhausted balance must be zero";
  }
  return null;
}

export function applyCreditUsage(
  balance: BookingCreditBalance,
  consumedUnits: number,
): Result<BookingCreditBalance, string> {
  const error = validateBalance(balance);
  if (error !== null) return err(error);
  if (balance.status !== "available") return err("Only available credits can be consumed");
  if (!Number.isInteger(consumedUnits) || consumedUnits < 1)
    return err("consumedUnits must be a positive integer");
  if (consumedUnits > balance.remainingUnits) return err("consumedUnits exceeds remaining balance");
  const remainingUnits = balance.remainingUnits - consumedUnits;
  return ok(
    Object.freeze({
      units: balance.units,
      remainingUnits,
      status: remainingUnits === 0 ? ("exhausted" as const) : ("available" as const),
    }),
  );
}

export function reverseCreditUsage(
  balance: BookingCreditBalance,
  reversedUnits: number,
): Result<BookingCreditBalance, string> {
  const error = validateBalance(balance);
  if (error !== null) return err(error);
  if (balance.status !== "available" && balance.status !== "exhausted") {
    return err("Expired or voided credits cannot be reversed");
  }
  if (!Number.isInteger(reversedUnits) || reversedUnits < 1)
    return err("reversedUnits must be a positive integer");
  if (balance.remainingUnits + reversedUnits > balance.units) {
    return err("reversedUnits exceeds original credit units");
  }
  return ok(
    Object.freeze({
      units: balance.units,
      remainingUnits: balance.remainingUnits + reversedUnits,
      status: "available" as const,
    }),
  );
}
