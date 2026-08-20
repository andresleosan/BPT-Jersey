import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";
import { planIds, type PlanId } from "./plan-contracts";

export const membershipStatuses = Object.freeze([
  "trial",
  "active",
  "paused",
  "overdue",
  "cancelled",
] as const);
export type MembershipStatus = (typeof membershipStatuses)[number];

export const currentMembershipStatuses = Object.freeze([
  "trial",
  "active",
  "paused",
  "overdue",
] as const);
export type CurrentMembershipStatus = (typeof currentMembershipStatuses)[number];

const membershipDraftStatuses = Object.freeze(["trial", "active"] as const);

type MembershipTransitionTargets = Readonly<{
  [Status in MembershipStatus]: readonly MembershipStatus[];
}>;

export const membershipTransitionTargets: MembershipTransitionTargets = Object.freeze({
  trial: Object.freeze(["active", "cancelled"] as const),
  active: Object.freeze(["paused", "overdue", "cancelled"] as const),
  paused: Object.freeze(["active", "cancelled"] as const),
  overdue: Object.freeze(["active", "cancelled"] as const),
  cancelled: Object.freeze([] as const),
});

export type MembershipDraft = Readonly<{
  familyId: string;
  studentId: string;
  planId: PlanId;
  status: CurrentMembershipStatus;
  startsAt: string;
  endsAt: string | null;
  nextBillingAt: string | null;
}>;

export type MembershipRecord = Omit<MembershipDraft, "status"> &
  Readonly<{
    membershipId: string;
    academyId: string;
    schemaVersion: "1";
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
    status: MembershipStatus;
  }>;

export type MembershipCreateInput = MembershipDraft;

export type MembershipTransitionInput = Readonly<{
  membershipId: string;
  targetStatus: MembershipStatus;
}>;

const membershipDraftFields = Object.freeze([
  "familyId",
  "studentId",
  "planId",
  "status",
  "startsAt",
  "endsAt",
  "nextBillingAt",
] as const);
const membershipRecordFields = Object.freeze([
  ...membershipDraftFields,
  "membershipId",
  "academyId",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return Object.freeze({ path: Object.freeze([...path]), code });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function readDataFields(
  value: Record<string, unknown>,
  required: readonly string[],
  issues: ValidationIssue[],
): Record<string, unknown> {
  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !required.includes(key) ||
      descriptor?.enumerable !== true ||
      descriptor?.get !== undefined ||
      descriptor?.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      issues.push(issue(typeof key === "string" ? [key] : [], "unexpected_property"));
    } else {
      descriptors.set(key, descriptor);
    }
  }
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of required) {
    const descriptor = descriptors.get(key);
    if (descriptor === undefined) {
      issues.push(issue([key], "missing_property"));
    } else {
      snapshot[key] = descriptor.value;
    }
  }
  return snapshot;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isValidDateTime(value: unknown): value is string {
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

function isValidNullableDateTime(value: unknown): value is string | null {
  return value === null || isValidDateTime(value);
}

function isNonEmptyText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
  );
}

function parseResult<T>(
  value: T | undefined,
  issues: readonly ValidationIssue[],
): Result<T, readonly ValidationIssue[]> {
  return issues.length === 0 && value !== undefined
    ? ok(Object.freeze(value))
    : err(Object.freeze([...issues]));
}

type ParsedMembershipFields = Omit<MembershipDraft, "status"> & {
  status: MembershipStatus;
};

