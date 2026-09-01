import { describe, expect, it } from "vitest";

import type { OfflineAttendanceEvent } from "@bpt-jersey/domain";
import { createBrowserOfflineAttendanceQueue } from "./offline-attendance-storage";

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

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("browser offline attendance storage", () => {
  it("round-trips queue events through the injected local storage", () => {
    const browserStorage = fakeStorage();
    const first = createBrowserOfflineAttendanceQueue({
      academyId: "academy-1",
      deviceId: "device-1",
      storage: browserStorage,
    });
    expect(first.enqueue(event)).toEqual({ ok: true, value: { queued: true, size: 1 } });

    const second = createBrowserOfflineAttendanceQueue({
      academyId: "academy-1",
      deviceId: "device-1",
      storage: browserStorage,
    });
    expect(second.load()).toEqual({ ok: true, value: [event] });
  });

  it("fails closed when browser storage contains invalid JSON", () => {
    const browserStorage = fakeStorage();
    browserStorage.setItem("bpt-jersey.offline-attendance.v1/academy-1/device-1", "not-json");
    const queue = createBrowserOfflineAttendanceQueue({
      academyId: "academy-1",
      deviceId: "device-1",
      storage: browserStorage,
    });

    expect(queue.load()).toMatchObject({ ok: false, error: { code: "storage_unavailable" } });
  });
});
