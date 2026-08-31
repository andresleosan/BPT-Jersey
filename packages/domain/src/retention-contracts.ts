import type { ValidationIssue } from "./errors";
import { err, ok, type Result } from "./result";

export const retentionAlertKinds = Object.freeze([
  "attendance_gap",
  "repeated_no_show",
  "membership_expiring",
] as const);
export type RetentionAlertKind = (typeof retentionAlertKinds)[number];

export type RetentionPolicy = Readonly<{
  inactivityDays: number;
  lookbackDays: number;
  noShowThreshold: number;
  membershipExpiryDays: number;
}>;

export type RetentionAttendanceEntry = Readonly<{
  state: "attended" | "late" | "absent" | "no_show";
  occurredAt: string;
}>;

export type RetentionStudentSnapshot = Readonly<{
  academyId: string;
  studentId: string;
  active: boolean;
  hasActiveMembership: boolean;
  membershipStartsAt: string | null;
  membershipEndsAt: string | null;
  attendance: readonly RetentionAttendanceEntry[];
}>;

export type BuildRetentionAlertsInput = Readonly<{
  academyId: string;
  now: string;
  policy: RetentionPolicy;
  students: readonly RetentionStudentSnapshot[];
}>;

export type RetentionAlertEvidence = Readonly<{
  lastAttendedAt: string | null;
  noShowCount: number;
  membershipEndsAt: string | null;
}>;

export type RetentionAlert = Readonly<{
  alertId: string;
  academyId: string;
  studentId: string;
  kind: RetentionAlertKind;
  severity: "warning";
  status: "open";
  reasonCode: RetentionAlertKind;
  evidence: RetentionAlertEvidence;
  deduplicationKey: string;
  createdAt: string;
  schemaVersion: "1";
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const attendanceStates = new Set<RetentionAttendanceEntry["state"]>([
  "attended",
  "late",
  "absent",
  "no_show",
]);

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return Object.freeze({ path: Object.freeze([...path]), code });
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
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

function validPolicy(policy: RetentionPolicy): boolean {
  return (
    Number.isSafeInteger(policy.inactivityDays) &&
    policy.inactivityDays >= 1 &&
    policy.inactivityDays <= 365 &&
    Number.isSafeInteger(policy.lookbackDays) &&
    policy.lookbackDays >= 1 &&
    policy.lookbackDays <= 365 &&
    Number.isSafeInteger(policy.noShowThreshold) &&
    policy.noShowThreshold >= 1 &&
    policy.noShowThreshold <= 20 &&
    Number.isSafeInteger(policy.membershipExpiryDays) &&
    policy.membershipExpiryDays >= 1 &&
    policy.membershipExpiryDays <= 90 &&
    policy.inactivityDays <= policy.lookbackDays
  );
}

function validAttendanceEntry(value: RetentionAttendanceEntry): boolean {
  return attendanceStates.has(value.state) && isDateTime(value.occurredAt);
}

function validStudentSnapshot(value: RetentionStudentSnapshot, academyId: string): boolean {
  return (
    value.academyId === academyId &&
    isIdentifier(value.academyId) &&
    isIdentifier(value.studentId) &&
    typeof value.active === "boolean" &&
    typeof value.hasActiveMembership === "boolean" &&
    (value.membershipStartsAt === null || isDateTime(value.membershipStartsAt)) &&
    (!value.hasActiveMembership || value.membershipStartsAt !== null) &&
    (value.membershipEndsAt === null || isDateTime(value.membershipEndsAt)) &&
    Array.isArray(value.attendance) &&
    value.attendance.every(validAttendanceEntry)
  );
}

function parseInput(
  input: BuildRetentionAlertsInput,
): Result<BuildRetentionAlertsInput, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!isIdentifier(input.academyId)) issues.push(issue(["academyId"], "invalid_identifier"));
  if (!isDateTime(input.now)) issues.push(issue(["now"], "invalid_iso_datetime"));
  if (!validPolicy(input.policy)) issues.push(issue(["policy"], "invalid_policy"));
  if (!Array.isArray(input.students)) issues.push(issue(["students"], "invalid_type"));

  if (Array.isArray(input.students)) {
    const seen = new Set<string>();
    input.students.forEach((student, index) => {
      if (!validStudentSnapshot(student, input.academyId)) {
        issues.push(issue(["students", index], "invalid_snapshot"));
      }
      if (seen.has(student.studentId)) {
        issues.push(issue(["students", index, "studentId"], "duplicate_student"));
      }
      seen.add(student.studentId);
    });
  }

  return issues.length === 0 ? ok(input) : err(Object.freeze(issues));
}

