import { err, ok, type Result } from "../result";

export const minimumOperationalSupportCodes = [
  "none",
  "mobility",
  "sensory",
  "communication",
  "supervision",
] as const;
export type MinimumOperationalSupportCode = (typeof minimumOperationalSupportCodes)[number];
export const healthReviewStates = ["current", "needs-review", "expired"] as const;
export type HealthReviewState = (typeof healthReviewStates)[number];
export const healthProfileStatuses = ["active", "inactive"] as const;
export type HealthProfileStatus = (typeof healthProfileStatuses)[number];
export const healthChangeRequestStatuses = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type HealthChangeRequestStatus = (typeof healthChangeRequestStatuses)[number];

export type HealthProfile = Readonly<{
  healthProfileId: string;
  academyId: string;
  studentId: string;
  minimumOperationalSupport: readonly MinimumOperationalSupportCode[];
  conditionSummary: string | null;
  staffReferenceLabel: string | null;
  reviewState: HealthReviewState;
  expiresAt: string | null;
  status: HealthProfileStatus;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;
export type HealthProfileChangeRequest = Readonly<{
  requestId: string;
  academyId: string;
  healthProfileId: string;
  studentId: string;
  requestedBy: string;
  proposedMinimumOperationalSupport: readonly MinimumOperationalSupportCode[];
  proposedConditionSummary: string | null;
  proposedExpiresAt: string | null;
  status: HealthChangeRequestStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}>;
export type HealthProfileSaveInput = Readonly<{
  studentId: string;
  minimumOperationalSupport: readonly MinimumOperationalSupportCode[];
  conditionSummary: string | null;
  staffReferenceLabel: string | null;
  expiresAt: string | null;
}>;
export type HealthProfileChangeRequestInput = Readonly<{
  studentId: string;
  proposedMinimumOperationalSupport: readonly MinimumOperationalSupportCode[];
  proposedConditionSummary: string | null;
  proposedExpiresAt: string | null;
}>;
export type HealthProfileRedactedProjection = Readonly<{
  healthProfileId: string;
  studentId: string;
  minimumOperationalSupport: readonly MinimumOperationalSupportCode[];
  conditionSummary: string | null;
  reviewState: HealthReviewState;
  expiresAt: string | null;
  status: HealthProfileStatus;
  schemaVersion: "1";
}>;
export type HealthProfileStaffProjection = HealthProfileRedactedProjection &
  Readonly<{ staffReferenceLabel: string | null }>;
export type HealthProfileAdminProjection = HealthProfile &
  Readonly<{ pendingChangeRequest: HealthProfileChangeRequest | null }>;
export type ValidationIssue = Readonly<{ path: readonly (string | number)[]; code: string }>;

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const isoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const storedHealthFields = [
  "healthProfileId",
  "academyId",
  "studentId",
  "minimumOperationalSupport",
  "conditionSummary",
  "staffReferenceLabel",
  "reviewState",
  "expiresAt",
  "status",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const;
const storedRequestFields = [
  "requestId",
  "academyId",
  "healthProfileId",
  "studentId",
  "requestedBy",
  "proposedMinimumOperationalSupport",
  "proposedConditionSummary",
  "proposedExpiresAt",
  "status",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "schemaVersion",
  "reviewedAt",
  "reviewedBy",
] as const;

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
function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key))
  );
}
function validId(value: unknown): value is string {
  return typeof value === "string" && safeIdPattern.test(value);
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" && isoDateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}
function parseText(
  value: unknown,
  max: number,
  field: string,
): { value: string | null; issues: ValidationIssue[] } {
  if (value === null) return { value: null, issues: [] };
  if (typeof value !== "string" || value.trim().length > max || /[<>]/u.test(value))
    return { value: null, issues: [issue([field], "invalid_text")] };
  const result = value.trim();
  return { value: result.length === 0 ? null : result, issues: [] };
}
function parseExpiry(
  value: unknown,
  field: string,
): { value: string | null; issues: ValidationIssue[] } {
  if (value === null) return { value: null, issues: [] };
  if (!validDate(value)) return { value: null, issues: [issue([field], "invalid_timestamp")] };
  return { value, issues: [] };
}
function parseCodes(
  value: unknown,
  field: string,
): { value: readonly MinimumOperationalSupportCode[] | null; issues: ValidationIssue[] } {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 5 ||
    value.some((item) => typeof item !== "string")
  )
    return { value: null, issues: [issue([field], "invalid_codes")] };
  const codes = value as readonly string[];
  const issues: ValidationIssue[] = [];
  if (
    codes.some(
      (code) => !minimumOperationalSupportCodes.includes(code as MinimumOperationalSupportCode),
    )
  )
    issues.push(issue([field], "invalid_codes"));
  if (new Set(codes).size !== codes.length) issues.push(issue([field], "duplicate_codes"));
  if (codes.includes("none") && codes.length !== 1)
    issues.push(issue([field], "none_must_be_exclusive"));
  return issues.length
    ? { value: null, issues }
    : { value: Object.freeze([...codes] as MinimumOperationalSupportCode[]), issues: [] };
}
function parseIds(
  value: Record<string, unknown>,
  fields: readonly string[],
  issues: ValidationIssue[],
): void {
  for (const field of fields) if (!validId(value[field])) issues.push(issue([field], "invalid_id"));
}
function parseTimestamps(
  value: Record<string, unknown>,
  fields: readonly string[],
  issues: ValidationIssue[],
): void {
  for (const field of fields)
    if (!validDate(value[field])) issues.push(issue([field], "invalid_timestamp"));
}
function parseOptionalTimestamps(
  value: Record<string, unknown>,
  fields: readonly string[],
  issues: ValidationIssue[],
): void {
  for (const field of fields)
    if (value[field] !== null && !validDate(value[field]))
      issues.push(issue([field], "invalid_timestamp"));
}

