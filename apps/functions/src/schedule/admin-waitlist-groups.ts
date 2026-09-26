import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import type { WaitlistEntryRecord } from "@bpt-jersey/domain/schedule/advanced-booking";
import { requireUserActor } from "../auth/user-authorization.js";
import type { StaffWaitlistItem } from "./advanced-booking-callables.js";
import { parseStoredWaitlist } from "./advanced-booking-service.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";

/** Same staff roles that may read a single session queue (`listSessionWaitlist`). */
const staffRoles = new Set(["owner", "administrator", "headCoach", "coach"]);
const horizonMs = 45 * 24 * 60 * 60 * 1000;
const sessionLimit = 500;
const entryLimit = 500;
/** Firestore allows 30 disjunctions: session ids times the two live statuses. */
const sessionChunk = 15;
const liveStatuses = ["waiting", "offered"];

export type WaitlistGroupSession = Readonly<{
  sessionId: string;
  classId: string | null;
  title: string;
  locationId: string;
  startAt: string;
  status: string;
}>;

export type WaitlistGroup = Readonly<{
  groupId: string;
  title: string;
  location: string;
  count: number;
  sessions: readonly Readonly<{
    sessionId: string;
    startAt: string;
    entries: readonly StaffWaitlistItem[];
  }>[];
}>;

/** Each read is capped; `truncated` says a cap was hit so the page can say the list is partial. */
export type WaitlistGroupsReader = Readonly<{
  listUpcomingSessions: (
    academyId: string,
    from: string,
    to: string,
  ) => Promise<Readonly<{ sessions: readonly WaitlistGroupSession[]; truncated: boolean }>>;
  listLiveEntries: (
    academyId: string,
    sessionIds: readonly string[],
  ) => Promise<Readonly<{ entries: readonly WaitlistEntryRecord[]; truncated: boolean }>>;
}>;

function staffItem(entry: WaitlistEntryRecord): StaffWaitlistItem {
  return Object.freeze({
    sessionId: entry.sessionId,
    position: entry.position,
    status: entry.status,
    requestedAt: entry.requestedAt,
    offeredAt: entry.offeredAt,
    offerExpiresAt: entry.offerExpiresAt,
    acceptedAt: entry.acceptedAt,
    cancelledAt: entry.cancelledAt,
    studentReference: entry.studentId,
  });
}

function isActive(entry: WaitlistEntryRecord, nowMs: number): boolean {
  if (entry.status === "waiting") return true;
  return (
    entry.status === "offered" &&
    (entry.offerExpiresAt === null || Date.parse(entry.offerExpiresAt) > nowMs)
  );
}

/**
 * Groups the live queue (waiting + unexpired offers) of future sessions in the next 45 days by
 * recurring class. A one-off session without a class forms its own `session:<id>` group.
 */
export function groupWaitlistEntries(
  entries: readonly WaitlistEntryRecord[],
  sessions: readonly WaitlistGroupSession[],
  now: string,
): readonly WaitlistGroup[] {
  const nowMs = Date.parse(now);
  const sessionsById = new Map(
    sessions
      .filter((item) => {
        const startMs = Date.parse(item.startAt);
        return item.status === "scheduled" && startMs > nowMs && startMs <= nowMs + horizonMs;
      })
      .map((item) => [item.sessionId, item] as const),
  );
  const bySession = new Map<string, WaitlistEntryRecord[]>();
  for (const entry of entries) {
    if (!sessionsById.has(entry.sessionId) || !isActive(entry, nowMs)) continue;
    const list = bySession.get(entry.sessionId) ?? [];
    list.push(entry);
    bySession.set(entry.sessionId, list);
  }

  const groups = new Map<string, WaitlistGroupSession[]>();
  for (const sessionId of bySession.keys()) {
    const item = sessionsById.get(sessionId);
    if (item === undefined) continue;
    const groupId = item.classId ?? "session:" + item.sessionId;
    groups.set(groupId, [...(groups.get(groupId) ?? []), item]);
  }

  return Object.freeze(
    [...groups.entries()]
      .map(([groupId, members]) => {
        const ordered = [...members].sort((left, right) =>
          left.startAt.localeCompare(right.startAt),
        );
        const first = ordered[0] as WaitlistGroupSession;
        const groupSessions = ordered.map((item) => {
          const queue = [...(bySession.get(item.sessionId) ?? [])].sort(
            (left, right) =>
              left.position - right.position || left.requestedAt.localeCompare(right.requestedAt),
          );
          return Object.freeze({
            sessionId: item.sessionId,
            startAt: item.startAt,
            entries: Object.freeze(queue.map(staffItem)),
          });
        });
        return Object.freeze({
          groupId,
          title: first.title,
          location: first.locationId,
          count: groupSessions.reduce(
            (total, item) =>
              total + item.entries.filter((entry) => entry.status === "waiting").length,
            0,
          ),
          sessions: Object.freeze(groupSessions),
        });
      })
      .sort(
        (left, right) =>
          (left.sessions[0]?.startAt ?? "").localeCompare(right.sessions[0]?.startAt ?? "") ||
          left.title.localeCompare(right.title),
      ),
  );
}

