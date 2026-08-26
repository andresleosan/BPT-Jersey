import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const leadStatuses = Object.freeze([
  "new_enquiry",
  "trial_booked",
  "trial_attended",
  "follow_up",
  "won",
  "lost",
] as const);
export type LeadStatus = (typeof leadStatuses)[number];

export const leadSources = Object.freeze(["website-f", "walk_in-f", "referral-f"] as const);
export type LeadSource = (typeof leadSources)[number];

export const leadConsentStates = Object.freeze(["unknown", "granted", "withdrawn"] as const);
export type LeadConsentState = (typeof leadConsentStates)[number];

export const leadEventKinds = Object.freeze([
  "lead_created",
  "status_changed",
  "owner_assigned",
  "next_action_set",
  "trial_booked",
  "trial_attended",
  "consent_withdrawn",
  "note_added",
] as const);
export type LeadEventKind = (typeof leadEventKinds)[number];

type LeadTransitionTargets = Readonly<{
  [Status in LeadStatus]: readonly LeadStatus[];
}>;

export const leadTransitionTargets: LeadTransitionTargets = Object.freeze({
  new_enquiry: Object.freeze(["trial_booked", "lost"] as const),
  trial_booked: Object.freeze(["trial_attended", "lost"] as const),
  trial_attended: Object.freeze(["follow_up"] as const),
  follow_up: Object.freeze(["won", "lost"] as const),
  won: Object.freeze([] as const),
  lost: Object.freeze([] as const),
});

export type LeadDraft = Readonly<{
  academyId: string;
  contactReference: string;
  source: LeadSource;
  ownerId: string;
  status: LeadStatus;
  nextActionAt: string | null;
  consentState: LeadConsentState;
}>;

export type LeadRecord = LeadDraft &
  Readonly<{
    leadId: string;
    schemaVersion: "1";
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
  }>;

export type LeadTimelineEvent = Readonly<{
  eventId: string;
  academyId: string;
  leadId: string;
  eventKey: string;
  kind: LeadEventKind;
  actorId: string;
  occurredAt: string;
  summary: string;
}>;

const leadDraftFields = Object.freeze([
  "academyId",
  "contactReference",
  "source",
  "ownerId",
  "status",
  "nextActionAt",
  "consentState",
] as const);
const leadRecordFields = Object.freeze([
  ...leadDraftFields,
  "leadId",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);
const timelineEventFields = Object.freeze([
  "eventId",
  "academyId",
  "leadId",
  "eventKey",
  "kind",
  "actorId",
  "occurredAt",
  "summary",
] as const);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
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
    const descriptor =
      typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : undefined;
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
    if (descriptor === undefined) issues.push(issue([key], "missing_property"));
    else snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isText(value: unknown, maxLength = 128): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
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

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isDateTime(value);
}

function parseResult<T>(
  value: T | undefined,
  issues: readonly ValidationIssue[],
): Result<T, readonly ValidationIssue[]> {
  return issues.length === 0 && value !== undefined
    ? ok(Object.freeze(value))
    : err(Object.freeze([...issues]));
}

function parseLeadFields(
  value: Record<string, unknown>,
  issues: ValidationIssue[],
): LeadDraft | undefined {
  if (!isIdentifier(value.academyId)) issues.push(issue(["academyId"], "invalid_identifier"));
  if (!isIdentifier(value.contactReference))
    issues.push(issue(["contactReference"], "invalid_identifier"));
  if (!leadSources.includes(value.source as LeadSource))
    issues.push(issue(["source"], "unknown_enum"));
  if (!isIdentifier(value.ownerId)) issues.push(issue(["ownerId"], "invalid_identifier"));
  if (!leadStatuses.includes(value.status as LeadStatus))
    issues.push(issue(["status"], "unknown_enum"));
  if (!isNullableDateTime(value.nextActionAt))
    issues.push(issue(["nextActionAt"], "invalid_iso_datetime"));
  if (!leadConsentStates.includes(value.consentState as LeadConsentState)) {
    issues.push(issue(["consentState"], "unknown_enum"));
  }
  if (
    (value.status !== "won" && value.status !== "lost" && value.nextActionAt === null) ||
    (value.consentState === "withdrawn" && value.status === "won")
  ) {
    issues.push(issue(["nextActionAt"], "required_for_active_status"));
  }
  if (
    !isIdentifier(value.academyId) ||
    !isIdentifier(value.contactReference) ||
    !leadSources.includes(value.source as LeadSource) ||
    !isIdentifier(value.ownerId) ||
    !leadStatuses.includes(value.status as LeadStatus) ||
    !isNullableDateTime(value.nextActionAt) ||
    !leadConsentStates.includes(value.consentState as LeadConsentState) ||
    (value.status !== "won" && value.status !== "lost" && value.nextActionAt === null) ||
    (value.consentState === "withdrawn" && value.status === "won")
  ) {
    return undefined;
  }
  return {
    academyId: value.academyId,
    contactReference: value.contactReference,
    source: value.source as LeadSource,
    ownerId: value.ownerId,
    status: value.status as LeadStatus,
    nextActionAt: value.nextActionAt,
    consentState: value.consentState as LeadConsentState,
  };
}

