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

export const waitlistOfferResponses = Object.freeze(["accept", "decline"] as const);
export type WaitlistOfferResponse = (typeof waitlistOfferResponses)[number];

export type JoinWaitlistInput = Readonly<{
  sessionId: string;
  studentId: string;
  membershipId: string;
}>;

export type IssueNextWaitlistOfferInput = Readonly<{
  sessionId: string;
}>;

export type RespondToWaitlistOfferInput = Readonly<{
  sessionId: string;
  studentId: string;
  response: WaitlistOfferResponse;
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
const waitlistDocumentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return Object.freeze({ path: Object.freeze([...path]), code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  } catch {
    return false;
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isTrimmedIdentifier(value: unknown): value is string {
  return typeof value === "string" && isIdentifier(value.trim());
}

function isWaitlistDocumentId(value: unknown): value is string {
  return typeof value === "string" && waitlistDocumentIdPattern.test(value);
}

function isDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (match === null) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
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
  try {
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
  } catch {
    issues.push(issue([], "unsafe_object"));
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
  if (isDateTime(start) && isDateTime(end) && compareDateTimes(end, start) <= 0) {
    issues.push(issue([path], "invalid_datetime_order"));
  }
}

function toEpochNanoseconds(value: string): bigint {
  const fraction = /\.(\d{1,9})(?=Z|[+-]\d{2}:?\d{2}$)/u.exec(value)?.[1] ?? "";
  const milliseconds = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
  const nanoseconds = fraction.length === 0 ? 0 : Number(fraction.padEnd(9, "0"));
  const epochWithoutFraction = Date.parse(value) - milliseconds;
  return BigInt(epochWithoutFraction) * BigInt(1_000_000) + BigInt(nanoseconds);
}

export function compareDateTimes(left: string, right: string): number {
  const leftNanoseconds = toEpochNanoseconds(left);
  const rightNanoseconds = toEpochNanoseconds(right);
  return leftNanoseconds < rightNanoseconds ? -1 : leftNanoseconds > rightNanoseconds ? 1 : 0;
}

function validateDateNotBefore(
  earlier: unknown,
  later: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (isDateTime(earlier) && isDateTime(later) && compareDateTimes(later, earlier) < 0) {
    issues.push(issue([path], "invalid_datetime_order"));
  }
}

/** Builds the legacy identifier retained for explicit compatibility reads. */
export function buildLegacyWaitlistId(sessionId: string, studentId: string): string {
  return sessionId.trim() + "__" + studentId.trim();
}

/** Builds the canonical injective identifier for new waitlist writes. */
export function buildWaitlistIdV2(sessionId: string, studentId: string): string {
  const normalizedSessionId = sessionId.trim();
  const normalizedStudentId = studentId.trim();
  return `v2:${normalizedSessionId.length}:${normalizedSessionId}:${normalizedStudentId.length}:${normalizedStudentId}`;
}

/** Canonical builder for new waitlist writes. */
export function buildWaitlistId(sessionId: string, studentId: string): string {
  return buildWaitlistIdV2(sessionId, studentId);
}

/** Ordered document IDs for compatibility reads: canonical first, legacy second. */
export function buildWaitlistIdCandidates(
  sessionId: string,
  studentId: string,
): readonly [string, string] {
  return Object.freeze([
    buildWaitlistIdV2(sessionId, studentId),
    buildLegacyWaitlistId(sessionId, studentId),
  ]);
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

export function parseIssueNextWaitlistOfferInput(
  input: unknown,
): Result<IssueNextWaitlistOfferInput, readonly ValidationIssue[]> {
  if (!isRecord(input)) return err(Object.freeze([issue([], "not_an_object")]));
  const issues: ValidationIssue[] = [];
  const value = readFields(input, ["sessionId"], issues);
  if (!isTrimmedIdentifier(value.sessionId)) {
    issues.push(issue(["sessionId"], "invalid_identifier"));
  }
  return parseResult(
    issues.length === 0
      ? Object.freeze({ sessionId: (value.sessionId as string).trim() })
      : undefined,
    issues,
  );
}

export function parseRespondToWaitlistOfferInput(
  input: unknown,
): Result<RespondToWaitlistOfferInput, readonly ValidationIssue[]> {
  if (!isRecord(input)) return err(Object.freeze([issue([], "not_an_object")]));
  const issues: ValidationIssue[] = [];
  const value = readFields(input, ["sessionId", "studentId", "response"], issues);
  for (const field of ["sessionId", "studentId"] as const) {
    if (!isTrimmedIdentifier(value[field])) {
      issues.push(issue([field], "invalid_identifier"));
    }
  }
  if (!waitlistOfferResponses.includes(value.response as WaitlistOfferResponse)) {
    issues.push(issue(["response"], "unknown_enum"));
  }
  return parseResult(
    issues.length === 0
      ? Object.freeze({
          sessionId: (value.sessionId as string).trim(),
          studentId: (value.studentId as string).trim(),
          response: value.response as WaitlistOfferResponse,
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
  if (!isWaitlistDocumentId(value.waitlistId)) {
    issues.push(issue(["waitlistId"], "invalid_identifier"));
  }
  for (const field of [
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
  const requestedAt = value.requestedAt as string;
  const createdAt = value.createdAt as string;
  const updatedAt = value.updatedAt as string;
  const invalidTimestamps =
    status === "waiting"
      ? offeredAt !== null || offerExpiresAt !== null || acceptedAt !== null || cancelledAt !== null
      : status === "offered"
        ? offeredAt === null ||
          offerExpiresAt === null ||
          acceptedAt !== null ||
          cancelledAt !== null
        : status === "accepted"
          ? offeredAt === null ||
            offerExpiresAt === null ||
            acceptedAt === null ||
            cancelledAt !== null
          : status === "expired"
            ? offeredAt === null ||
              offerExpiresAt === null ||
              acceptedAt !== null ||
              cancelledAt !== null
            : status === "cancelled"
              ? cancelledAt === null ||
                acceptedAt !== null ||
                (offeredAt === null) !== (offerExpiresAt === null)
              : false;
  if (invalidTimestamps) issues.push(issue(["status"], "invalid_status_timestamps"));

  validateDateNotBefore(createdAt, requestedAt, "requestedAt", issues);
  validateDateNotBefore(requestedAt, updatedAt, "updatedAt", issues);
  validateDateOrder(offeredAt, offerExpiresAt, "offerExpiresAt", issues);
  if (offeredAt !== null) {
    validateDateNotBefore(requestedAt, offeredAt, "offeredAt", issues);
  }
  if (status === "offered" && offeredAt !== null) {
    validateDateNotBefore(offeredAt, updatedAt, "updatedAt", issues);
  }
  if (
    status === "accepted" &&
    offeredAt !== null &&
    offerExpiresAt !== null &&
    acceptedAt !== null
  ) {
    validateDateNotBefore(offeredAt, acceptedAt, "acceptedAt", issues);
    if (isDateTime(acceptedAt) && isDateTime(offerExpiresAt)) {
      if (compareDateTimes(acceptedAt, offerExpiresAt) >= 0) {
        issues.push(issue(["acceptedAt"], "outside_offer_window"));
      }
    }
    validateDateNotBefore(acceptedAt, updatedAt, "updatedAt", issues);
  }
  if (status === "expired" && offerExpiresAt !== null) {
    validateDateNotBefore(offerExpiresAt, updatedAt, "updatedAt", issues);
  }
  if (status === "cancelled" && cancelledAt !== null) {
    if (offeredAt === null || offerExpiresAt === null) {
      validateDateNotBefore(requestedAt, cancelledAt, "cancelledAt", issues);
    } else {
      validateDateNotBefore(offeredAt, cancelledAt, "cancelledAt", issues);
      if (isDateTime(cancelledAt) && isDateTime(offerExpiresAt)) {
        if (compareDateTimes(cancelledAt, offerExpiresAt) >= 0) {
          issues.push(issue(["cancelledAt"], "outside_offer_window"));
        }
      }
    }
    validateDateNotBefore(cancelledAt, updatedAt, "updatedAt", issues);
  }

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
          requestedAt,
          offeredAt,
          offerExpiresAt,
          acceptedAt,
          cancelledAt,
          schemaVersion: "1" as const,
          createdAt,
          createdBy: value.createdBy as string,
          updatedAt,
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
    issues.push(issue(["reason"], "unknown_enum"));
  if (!bookingCreditStatuses.includes(value.status as BookingCreditStatus))
    issues.push(issue(["status"], "unknown_enum"));
  if (!isNullableDateTime(value.expiresAt))
    issues.push(issue(["expiresAt"], "invalid_iso_datetime"));
  if (!isNullableIdentifier(value.relatedSessionId))
    issues.push(issue(["relatedSessionId"], "invalid_identifier"));
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