function dateAtDaysBefore(nowMs: number, days: number): number {
  return nowMs - days * 24 * 60 * 60 * 1000;
}

function dateAtDaysAfter(nowMs: number, days: number): number {
  return nowMs + days * 24 * 60 * 60 * 1000;
}

function addAlert(
  alerts: RetentionAlert[],
  input: BuildRetentionAlertsInput,
  student: RetentionStudentSnapshot,
  kind: RetentionAlertKind,
  evidence: RetentionAlertEvidence,
): void {
  const effectiveAt = canonicalRetentionEffectiveAt(input.now);
  const dayKey = effectiveAt.slice(0, 10);
  const identity = buildRetentionAlertIdentity({
    academyId: input.academyId,
    studentId: student.studentId,
    kind,
    runDate: dayKey,
  });
  alerts.push(
    Object.freeze({
      alertId: identity.alertId,
      academyId: input.academyId,
      studentId: student.studentId,
      kind,
      severity: "warning",
      status: "open",
      reasonCode: kind,
      evidence: Object.freeze(evidence),
      deduplicationKey: identity.deduplicationKey,
      createdAt: effectiveAt,
      schemaVersion: "1",
    }),
  );
}

export function canonicalRetentionEffectiveAt(now: string): string {
  return new Date(Date.parse(now)).toISOString().slice(0, 10) + "T00:00:00.000Z";
}

export function buildRetentionAlertIdentity(input: {
  academyId: string;
  studentId: string;
  kind: RetentionAlertKind;
  runDate: string;
}): Readonly<{ alertId: string; deduplicationKey: string }> {
  const academySegment = input.academyId.length + "_" + input.academyId;
  const kindSegment = input.kind.length + "_" + input.kind;
  const studentSegment = input.studentId.length + "_" + input.studentId;
  return Object.freeze({
    alertId:
      "retention-v2__" +
      academySegment +
      "__" +
      kindSegment +
      "__" +
      studentSegment +
      "__" +
      input.runDate,
    deduplicationKey:
      "v2:" +
      input.kind.length +
      ":" +
      input.kind +
      ":" +
      input.studentId.length +
      ":" +
      input.studentId +
      ":" +
      input.runDate,
  });
}

export function buildRetentionAlerts(
  input: BuildRetentionAlertsInput,
): Result<readonly RetentionAlert[], readonly ValidationIssue[]> {
  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  const nowMs = Date.parse(canonicalRetentionEffectiveAt(input.now));
  const lookbackCutoff = dateAtDaysBefore(nowMs, input.policy.lookbackDays);
  const inactivityCutoff = dateAtDaysBefore(nowMs, input.policy.inactivityDays);
  const expiryCutoff = dateAtDaysAfter(nowMs, input.policy.membershipExpiryDays);
  const alerts: RetentionAlert[] = [];

  for (const student of input.students) {
    if (!student.active || !student.hasActiveMembership) continue;

    const membershipStartsAtMs = Date.parse(student.membershipStartsAt as string);
    const validPastAttendance = student.attendance.filter((entry) => {
      const occurredAt = Date.parse(entry.occurredAt);
      return occurredAt >= membershipStartsAtMs && occurredAt <= nowMs;
    });
    const attended = validPastAttendance
      .filter((entry) => entry.state === "attended" || entry.state === "late")
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
    const lastAttendedAt = attended[0]?.occurredAt ?? null;
    const recentNoShowCount = validPastAttendance.filter(
      (entry) => entry.state === "no_show" && Date.parse(entry.occurredAt) >= lookbackCutoff,
    ).length;
    const baseEvidence = {
      lastAttendedAt,
      noShowCount: recentNoShowCount,
      membershipEndsAt: student.membershipEndsAt,
    };

    const activityBaselineAt =
      lastAttendedAt === null || membershipStartsAtMs > Date.parse(lastAttendedAt)
        ? (student.membershipStartsAt as string)
        : lastAttendedAt;

    if (Date.parse(activityBaselineAt) < inactivityCutoff) {
      addAlert(alerts, input, student, "attendance_gap", baseEvidence);
    }
    if (recentNoShowCount >= input.policy.noShowThreshold) {
      addAlert(alerts, input, student, "repeated_no_show", baseEvidence);
    }
    if (
      student.membershipEndsAt !== null &&
      Date.parse(student.membershipEndsAt) > nowMs &&
      Date.parse(student.membershipEndsAt) <= expiryCutoff
    ) {
      addAlert(alerts, input, student, "membership_expiring", baseEvidence);
    }
  }

  alerts.sort(
    (left, right) =>
      left.studentId.localeCompare(right.studentId) || left.kind.localeCompare(right.kind),
  );
  return ok(Object.freeze(alerts));
}