export function parseLeadDraft(value: unknown): Result<LeadDraft, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  try {
    if (!isPlainRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
    return parseResult(
      parseLeadFields(readDataFields(value, leadDraftFields, issues), issues),
      issues,
    );
  } catch {
    return err(Object.freeze([...issues, issue([], "invalid_input")]));
  }
}

export function parseLeadRecord(value: unknown): Result<LeadRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  try {
    if (!isPlainRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
    const snapshot = readDataFields(value, leadRecordFields, issues);
    const draft = parseLeadFields(snapshot, issues);
    for (const field of ["leadId", "createdBy", "updatedBy"] as const) {
      if (!isIdentifier(snapshot[field])) issues.push(issue([field], "invalid_identifier"));
    }
    if (snapshot.schemaVersion !== "1") issues.push(issue(["schemaVersion"], "unknown_version"));
    for (const field of ["createdAt", "updatedAt"] as const) {
      if (!isDateTime(snapshot[field])) issues.push(issue([field], "invalid_iso_datetime"));
    }
    if (
      draft === undefined ||
      !isIdentifier(snapshot.leadId) ||
      snapshot.schemaVersion !== "1" ||
      !isDateTime(snapshot.createdAt) ||
      !isDateTime(snapshot.updatedAt) ||
      !isIdentifier(snapshot.createdBy) ||
      !isIdentifier(snapshot.updatedBy)
    ) {
      return err(Object.freeze([...issues]));
    }
    return parseResult(
      {
        ...draft,
        leadId: snapshot.leadId,
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

export function parseLeadTimelineEvent(
  value: unknown,
): Result<LeadTimelineEvent, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  try {
    if (!isPlainRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
    const snapshot = readDataFields(value, timelineEventFields, issues);
    const eventId = snapshot.eventId;
    const academyId = snapshot.academyId;
    const leadId = snapshot.leadId;
    const eventKey = snapshot.eventKey;
    const actorId = snapshot.actorId;
    const kind = snapshot.kind;
    const occurredAt = snapshot.occurredAt;
    const summary = snapshot.summary;
    for (const field of ["eventId", "academyId", "leadId", "eventKey", "actorId"] as const) {
      if (!isIdentifier(snapshot[field])) issues.push(issue([field], "invalid_identifier"));
    }
    if (!leadEventKinds.includes(snapshot.kind as LeadEventKind))
      issues.push(issue(["kind"], "unknown_enum"));
    if (!isDateTime(snapshot.occurredAt))
      issues.push(issue(["occurredAt"], "invalid_iso_datetime"));
    if (!isText(snapshot.summary, 160)) issues.push(issue(["summary"], "invalid_text"));
    if (
      !isIdentifier(eventId) ||
      !isIdentifier(academyId) ||
      !isIdentifier(leadId) ||
      !isIdentifier(eventKey) ||
      !isIdentifier(actorId) ||
      !leadEventKinds.includes(kind as LeadEventKind) ||
      !isDateTime(occurredAt) ||
      !isText(summary, 160)
    ) {
      return err(Object.freeze([...issues]));
    }
    return parseResult(
      {
        eventId,
        academyId,
        leadId,
        eventKey,
        kind: kind as LeadEventKind,
        actorId,
        occurredAt,
        summary,
      },
      issues,
    );
  } catch {
    return err(Object.freeze([...issues, issue([], "invalid_input")]));
  }
}

export function canTransitionLead(current: LeadStatus, target: LeadStatus): boolean {
  if (!leadStatuses.includes(current) || !leadStatuses.includes(target)) return false;
  if (current === target) return true;
  return leadTransitionTargets[current].includes(target);
}

export function appendLeadTimelineEvent(
  events: readonly LeadTimelineEvent[],
  event: LeadTimelineEvent,
): Result<readonly LeadTimelineEvent[], readonly ValidationIssue[]> {
  const existing = events.find(
    (candidate) =>
      candidate.academyId === event.academyId &&
      candidate.leadId === event.leadId &&
      candidate.eventKey === event.eventKey,
  );
  if (existing !== undefined) {
    const same = JSON.stringify(existing) === JSON.stringify(event);
    return same
      ? ok(Object.freeze([...events]))
      : err(Object.freeze([issue(["eventKey"], "conflicting_duplicate_event")]));
  }
  return ok(Object.freeze([...events, Object.freeze({ ...event })]));
}