function isEmptyPayload(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === 0
  );
}

export function createListAdminWaitlistGroupsHandler({
  reader,
  now = () => new Date().toISOString(),
}: {
  reader: WaitlistGroupsReader;
  now?: () => string;
}) {
  return async (
    request: CallableRequest<unknown>,
  ): Promise<{ groups: readonly WaitlistGroup[]; truncated: boolean }> => {
    const actor = requireUserActor(request);
    if (!staffRoles.has(actor.role)) {
      throw new HttpsError("permission-denied", "Staff waitlist access is not permitted");
    }
    if (!isEmptyPayload(request.data)) {
      throw new HttpsError("invalid-argument", "Waitlist groups query is invalid");
    }
    try {
      const at = now();
      const to = new Date(Date.parse(at) + horizonMs).toISOString();
      const upcoming = await reader.listUpcomingSessions(actor.academyId, at, to);
      const sessionIds = [...new Set(upcoming.sessions.map((item) => item.sessionId))];
      const live =
        sessionIds.length === 0
          ? { entries: [], truncated: false }
          : await reader.listLiveEntries(actor.academyId, sessionIds);
      return {
        groups: groupWaitlistEntries(live.entries, upcoming.sessions, at),
        truncated: upcoming.truncated || live.truncated,
      };
    } catch {
      throw new HttpsError("internal", "Waitlist is not available");
    }
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readSession(id: string, data: Record<string, unknown>): WaitlistGroupSession | null {
  const title = text(data.title);
  const locationId = text(data.locationId);
  const startAt = text(data.startAt);
  const status = text(data.status);
  if (!title || !locationId || !startAt || !status) return null;
  return { sessionId: id, classId: text(data.classId) ?? null, title, locationId, startAt, status };
}

export function createFirestoreWaitlistGroupsReader(firestore: Firestore): WaitlistGroupsReader {
  return {
    async listUpcomingSessions(academyId, from, to) {
      // Uses the existing (status, startAt) composite index on sessions.
      const snapshot = await firestore
        .collection("academies/" + academyId + "/sessions")
        .where("status", "==", "scheduled")
        .where("startAt", ">=", from)
        .where("startAt", "<=", to)
        .limit(sessionLimit + 1)
        .get();
      const sessions = snapshot.docs.slice(0, sessionLimit).flatMap((item) => {
        const session = readSession(item.id, item.data());
        return session ? [session] : [];
      });
      return { sessions, truncated: snapshot.docs.length > sessionLimit };
    },
    async listLiveEntries(academyId, sessionIds) {
      const chunks: string[][] = [];
      for (let index = 0; index < sessionIds.length; index += sessionChunk) {
        chunks.push(sessionIds.slice(index, index + sessionChunk));
      }
      const snapshots = await Promise.all(
        chunks.map((chunk) =>
          firestore
            .collection("academies/" + academyId + "/waitlistEntries")
            .where("sessionId", "in", chunk)
            .where("status", "in", liveStatuses)
            .limit(entryLimit + 1)
            .get(),
        ),
      );
      return {
        entries: snapshots.flatMap((snapshot) =>
          snapshot.docs
            .slice(0, entryLimit)
            .map((item) => parseStoredWaitlist(item.data(), academyId, item.id)),
        ),
        truncated: snapshots.some((snapshot) => snapshot.docs.length > entryLimit),
      };
    },
  };
}

export const listAdminWaitlistGroups = onCall(scheduleCallableOptions, async (request) =>
  createListAdminWaitlistGroupsHandler({
    reader: createFirestoreWaitlistGroupsReader(getFirestore()),
  })(request),
);
