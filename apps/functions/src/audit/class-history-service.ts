import type {
  ClassActorGroup,
  ClassActorRole,
  ClassAuditAction,
  ClassAuditEventClass,
  ClassAuditSource,
} from "@bpt-jersey/domain/audit";
import {
  composeClassHistorySentence,
  registrationTypeFilter,
  type ClassHistoryRow,
  type ListClassHistoryInput,
} from "@bpt-jersey/domain/audit/class-history";
import { canReadRestrictedIp } from "@bpt-jersey/domain/auth/admin-contracts";
import type { UserRole } from "@bpt-jersey/domain";

/** Regyfit never shows fewer than 100 rows nor more than 1000; the log keeps the same range. */
export const classHistoryMinimumLimit = 100;
export const classHistoryMaximumLimit = 1000;

/** What the USER column says for a member actor whose uid resolves to no student record. */
export const memberActorLabel = "Member";

/**
 * One audit row as the store hands it over. The class block is null for the attendance events
 * written before the block existed: those rows still belong in the log.
 */
export type ClassHistoryStoredEvent = Readonly<{
  id: string;
  occurredAt: string;
  action: ClassAuditAction;
  actorId: string;
  actorRole: ClassActorRole;
  actorGroup: ClassActorGroup;
  actorName: string | null;
  actorIp: string | null;
  source: ClassAuditSource;
  class: ClassAuditEventClass | null;
}>;

export type ClassHistoryQuery = Readonly<{
  academyId: string;
  actions: readonly ClassAuditAction[];
  groups: readonly ClassActorGroup[];
  actorId: string | null;
  since: string;
  limit: number;
  cursor: string | null;
}>;

/** What one session tells the log: when it ran and which program it belongs to. */
export type ClassHistorySession = Readonly<{
  startAt: string | null;
  programId: string | null;
  programName: string | null;
}>;

/**
 * The reads the log needs, implemented against Firestore elsewhere. Every batch read takes the
 * distinct ids and answers with a Map; an id with no record is simply absent from the Map.
 */
export type ClassHistoryStore = Readonly<{
  queryEvents: (query: ClassHistoryQuery) => Promise<readonly ClassHistoryStoredEvent[]>;
  readStudents: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readSessions: (ids: readonly string[]) => Promise<ReadonlyMap<string, ClassHistorySession>>;
  readStaffNames: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /** Keyed by the Firebase Auth uid an audit event carries, valued with the student's own name. */
  readMemberNames: (uids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
}>;

export type ClassHistoryActor = Readonly<{
  uid: string;
  academyId: string;
  role: UserRole;
}>;

export type ClassHistoryPage = Readonly<{
  rows: readonly ClassHistoryRow[];
  total: number;
}>;

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return classHistoryMinimumLimit;
  const whole = Math.trunc(limit);
  if (whole < classHistoryMinimumLimit) return classHistoryMinimumLimit;
  if (whole > classHistoryMaximumLimit) return classHistoryMaximumLimit;
  return whole;
}

function distinct(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) seen.add(value);
  }
  return [...seen];
}

/**
 * The class registrations log. The limit is clamped, the Regyfit filter is translated into actions
 * and actor groups, names are resolved one batch per kind, and the caller's role decides whether
 * the recorded address is returned at all.
 */
export async function readClassHistory(
  store: ClassHistoryStore,
  input: ListClassHistoryInput,
  actor: ClassHistoryActor,
): Promise<ClassHistoryPage> {
  const filter = registrationTypeFilter(input.registrationType);
  const events = await store.queryEvents({
    academyId: input.academyId,
    actions: filter.actions,
    groups: filter.groups,
    actorId: input.actorId,
    since: input.since,
    limit: clampLimit(input.limit),
    cursor: input.cursor,
  });

  const studentIds = distinct(events.map((event) => event.class?.studentId));
  const sessionIds = distinct(events.map((event) => event.class?.sessionId));
  const staffIds = distinct(
    events.map((event) => (event.actorGroup === "staff" ? event.actorId : null)),
  );
  const memberIds = distinct(
    events.map((event) => (event.actorGroup === "member" ? event.actorId : null)),
  );

  const [students, sessions, staffNames, memberNames] = await Promise.all([
    store.readStudents(studentIds),
    store.readSessions(sessionIds),
    store.readStaffNames(staffIds),
    store.readMemberNames(memberIds),
  ]);

  const showIp = canReadRestrictedIp(actor.role);

  const rows = events.map((event): ClassHistoryRow => {
    const block = event.class;
    // An imported row may name no session at all, because the class predates the BPT schedule.
    // There is then nothing to resolve, and the row renders from the moment the event carries.
    const sessionId = block?.sessionId ?? null;
    const session = sessionId === null ? undefined : sessions.get(sessionId);
    const studentId = block === null ? null : block.studentId;
    const recordName = studentId === null ? undefined : students.get(studentId);
    const studentName = recordName ?? block?.studentName ?? null;
    // A staff actor with no matching profile (the uid never resolved to a staffKey) is shown as
    // "Office" rather than the empty/generic wording composeClassHistorySentence would otherwise
    // fall back to - and never as the actor's own auth uid.
    const staffName =
      event.actorGroup === "staff" ? (staffNames.get(event.actorId) ?? "Office") : undefined;
    // The writers store no name at all for a member actor, so the uid is resolved here against the
    // student who holds that account. A guardian booking for their child holds no student record
    // of their own: that row is labelled "Member" rather than showing the auth uid or borrowing the
    // child's name, which would put words in somebody else's mouth.
    const memberName =
      event.actorGroup === "member"
        ? (memberNames.get(event.actorId) ?? event.actorName ?? memberActorLabel)
        : undefined;
    const actorName = staffName ?? memberName ?? event.actorName;
    const sessionStartAt = session?.startAt ?? block?.sessionStartAt ?? null;
    const programId = block?.programId ?? session?.programId ?? null;
    const programName = session?.programName ?? null;

    return Object.freeze({
      id: event.id,
      occurredAt: event.occurredAt,
      action: event.action,
      actorId: event.actorId,
      actorRole: event.actorRole,
      actorGroup: event.actorGroup,
      actorName,
      actorIp: showIp ? event.actorIp : null,
      studentId,
      studentName,
      sessionId,
      sessionStartAt,
      programId,
      programName,
      locationId: block?.locationId ?? null,
      source: event.source,
      sentence: composeClassHistorySentence({
        action: event.action,
        actorGroup: event.actorGroup,
        studentName,
        actorName,
        programName,
        sessionStartAt,
      }),
    });
  });

  return Object.freeze({ rows: Object.freeze(rows), total: rows.length });
}