export function parseHealthProfile(
  raw: unknown,
): Result<HealthProfile, readonly ValidationIssue[]> {
  if (!isPlainRecord(raw) || !exactFields(raw, storedHealthFields))
    return err(Object.freeze([issue(["input"], "unexpected_fields")]));
  const value = raw;
  const issues: ValidationIssue[] = [];
  parseIds(value, ["healthProfileId", "academyId", "studentId", "createdBy", "updatedBy"], issues);
  if (value.healthProfileId !== value.studentId)
    issues.push(issue(["healthProfileId"], "must_match_student"));
  const codes = parseCodes(value.minimumOperationalSupport, "minimumOperationalSupport");
  const condition = parseText(value.conditionSummary, 1000, "conditionSummary");
  const label = parseText(value.staffReferenceLabel, 25, "staffReferenceLabel");
  const expiry = parseExpiry(value.expiresAt, "expiresAt");
  issues.push(...codes.issues, ...condition.issues, ...label.issues, ...expiry.issues);
  if (!healthReviewStates.includes(value.reviewState as HealthReviewState))
    issues.push(issue(["reviewState"], "invalid_review_state"));
  if (!healthProfileStatuses.includes(value.status as HealthProfileStatus))
    issues.push(issue(["status"], "invalid_status"));
  if (value.schemaVersion !== "1")
    issues.push(issue(["schemaVersion"], "unsupported_schema_version"));
  parseTimestamps(value, ["createdAt", "updatedAt"], issues);
  if (
    issues.length ||
    !codes.value ||
    (condition.value === null && value.conditionSummary !== null) ||
    (label.value === null && value.staffReferenceLabel !== null) ||
    (expiry.value === null && value.expiresAt !== null)
  )
    return err(Object.freeze(issues.length ? issues : [issue(["profile"], "invalid")]));
  return ok(
    Object.freeze({
      ...value,
      minimumOperationalSupport: codes.value,
      conditionSummary: condition.value,
      staffReferenceLabel: label.value,
      expiresAt: expiry.value,
    } as HealthProfile),
  );
}

export function parseHealthProfileSaveInput(
  raw: unknown,
): Result<HealthProfileSaveInput, readonly ValidationIssue[]> {
  if (
    !isPlainRecord(raw) ||
    !exactFields(raw, [
      "studentId",
      "minimumOperationalSupport",
      "conditionSummary",
      "staffReferenceLabel",
      "expiresAt",
    ])
  )
    return err(Object.freeze([issue(["input"], "unexpected_fields")]));
  const issues: ValidationIssue[] = [];
  parseIds(raw, ["studentId"], issues);
  const codes = parseCodes(raw.minimumOperationalSupport, "minimumOperationalSupport");
  const condition = parseText(raw.conditionSummary, 1000, "conditionSummary");
  const label = parseText(raw.staffReferenceLabel, 25, "staffReferenceLabel");
  const expiry = parseExpiry(raw.expiresAt, "expiresAt");
  issues.push(...codes.issues, ...condition.issues, ...label.issues, ...expiry.issues);
  if (
    issues.length ||
    !codes.value ||
    (condition.value === null && raw.conditionSummary !== null) ||
    (label.value === null && raw.staffReferenceLabel !== null) ||
    (expiry.value === null && raw.expiresAt !== null)
  )
    return err(Object.freeze(issues.length ? issues : [issue(["input"], "invalid")]));
  return ok(
    Object.freeze({
      studentId: raw.studentId as string,
      minimumOperationalSupport: codes.value,
      conditionSummary: condition.value,
      staffReferenceLabel: label.value,
      expiresAt: expiry.value,
    }),
  );
}

