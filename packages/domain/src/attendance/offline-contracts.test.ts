import { describe, expect, it } from "vitest";

import {
  parseOfflineAttendanceEvent,
  reconcileOfflineAttendance,
  type OfflineAttendanceEvent,
} from "./offline-contracts";

const event: OfflineAttendanceEvent = {
  eventId: "event-1",
  academyId: "academy-1",
  sessionId: "session-1",
  studentId: "student-1",
  kind: "check_in",
  occurredAt: "2026-08-27T12:00:00Z",
  capturedAt: "2026-08-27T12:01:00Z",
  deviceId: "device-1",
};

describe("offline attendance contracts", () => {
  it("parses a valid event and prepares it for sync", () => {
    const parsed = parseOfflineAttendanceEvent(event);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = reconcileOfflineAttendance({ localEvents: [parsed.value], canonicalEvents: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readyToSync).toEqual([parsed.value]);
    expect(result.value.alreadySyncedEventIds).toEqual([]);
  });

  it("treats an exact canonical event as already synced", () => {
    const result = reconcileOfflineAttendance({ localEvents: [event], canonicalEvents: [event] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readyToSync).toEqual([]);
    expect(result.value.alreadySyncedEventIds).toEqual(["event-1"]);
  });

  it("fails closed for same event id with a different payload", () => {
    const result = reconcileOfflineAttendance({
      localEvents: [event],
      canonicalEvents: [{ ...event, deviceId: "device-2" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readyToSync).toEqual([]);
    expect(result.value.conflicts[0]?.reason).toBe("event_id_payload_mismatch");
  });

  it("does not silently choose between same-session conflicting events", () => {
    const result = reconcileOfflineAttendance({
      localEvents: [{ ...event, eventId: "event-2", occurredAt: "2026-08-27T12:02:00Z", capturedAt: "2026-08-27T12:03:00Z" }],
      canonicalEvents: [event],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readyToSync).toEqual([]);
    expect(result.value.conflicts[0]?.reason).toBe("same_session_kind_conflict");
  });

  it("deduplicates exact local retries and rejects invalid clock order", () => {
    const result = reconcileOfflineAttendance({
      localEvents: [event, event],
      canonicalEvents: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readyToSync).toHaveLength(1);
    expect(
      reconcileOfflineAttendance({
        localEvents: [{ ...event, capturedAt: "2026-08-27T11:59:00Z" }],
        canonicalEvents: [],
      }).ok,
    ).toBe(false);
  });

  it("returns immutable and deterministic reconciliation output", () => {
    const first = reconcileOfflineAttendance({ localEvents: [event], canonicalEvents: [] });
    const second = reconcileOfflineAttendance({ localEvents: [event], canonicalEvents: [] });
    expect(first).toEqual(second);
    expect(first.ok && Object.isFrozen(first.value)).toBe(true);
    expect(first.ok && Object.isFrozen(first.value.readyToSync)).toBe(true);
  });
});