function parseMembershipFields(
  value: Record<string, unknown>,
  issues: ValidationIssue[],
  allowAllStatuses: true,
): ParsedMembershipFields | undefined;
function parseMembershipFields(
  value: Record<string, unknown>,
  issues: ValidationIssue[],
  allowAllStatuses: false,
): MembershipDraft | undefined;
function parseMembershipFields(
  value: Record<string, unknown>,
  issues: ValidationIssue[],
  allowAllStatuses: boolean,
): ParsedMembershipFields | undefined {
  if (!isIdentifier(value.familyId)) issues.push(issue(["familyId"], "invalid_identifier"));
  if (!isIdentifier(value.studentId)) issues.push(issue(["studentId"], "invalid_identifier"));
  if (!planIds.includes(value.planId as PlanId)) issues.push(issue(["planId"], "unknown_enum"));

  const statuses = allowAllStatuses ? membershipStatuses : membershipDraftStatuses;
  if (!statuses.includes(value.status as never)) issues.push(issue(["status"], "unknown_enum"));
  if (!isValidDateTime(value.startsAt)) issues.push(issue(["startsAt"], "invalid_iso_datetime"));
  if (!isValidNullableDateTime(value.endsAt)) {
    issues.push(issue(["endsAt"], "invalid_iso_datetime"));
  }
  if (!isValidNullableDateTime(value.nextBillingAt)) {
    issues.push(issue(["nextBillingAt"], "invalid_iso_datetime"));
  }

  if (
    !isIdentifier(value.familyId) ||
    !isIdentifier(value.studentId) ||
    !planIds.includes(value.planId as PlanId) ||
    !statuses.includes(value.status as never) ||
    !isValidDateTime(value.startsAt) ||
    !isValidNullableDateTime(value.endsAt) ||
    !isValidNullableDateTime(value.nextBillingAt)
  ) {
    return undefined;
  }

  return {
    familyId: value.familyId,
    studentId: value.studentId,
    planId: value.planId as PlanId,
    status: value.status as MembershipStatus,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    nextBillingAt: value.nextBillingAt,
  };
}

export function parseMembershipDraft(
  value: unknown,
): Result<MembershipDraft, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  try {
    if (!isPlainRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
    const snapshot = readDataFields(value, membershipDraftFields, issues);
    return parseResult(parseMembershipFields(snapshot, issues, false), issues);
  } catch {
    return err(Object.freeze([...issues, issue([], "invalid_input")]));
  }
}

export function parseMembershipRecord(
  value: unknown,
): Result<MembershipRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  try {
    if (!isPlainRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
    const snapshot = readDataFields(value, membershipRecordFields, issues);
    const fields = parseMembershipFields(snapshot, issues, true);
    for (const field of ["membershipId", "academyId", "createdBy", "updatedBy"] as const) {
      if (!isNonEmptyText(snapshot[field]) || !isIdentifier(snapshot[field])) {
        issues.push(issue([field], "invalid_identifier"));
      }
    }
    if (snapshot.schemaVersion !== "1") issues.push(issue(["schemaVersion"], "unknown_version"));
    for (const field of ["createdAt", "updatedAt"] as const) {
      if (!isValidDateTime(snapshot[field])) issues.push(issue([field], "invalid_iso_datetime"));
    }
    if (
      fields === undefined ||
      !isNonEmptyText(snapshot.membershipId) ||
      !isIdentifier(snapshot.membershipId) ||
      !isNonEmptyText(snapshot.academyId) ||
      !isIdentifier(snapshot.academyId) ||
      !isNonEmptyText(snapshot.createdBy) ||
      !isIdentifier(snapshot.createdBy) ||
      !isNonEmptyText(snapshot.updatedBy) ||
      !isIdentifier(snapshot.updatedBy) ||
      snapshot.schemaVersion !== "1" ||
      !isValidDateTime(snapshot.createdAt) ||
      !isValidDateTime(snapshot.updatedAt)
    ) {
      return err(Object.freeze([...issues]));
    }
    return parseResult(
      {
        ...fields,
        membershipId: snapshot.membershipId,
        academyId: snapshot.academyId,
        schemaVersion: "1",
        createdAt: snapshot.createdAt,
        createdBy: snapshot.createdBy,
        updatedAt: snapshot.updatedAt,
        updatedBy: snapshot.updatedBy,
      },
      issues,
    );
  } catch {
    return err(Object.freeze([...issues, issue([], "invalid_input")]));
  }
}

export function canTransitionMembership(
  current: MembershipStatus,
  target: MembershipStatus,
): boolean {
  if (!membershipStatuses.includes(current) || !membershipStatuses.includes(target)) return false;
  if (current === target) return true;
  return membershipTransitionTargets[current].includes(target);
}
