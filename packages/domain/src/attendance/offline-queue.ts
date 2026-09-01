import { err, ok, type Result } from "../result";
import { parseOfflineAttendanceEvent, type OfflineAttendanceEvent } from "./offline-contracts";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const defaultMaxEvents = 500;

export type OfflineAttendanceQueueErrorCode =
  | "invalid_scope"
  | "invalid_event"
  | "scope_mismatch"
  | "event_id_payload_mismatch"
  | "same_session_kind_conflict"
  | "invalid_persisted_state"
  | "storage_unavailable"
  | "queue_full";

export type OfflineAttendanceQueueError = Readonly<{
  code: OfflineAttendanceQueueErrorCode;
}>;

export type OfflineAttendanceQueueStorage = Readonly<{
  read: (key: string) => unknown;
  write: (key: string, events: readonly OfflineAttendanceEvent[]) => void;
}>;

export type OfflineAttendanceQueue = Readonly<{
  storageKey: string;
  load: () => Result<readonly OfflineAttendanceEvent[], OfflineAttendanceQueueError>;
  enqueue: (
    event: OfflineAttendanceEvent,
  ) => Result<Readonly<{ queued: boolean; size: number }>, OfflineAttendanceQueueError>;
  removeSynced: (
    eventIds: readonly string[],
  ) => Result<Readonly<{ removed: number; size: number }>, OfflineAttendanceQueueError>;
}>;

function error(code: OfflineAttendanceQueueErrorCode): OfflineAttendanceQueueError {
  return Object.freeze({ code });
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

function freezeEvents(
  events: readonly OfflineAttendanceEvent[],
): readonly OfflineAttendanceEvent[] {
  return Object.freeze(events.map((event) => Object.freeze({ ...event })));
}

export function createOfflineAttendanceQueue(input: {
  academyId: string;
  deviceId: string;
  storage: OfflineAttendanceQueueStorage;
  maxEvents?: number;
}): OfflineAttendanceQueue {
  const maxEvents = input.maxEvents ?? defaultMaxEvents;
  const validScope =
    identifierPattern.test(input.academyId) && identifierPattern.test(input.deviceId);
  const storageKey = "bpt-jersey.offline-attendance.v1/" + input.academyId + "/" + input.deviceId;

  const read = (): Result<readonly OfflineAttendanceEvent[], OfflineAttendanceQueueError> => {
    if (!validScope || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 500) {
      return err(error("invalid_scope"));
    }
    let stored: unknown;
    try {
      stored = input.storage.read(storageKey);
    } catch {
      return err(error("storage_unavailable"));
    }
    if (stored === undefined) return ok(Object.freeze([]));
    if (!Array.isArray(stored) || stored.length > maxEvents) {
      return err(error("invalid_persisted_state"));
    }

    const events: OfflineAttendanceEvent[] = [];
    const byId = new Map<string, OfflineAttendanceEvent>();
    for (const value of stored) {
      const parsed = parseOfflineAttendanceEvent(value);
      if (
        !parsed.ok ||
        parsed.value.academyId !== input.academyId ||
        parsed.value.deviceId !== input.deviceId
      ) {
        return err(error("invalid_persisted_state"));
      }
      const previous = byId.get(parsed.value.eventId);
      if (previous && fingerprint(previous) !== fingerprint(parsed.value)) {
        return err(error("invalid_persisted_state"));
      }
      if (!previous) {
        byId.set(parsed.value.eventId, parsed.value);
        events.push(parsed.value);
      }
    }
    return ok(freezeEvents(events));
  };

  const write = (
    events: readonly OfflineAttendanceEvent[],
  ): Result<null, OfflineAttendanceQueueError> => {
    try {
      input.storage.write(storageKey, freezeEvents(events));
      return ok(null);
    } catch {
      return err(error("storage_unavailable"));
    }
  };

  return Object.freeze({
    storageKey,
    load: read,
    enqueue(event: OfflineAttendanceEvent) {
      const current = read();
      if (!current.ok) return current;
      const parsed = parseOfflineAttendanceEvent(event);
      if (!parsed.ok) return err(error("invalid_event"));
      if (parsed.value.academyId !== input.academyId || parsed.value.deviceId !== input.deviceId) {
        return err(error("scope_mismatch"));
      }
      const existing = current.value.find(
        (candidate) => candidate.eventId === parsed.value.eventId,
      );
      if (existing) {
        return fingerprint(existing) === fingerprint(parsed.value)
          ? ok(Object.freeze({ queued: false, size: current.value.length }))
          : err(error("event_id_payload_mismatch"));
      }
      if (current.value.some((candidate) => sameSessionKind(candidate, parsed.value))) {
        return err(error("same_session_kind_conflict"));
      }
      if (current.value.length >= maxEvents) return err(error("queue_full"));
      const next = [...current.value, parsed.value];
      const saved = write(next);
      return saved.ok ? ok(Object.freeze({ queued: true, size: next.length })) : saved;
    },
    removeSynced(eventIds: readonly string[]) {
      const current = read();
      if (!current.ok) return current;
      if (
        !Array.isArray(eventIds) ||
        eventIds.some((eventId) => !identifierPattern.test(eventId))
      ) {
        return err(error("invalid_event"));
      }
      const ids = new Set(eventIds);
      const next = current.value.filter((event) => !ids.has(event.eventId));
      const saved = write(next);
      return saved.ok
        ? ok(Object.freeze({ removed: current.value.length - next.length, size: next.length }))
        : saved;
    },
  });
}
