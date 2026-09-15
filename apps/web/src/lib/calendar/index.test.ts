import { nextSelfCheckInSession } from "@bpt-jersey/domain/schedule/self-check-in";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCalendarRepository } from "./index";

const near = { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 };
const teen = { role: "teenStudent" as const, displayName: "Sam Demo" };
const adult = { role: "adultStudent" as const, displayName: "Alex Demo" };

async function candidateFor(
  repository: ReturnType<typeof createCalendarRepository>,
  studentId: string,
) {
  return nextSelfCheckInSession({
    ...(await repository.loadWeek(
      studentId,
      new Date(Date.now() - 3600000).toISOString(),
      new Date(Date.now() + 3 * 3600000).toISOString(),
    )),
    nowMs: Date.now(),
  });
}

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("browser fixture calendar repository", () => {
  it("persists only its own attendance and ready timing across a browser reload", async () => {
    vi.stubEnv("NEXT_PUBLIC_CALENDAR_SOURCE", "fixture");
    const first = createCalendarRepository(teen);
    const ready = await candidateFor(first, "sam");
    if (!ready || ready.kind !== "ready")
      throw new Error("fixture did not provide a ready session");

    const record = await first.clockIn({
      sessionId: ready.session.sessionId,
      studentId: "sam",
      position: near,
    });
    const stored = Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index);
      return { key, value: JSON.parse(window.localStorage.getItem(key ?? "") ?? "null") };
    }).filter(({ value }) => value && typeof value === "object");
    expect(stored).not.toEqual([]);
    expect(stored.every(({ key }) => key?.includes(":sam:"))).toBe(true);
    expect(stored.every(({ value }) => !("position" in value))).toBe(true);
    const attendanceSnapshot = stored.find(
      ({ value }) =>
        "attendance" in value && typeof value.attendance === "object" && value.attendance,
    );
    if (!attendanceSnapshot?.key) throw new Error("fixture did not persist attendance");
    const storedAttendance = attendanceSnapshot.value.attendance as Record<string, unknown>;
    storedAttendance.position = near;
    window.localStorage.setItem(attendanceSnapshot.key, JSON.stringify(attendanceSnapshot.value));

    const reloaded = createCalendarRepository(teen);
    const checkedIn = await candidateFor(reloaded, "sam");
    expect(checkedIn).toMatchObject({
      kind: "checkedIn",
      session: { startAt: ready.session.startAt },
    });
    if (!checkedIn || checkedIn.kind !== "checkedIn")
      throw new Error("fixture did not reload attendance");
    expect(checkedIn.attendance).not.toHaveProperty("position");
    await expect(
      reloaded.clockIn({ sessionId: ready.session.sessionId, studentId: "sam", position: near }),
    ).resolves.toEqual(record);
  });

  it("separates browser fixture attendance by role and student", async () => {
    vi.stubEnv("NEXT_PUBLIC_CALENDAR_SOURCE", "fixture");
    const teenRepository = createCalendarRepository(teen);
    const adultRepository = createCalendarRepository(adult);
    const teenReady = await candidateFor(teenRepository, "sam");
    const adultReady = await candidateFor(adultRepository, "alex");
    if (!teenReady || teenReady.kind !== "ready" || !adultReady || adultReady.kind !== "ready") {
      throw new Error("fixture did not provide ready sessions");
    }

    await teenRepository.clockIn({
      sessionId: teenReady.session.sessionId,
      studentId: "sam",
      position: near,
    });

    expect((await candidateFor(createCalendarRepository(teen), "sam"))?.kind).toBe("checkedIn");
    expect((await candidateFor(createCalendarRepository(adult), "alex"))?.kind).toBe("ready");
  });

  it("falls back safely when browser fixture storage is malformed or unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_CALENDAR_SOURCE", "fixture");
    const first = createCalendarRepository(teen);
    const ready = await candidateFor(first, "sam");
    if (!ready || ready.kind !== "ready")
      throw new Error("fixture did not provide a ready session");
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) window.localStorage.setItem(key, "{");
    }
    expect((await candidateFor(createCalendarRepository(teen), "sam"))?.kind).toBe("ready");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect((await candidateFor(createCalendarRepository(teen), "sam"))?.kind).toBe("ready");
  });

  it("refreshes an expired ready slot and discards its late-window self-attendance snapshot", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-15T09:00:00.000Z") });
    vi.stubEnv("NEXT_PUBLIC_CALENDAR_SOURCE", "fixture");
    const first = createCalendarRepository(teen);
    const ready = await candidateFor(first, "sam");
    if (!ready || ready.kind !== "ready")
      throw new Error("fixture did not provide a ready session");
    vi.advanceTimersByTime(49 * 60000);
    await first.clockIn({ sessionId: ready.session.sessionId, studentId: "sam", position: near });
    vi.advanceTimersByTime(2 * 60000);

    const refreshed = await candidateFor(createCalendarRepository(teen), "sam");
    expect(refreshed).toMatchObject({ kind: "ready" });
    if (!refreshed || refreshed.kind !== "ready")
      throw new Error("fixture did not refresh ready session");
    expect(refreshed.session.startAt).not.toBe(ready.session.startAt);
    const snapshots = Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index);
      return key ? JSON.parse(window.localStorage.getItem(key) ?? "null") : null;
    });
    expect(snapshots.some((snapshot) => snapshot?.attendance)).toBe(false);
  });
});
