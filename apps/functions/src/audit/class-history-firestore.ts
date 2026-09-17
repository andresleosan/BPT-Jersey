import { Timestamp, type Firestore, type Query } from "firebase-admin/firestore";

import type {
  ClassActorGroup,
  ClassActorRole,
  ClassAuditAction,
  ClassAuditEventClass,
  ClassAuditSource,
} from "@bpt-jersey/domain/audit";

import type {
  ClassHistoryQuery,
  ClassHistorySession,
  ClassHistoryStore,
  ClassHistoryStoredEvent,
} from "./class-history-service.js";

/**
 * `occurredAt` is written by the audit writer as a Firestore server timestamp, never as a string.
 * A row written before that field existed at all falls back to an empty string rather than
 * throwing, since a missing timestamp is still a row worth showing.
 */
function toIsoString(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return null;
}

function toClassBlock(value: unknown): ClassAuditEventClass | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || typeof record.sessionStartAt !== "string") {
    return null;
  }
  return Object.freeze({
    studentId: typeof record.studentId === "string" ? record.studentId : null,
    studentName: typeof record.studentName === "string" ? record.studentName : null,
    sessionId: record.sessionId,
    sessionStartAt: record.sessionStartAt,
    programId: typeof record.programId === "string" ? record.programId : null,
    locationId: typeof record.locationId === "string" ? record.locationId : null,
  });
}

/**
 * A row written before the class-shape fields existed at all carries none of them: the audit
 * writer's `legacyClassRow` replay allowance (see audit-writer.ts) documents the same gap. Those
 * fields still get a value the type can carry, rather than leaving the row half-built.
 */
function toStoredEvent(id: string, data: Record<string, unknown>): ClassHistoryStoredEvent {
  return Object.freeze({
    id,
    occurredAt: toIsoString(data.occurredAt) ?? "",
    action: data.action as ClassAuditAction,
    actorId: typeof data.actorId === "string" ? data.actorId : "",
    actorRole: (typeof data.actorRole === "string" ? data.actorRole : "system") as ClassActorRole,
    actorGroup: (typeof data.actorGroup === "string"
      ? data.actorGroup
      : "system") as ClassActorGroup,
    actorName: typeof data.actorName === "string" ? data.actorName : null,
    actorIp: typeof data.actorIp === "string" ? data.actorIp : null,
    source: (typeof data.source === "string" ? data.source : "bpt") as ClassAuditSource,
    class: toClassBlock(data.class),
  });
}

/**
 * Batch-reads one name field off a collection with `getAll`, which has no 30-reference limit
 * (unlike a `where(field, "in", ids)` query, which would need chunking past 30 values). A missing
 * document, or one without the field, is simply absent from the returned map.
 */
async function readNameMap(
  firestore: Firestore,
  collectionPath: string,
  ids: readonly string[],
  nameField: string,
): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const references = ids.map((id) => firestore.doc(`${collectionPath}/${id}`));
  const documents = await firestore.getAll(...references);
  const names = new Map<string, string>();
  for (const document of documents) {
    if (!document.exists) continue;
    const data = document.data() as Record<string, unknown> | undefined;
    const name = data?.[nameField];
    if (typeof name === "string" && name.length > 0) names.set(document.id, name);
  }
  return names;
}

/** The Firestore adapter behind {@link ClassHistoryStore}, scoped to one academy. */
export function createClassHistoryStore(
  firestore: Firestore,
  academyId: string,
): ClassHistoryStore {
  const eventsPath = `academies/${academyId}/auditEvents`;
  const studentsPath = `academies/${academyId}/students`;
  const sessionsPath = `academies/${academyId}/sessions`;
  const programsPath = `academies/${academyId}/programs`;
  const staffPath = `academies/${academyId}/staff`;

  return Object.freeze({
    async queryEvents(query: ClassHistoryQuery) {
      // Actions and groups come from a bounded domain enum (at most 8 and 3 values respectively,
      // see classAuditActions / classActorGroups) - always well under Firestore's 30-value `in`
      // limit, so a single query per filter is enough here.
      let ref: Query = firestore
        .collection(eventsPath)
        .where("action", "in", [...query.actions])
        .where("actorGroup", "in", [...query.groups])
        .where("occurredAt", ">=", Timestamp.fromDate(new Date(query.since)));
      if (query.actorId !== null) {
        ref = ref.where("actorId", "==", query.actorId);
      }
      ref = ref.orderBy("occurredAt", "desc").limit(query.limit);
      if (query.cursor !== null) {
        ref = ref.startAfter(Timestamp.fromDate(new Date(query.cursor)));
      }
      const snapshot = await ref.get();
      return Object.freeze(
        snapshot.docs.map((document) =>
          toStoredEvent(document.id, document.data() as Record<string, unknown>),
        ),
      );
    },

    readStudents: (ids) => readNameMap(firestore, studentsPath, ids, "fullName"),
    readStaffNames: (ids) => readNameMap(firestore, staffPath, ids, "fullName"),

    async readSessions(ids) {
      if (ids.length === 0) return new Map();
      const references = ids.map((id) => firestore.doc(`${sessionsPath}/${id}`));
      const documents = await firestore.getAll(...references);
      const startAtById = new Map<string, string | null>();
      const programIdById = new Map<string, string | null>();
      const programIds = new Set<string>();
      for (const document of documents) {
        if (!document.exists) continue;
        const data = document.data() as Record<string, unknown> | undefined;
        const startAt = typeof data?.startAt === "string" ? data.startAt : null;
        const programId = typeof data?.programId === "string" ? data.programId : null;
        startAtById.set(document.id, startAt);
        programIdById.set(document.id, programId);
        if (programId !== null) programIds.add(programId);
      }
      const programNames = await readNameMap(firestore, programsPath, [...programIds], "name");

      const sessions = new Map<string, ClassHistorySession>();
      for (const [sessionId, startAt] of startAtById) {
        const programId = programIdById.get(sessionId) ?? null;
        sessions.set(
          sessionId,
          Object.freeze({
            startAt,
            programId,
            programName: programId === null ? null : (programNames.get(programId) ?? null),
          }),
        );
      }
      return sessions;
    },
  } satisfies ClassHistoryStore);
}