export function parseHealthProfileChangeRequestInput(
  raw: unknown,
): Result<HealthProfileChangeRequestInput, readonly ValidationIssue[]> {
  if (
    !isPlainRecord(raw) ||
    !exactFields(raw, [
      "studentId",
      "proposedMinimumOperationalSupport",
      "proposedConditionSummary",
      "proposedExpiresAt",
    ])
  )
    return err(Object.freeze([issue(["input"], "unexpected_fields")]));
  const issues: ValidationIssue[] = [];
  parseIds(raw, ["studentId"], issues);
  const codes = parseCodes(
    raw.proposedMinimumOperationalSupport,
    "proposedMinimumOperationalSupport",
  );
  const condition = parseText(raw.proposedConditionSummary, 1000, "proposedConditionSummary");
  const expiry = parseExpiry(raw.proposedExpiresAt, "proposedExpiresAt");
  issues.push(...codes.issues, ...condition.issues, ...expiry.issues);
  if (
    issues.length ||
    !codes.value ||
    (condition.value === null && raw.proposedConditionSummary !== null) ||
    (expiry.value === null && raw.proposedExpiresAt !== null)
  )
    return err(Object.freeze(issues.length ? issues : [issue(["input"], "invalid")]));
  return ok(
    Object.freeze({
      studentId: raw.studentId as string,
      proposedMinimumOperationalSupport: codes.value,
      proposedConditionSummary: condition.value,
      proposedExpiresAt: expiry.value,
    }),
  );
}

export function parseHealthProfileChangeRequest(
  raw: unknown,
): Result<HealthProfileChangeRequest, readonly ValidationIssue[]> {
  if (!isPlainRecord(raw) || !exactFields(raw, storedRequestFields))
    return err(Object.freeze([issue(["input"], "unexpected_fields")]));
  const value = raw;
  const issues: ValidationIssue[] = [];
  parseIds(
    value,
    [
      "requestId",
      "academyId",
      "healthProfileId",
      "studentId",
      "requestedBy",
      "createdBy",
      "updatedBy",
    ],
    issues,
  );
  if (value.healthProfileId !== value.studentId)
    issues.push(issue(["healthProfileId"], "must_match_student"));
  const codes = parseCodes(
    value.proposedMinimumOperationalSupport,
    "proposedMinimumOperationalSupport",
  );
  const condition = parseText(value.proposedConditionSummary, 1000, "proposedConditionSummary");
  const expiry = parseExpiry(value.proposedExpiresAt, "proposedExpiresAt");
  issues.push(...codes.issues, ...condition.issues, ...expiry.issues);
  if (!healthChangeRequestStatuses.includes(value.status as HealthChangeRequestStatus))
    issues.push(issue(["status"], "invalid_status"));
  if (value.schemaVersion !== "1")
    issues.push(issue(["schemaVersion"], "unsupported_schema_version"));
  parseTimestamps(value, ["createdAt", "updatedAt"], issues);
  parseOptionalTimestamps(value, ["reviewedAt"], issues);
  if (value.reviewedBy !== null && !validId(value.reviewedBy))
    issues.push(issue(["reviewedBy"], "invalid_id"));
  if (
    issues.length ||
    !codes.value ||
    (condition.value === null && value.proposedConditionSummary !== null) ||
    (expiry.value === null && value.proposedExpiresAt !== null)
  )
    return err(Object.freeze(issues.length ? issues : [issue(["request"], "invalid")]));
  return ok(
    Object.freeze({
      ...value,
      proposedMinimumOperationalSupport: codes.value,
      proposedConditionSummary: condition.value,
      proposedExpiresAt: expiry.value,
    } as HealthProfileChangeRequest),
  );
}

export function toHealthProfileProjection(
  profile: HealthProfile,
  scope: "admin" | "staff" | "guardian",
): HealthProfileAdminProjection | HealthProfileStaffProjection | HealthProfileRedactedProjection {
  if (scope === "admin") return Object.freeze({ ...profile, pendingChangeRequest: null });
  if (scope === "staff")
    return Object.freeze({
      healthProfileId: profile.healthProfileId,
      studentId: profile.studentId,
      minimumOperationalSupport: profile.minimumOperationalSupport,
      conditionSummary: profile.conditionSummary,
      staffReferenceLabel: profile.staffReferenceLabel,
      reviewState: profile.reviewState,
      expiresAt: profile.expiresAt,
      status: profile.status,
      schemaVersion: profile.schemaVersion,
    });
  return Object.freeze({
    healthProfileId: profile.healthProfileId,
    studentId: profile.studentId,
    minimumOperationalSupport: profile.minimumOperationalSupport,
    conditionSummary: profile.conditionSummary,
    reviewState: profile.reviewState,
    expiresAt: profile.expiresAt,
    status: profile.status,
    schemaVersion: profile.schemaVersion,
  });
}
