import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const offlineAttendanceKinds = Object.freeze(["check_in", "check_out"] as const);
export type OfflineAttendanceKind = (typeof offlineAttendanceKinds)[number];

export type OfflineAttendanceEvent = Readonly<{
  eventId: string;
  academyId: string;
  sessionId: string;
  studentId: string;
  kind: OfflineAttendanceKind;
  occurredAt: string;
  capturedAt: string;
  deviceId: string;
}>;

export type OfflineAttendanceConflict = Readonly<{
  eventId: string;
  reason: "event_id_payload_mismatch" | "same_session_kind_conflict";
  relatedEventIds: readonly string[];
}>;

export type OfflineReconciliationInput = Readonly<{
  localEvents: readonly OfflineAttendanceEvent[];
  canonicalEvents: readonly OfflineAttendanceEvent[];
}>;

export type OfflineReconciliation = Readonly<{
  readyToSync: readonly OfflineAttendanceEvent[];
  alreadySyncedEventIds: readonly string[];
  conflicts: readonly OfflineAttendanceConflict[];
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

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function isKind(value: unknown): value is OfflineAttendanceKind {
  return offlineAttendanceKinds.includes(value as OfflineAttendanceKind);
}

function fingerprint(event: OfflineAttendanceEvent): string {
  return [
    event.academyId,
    event.sessionId,
    event.studentId,
    event.kind,
    event.occurredAt,
    event.capturedAt,
    event.deviceId,
  ].join("|");
}

function sameSessionKind(left: OfflineAttendanceEvent, right: OfflineAttendanceEvent): boolean {
  return (
    left.academyId === right.academyId &&
    left.sessionId === right.sessionId &&
    left.studentId === right.studentId &&
    left.kind === right.kind
  );
}

export function parseOfflineAttendanceEvent(
  value: unknown,
): Result<OfflineAttendanceEvent, readonly ValidationIssue[]> {
  if (!isRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
  const valid =
    Object.keys(value).every((key) =>
      [
        "eventId",
        "academyId",
        "sessionId",
        "studentId",
        "kind",
        "occurredAt",
        "capturedAt",
        "deviceId",
      ].includes(key),
    ) &&
    isIdentifier(value.eventId) &&
    isIdentifier(value.academyId) &&
    isIdentifier(value.sessionId) &&
    isIdentifier(value.studentId) &&
    isKind(value.kind) &&
    isDateTime(value.occurredAt) &&
    isDateTime(value.capturedAt) &&
    Date.parse(value.capturedAt) >= Date.parse(value.occurredAt) &&
    isIdentifier(value.deviceId);
  if (!valid) return err(Object.freeze([issue([], "invalid_offline_event")]));
  return ok(
    Object.freeze({
      eventId: value.eventId as string,
      academyId: value.academyId as string,
      sessionId: value.sessionId as string,
      studentId: value.studentId as string,
      kind: value.kind as OfflineAttendanceKind,
      occurredAt: value.occurredAt as string,
      capturedAt: value.capturedAt as string,
      deviceId: value.deviceId as string,
    }),
  );
}

export function reconcileOfflineAttendance(
  input: OfflineReconciliationInput,
): Result<OfflineReconciliation, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(input.localEvents)) issues.push(issue(["localEvents"], "invalid_type"));
  if (!Array.isArray(input.canonicalEvents))
    issues.push(issue(["canonicalEvents"], "invalid_type"));
  if (issues.length > 0) return err(Object.freeze(issues));

  const local: OfflineAttendanceEvent[] = [];
  const canonical: OfflineAttendanceEvent[] = [];
  for (const [index, value] of input.localEvents.entries()) {
    const parsed = parseOfflineAttendanceEvent(value);
    if (!parsed.ok) issues.push(issue(["localEvents", index], "invalid_offline_event"));
    else local.push(parsed.value);
  }
  for (const [index, value] of input.canonicalEvents.entries()) {
    const parsed = parseOfflineAttendanceEvent(value);
    if (!parsed.ok) issues.push(issue(["canonicalEvents", index], "invalid_canonical_event"));
    else canonical.push(parsed.value);
  }
  if (issues.length > 0) return err(Object.freeze(issues));

  const conflicts: OfflineAttendanceConflict[] = [];
  const readyToSync: OfflineAttendanceEvent[] = [];
  const alreadySyncedEventIds: string[] = [];
  const localById = new Map<string, OfflineAttendanceEvent>();
  const canonicalById = new Map<string, OfflineAttendanceEvent>();

  for (const event of canonical) {
    const previous = canonicalById.get(event.eventId);
    if (previous && fingerprint(previous) !== fingerprint(event)) {
      conflicts.push(
        Object.freeze({
          eventId: event.eventId,
          reason: "event_id_payload_mismatch" as const,
          relatedEventIds: Object.freeze([previous.eventId, event.eventId]),
        }),
      );
    } else {
      canonicalById.set(event.eventId, event);
    }
  }

  for (const event of local) {
    const previous = localById.get(event.eventId);
    if (previous) {
      if (fingerprint(previous) !== fingerprint(event)) {
        conflicts.push(
          Object.freeze({
            eventId: event.eventId,
            reason: "event_id_payload_mismatch" as const,
            relatedEventIds: Object.freeze([previous.eventId, event.eventId]),
          }),
        );
      }
      continue;
    }
    localById.set(event.eventId, event);
    const canonicalMatch = canonicalById.get(event.eventId);
    if (canonicalMatch) {
      if (fingerprint(canonicalMatch) === fingerprint(event))
        alreadySyncedEventIds.push(event.eventId);
      else {
        conflicts.push(
          Object.freeze({
            eventId: event.eventId,
            reason: "event_id_payload_mismatch" as const,
            relatedEventIds: Object.freeze([event.eventId]),
          }),
        );
      }
      continue;
    }
    const conflictingCanonical = canonical.find(
      (candidate) => sameSessionKind(candidate, event) && candidate.eventId !== event.eventId,
    );
    if (conflictingCanonical) {
      conflicts.push(
        Object.freeze({
          eventId: event.eventId,
          reason: "same_session_kind_conflict" as const,
          relatedEventIds: Object.freeze([conflictingCanonical.eventId, event.eventId]),
        }),
      );
      continue;
    }
    readyToSync.push(event);
  }

  return ok(
    Object.freeze({
      readyToSync: Object.freeze(readyToSync),
      alreadySyncedEventIds: Object.freeze(alreadySyncedEventIds),
      conflicts: Object.freeze(conflicts),
    }),
  );
}
