import { httpsCallable } from "firebase/functions";

import type {
  RetentionAlertEvidence,
  RetentionAlertKind,
} from "@bpt-jersey/domain";
import { getFirebaseFunctions } from "./firebase-client";

export type RetentionInboxAlert = Readonly<{
  studentReference: string;
  kind: RetentionAlertKind;
  severity: "warning";
  status: "open";
  evidence: RetentionAlertEvidence;
  createdAt: string;
}>;

const safeListError = "Unable to load retention alerts. Please try again.";
const kinds = new Set<RetentionAlertKind>([
  "attendance_gap",
  "repeated_no_show",
  "membership_expiring",
]);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const alertKeys = Object.freeze([
  "createdAt",
  "evidence",
  "kind",
  "severity",
  "status",
  "studentReference",
]);
const evidenceKeys = Object.freeze([
  "lastAttendedAt",
  "membershipEndsAt",
  "noShowCount",
]);

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
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

function parseEvidence(value: unknown): RetentionAlertEvidence {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, evidenceKeys)
  ) {
    throw new Error(safeListError);
  }
  const evidence = value as Record<string, unknown>;
  if (
    (evidence.lastAttendedAt !== null && !isDateTime(evidence.lastAttendedAt)) ||
    (evidence.membershipEndsAt !== null && !isDateTime(evidence.membershipEndsAt)) ||
    !Number.isSafeInteger(evidence.noShowCount) ||
    (evidence.noShowCount as number) < 0
  ) {
    throw new Error(safeListError);
  }
  return Object.freeze({
    lastAttendedAt: evidence.lastAttendedAt as string | null,
    noShowCount: evidence.noShowCount as number,
    membershipEndsAt: evidence.membershipEndsAt as string | null,
  });
}

function parseAlert(value: unknown): RetentionInboxAlert {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, alertKeys)
  ) {
    throw new Error(safeListError);
  }
  const alert = value as Record<string, unknown>;
  if (
    typeof alert.studentReference !== "string" ||
    !identifierPattern.test(alert.studentReference) ||
    typeof alert.kind !== "string" ||
    !kinds.has(alert.kind as RetentionAlertKind) ||
    alert.severity !== "warning" ||
    alert.status !== "open" ||
    !isDateTime(alert.createdAt)
  ) {
    throw new Error(safeListError);
  }
  return Object.freeze({
    studentReference: alert.studentReference,
    kind: alert.kind as RetentionAlertKind,
    severity: "warning",
    status: "open",
    evidence: parseEvidence(alert.evidence),
    createdAt: alert.createdAt,
  });
}

export async function listRetentionAlerts(): Promise<readonly RetentionInboxAlert[]> {
  const callable = httpsCallable<null, { alerts: unknown }>(
    getFirebaseFunctions(),
    "listRetentionAlerts",
  );
  try {
    const response = await callable(null);
    if (!Array.isArray(response.data.alerts)) throw new Error(safeListError);
    return Object.freeze(response.data.alerts.map(parseAlert));
  } catch {
    throw new Error(safeListError);
  }
}