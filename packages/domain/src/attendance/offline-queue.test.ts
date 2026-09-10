import { describe, expect, it } from "vitest";

import { createOfflineAttendanceQueue, type OfflineAttendanceQueueStorage } from "./offline-queue";
import type { OfflineAttendanceEvent } from "./offline-contracts";

const event: OfflineAttendanceEvent = {
  eventId: "event-1",
  academyId: "academy-1",
  sessionId: "session-1",
  studentId: "student-1",
  kind: "check_in",
  occurredAt: "2026-08-31T12:00:00Z",
  capturedAt: "2026-08-31T12:01:00Z",
  deviceId: "device-1",
};

function storage(initial?: unknown): {
  adapter: OfflineAttendanceQueueStorage;
  writes: unknown[];
} {
  let value = initial;
  const writes: unknown[] = [];
  return {
    adapter: {
      read: () => value,
      write: (_key, next) => {
        value = next;
        writes.push(next);
      },
    },
    writes,
  };
}

describe("offline attendance queue", () => {
  it("persists a validated event in an academy and device scoped key", () => {
    const state = storage();
    const queue = createOfflineAttendanceQueue({
      academyId: "academy-1",
      deviceId: "device-1",
      storage: state.adapter,
    });

    expect(queue.load()).toEqual({ ok: true, value: [] });
    expect(queue.enqueue(event)).toEqual({ ok: true, value: { queued: true, size: 1 } });
    expect(state.writes).toHaveLength(1);
    expect(queue.storageKey).toBe("bpt-jersey.offline-attendance.v1/academy-1/device-1");
  });

  it("treats an exact retry as idempotent without another write", () => {
    const state = storage();
    const queue = createOfflineAttendanceQueue({
      academyId: "academy-1",
      deviceId: "device-1",
      storage: state.adapter,
    });

    queue.enqueue(event);
    expect(queue.enqueue(event)).toEqual({ ok: true, value: { queued: false, size: 1 } });
    expect(state.writes).toHaveLength(1);
  });

  it("fails closed for payload, scope, and same-session conflicts", () => {
    const state = storage();
    const queue = createOfflineAttendanceQueue({
      academyId: "academy-1",
      deviceId: "device-1",
      storage: state.adapter,
    });

    queue.enqueue(event);
    expect(queue.enqueue({ ...event, studentId: "student-2" })).toMatchObject({
      ok: false,
      error: { code: "event_id_payload_mismatch" },
    });
    expect(
      queue.enqueue({
        ...event,
        eventId: "event-2",
        occurredAt: "2026-08-31T12:02:00Z",
        capturedAt: "2026-08-31T12:03:00Z",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "same_session_kind_conflict" },
    });
    expect(queue.enqueue({ ...event, eventId: "event-3", academyId: "academy-2" })).toMatchObject({
      ok: false,
      error: { code: "scope_mismatch" },
    });
    expect(state.writes).toHaveLength(1);
  });

  it("rejects malformed persisted state instead of overwriting it", () => {
    const state = storage([{ ...event, studentId: "student/unsafe" }]);
    const queue = createOfflineAttendanceQueue({
      academyId: "academy-1",
      deviceId: "device-1",
      storage: state.adapter,
    });

    expect(queue.load()).toMatchObject({ ok: false, error: { code: "invalid_persisted_state" } });
    expect(queue.enqueue(event)).toMatchObject({
      ok: false,
      error: { code: "invalid_persisted_state" },
    });
    expect(state.writes).toHaveLength(0);
  });

  it("removes only explicitly acknowledged event ids and returns immutable state", () => {
    const state = storage();
    const queue = createOfflineAttendanceQueue({
      academyId: "academy-1",
      deviceId: "device-1",
      storage: state.adapter,
    });
    queue.enqueue(event);
    queue.enqueue({ ...event, eventId: "event-2", sessionId: "session-2" });

    const removed = queue.removeSynced(["event-1", "missing-event"]);
    expect(removed).toEqual({ ok: true, value: { removed: 1, size: 1 } });
    expect(removed.ok && Object.isFrozen(removed.value)).toBe(true);
    expect(queue.load()).toEqual({
      ok: true,
      value: [{ ...event, eventId: "event-2", sessionId: "session-2" }],
    });
  });
});
