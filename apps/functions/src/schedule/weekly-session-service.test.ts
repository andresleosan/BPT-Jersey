import { describe, expect, it } from "vitest";
import { parseCreateSessionInput, parseUpdateSessionInput } from "@bpt-jersey/domain/schedule";
import { createInMemoryScheduleStore } from "./schedule-service";

const seed = {
  programId: "adult-fundamentals",
  locationId: "town",
  instructorId: "coach-1",
  instructorIds: ["coach-1", "coach-2"],
  title: "Weekly training",
  startAt: "2026-10-19T17:00:00.000Z",
  endAt: "2026-10-19T18:00:00.000Z",
  capacity: 12,
  minParticipants: 2,
  repeatWeekly: true,
  bookingRules: { bookUntilMinutesBefore: 30, cancelUntil: "start" as const, advanceMinutes: 60 },
  waitingList: "on" as const,
};
const october = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-15T23:59:59.000Z" };

describe("weekly session repetition", () => {
  it("validates recurrence without accepting client-owned series identities", () => {
    const result = parseCreateSessionInput({ ...seed, weeklySeriesId: "other-academy" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repeatWeekly).toBe(true);
      expect(result.value).not.toHaveProperty("weeklySeriesId");
    }
    expect(parseCreateSessionInput({ ...seed, repeatWeekly: "true" }).ok).toBe(false);
    expect(
      parseUpdateSessionInput({ sessionId: "s", repeatWeekly: false, repeatScope: "following" }).ok,
    ).toBe(true);
    expect(parseUpdateSessionInput({ sessionId: "s", repeatWeekly: null }).ok).toBe(false);
    expect(parseUpdateSessionInput({ sessionId: "s", capacity: 10, repeatScope: "all" }).ok).toBe(
      false,
    );
  });
  it("repeats indefinitely at the same local hour across DST, preserving all settings without duplicating dates", async () => {
    const store = createInMemoryScheduleStore();
    const first = await store.createSession("a", seed, "owner");
    const sessions = await store.listSessions("a", october);
    expect(sessions).toHaveLength(4);
    expect(sessions[0]!.sessionId).toBe(first.sessionId);
    expect(sessions[1]!.startAt).toBe("2026-10-26T18:00:00.000Z");
    expect(sessions[1]!.endAt).toBe("2026-10-26T19:00:00.000Z");
    expect(sessions[1]).toMatchObject({
      instructorIds: seed.instructorIds,
      capacity: 12,
      minParticipants: 2,
      bookingRules: seed.bookingRules,
      waitingList: "on",
      repeatWeekly: true,
    });
    expect(await store.listSessions("a", october)).toEqual(sessions);
    const future = await store.listSessions("a", {
      from: "2036-06-01T00:00:00.000Z",
      to: "2036-06-30T23:59:59.000Z",
    });
    expect(future).toHaveLength(5);
    expect(future.every((row) => row.startAt.includes("T17:00:"))).toBe(true);
    expect(await store.listSessions("b", october)).toEqual([]);
  });
  it("can enable repetition on an existing session and leaves non-repeating sessions alone", async () => {
    const store = createInMemoryScheduleStore();
    const first = await store.createSession("a", { ...seed, repeatWeekly: false }, "owner");
    expect(await store.listSessions("a", october)).toHaveLength(1);
    await store.updateSession("a", { sessionId: first.sessionId, repeatWeekly: true }, "owner");
    expect(await store.listSessions("a", october)).toHaveLength(4);
  });
  it("edits just one occurrence without creating a second series", async () => {
    const store = createInMemoryScheduleStore();
    await store.createSession("a", seed, "owner");
    const original = await store.listSessions("a", october);
    const second = original[1]!;
    await store.updateSession(
      "a",
      {
        sessionId: second.sessionId,
        capacity: 7,
        startAt: "2026-10-26T18:30:00.000Z",
        endAt: "2026-10-26T19:30:00.000Z",
      },
      "owner",
    );
    const edited = await store.listSessions("a", october);
    expect(edited).toHaveLength(4);
    expect(edited[1]).toMatchObject({
      sessionId: second.sessionId,
      capacity: 7,
      weeklyOverride: true,
    });
    expect(edited[2]!.capacity).toBe(12);
    expect(edited[2]!.startAt).toBe(original[2]!.startAt);
  });
  it("updates this and following dates, preserving past dates, stable IDs, and individual exceptions", async () => {
    const store = createInMemoryScheduleStore();
    await store.createSession("a", seed, "owner");
    const original = await store.listSessions("a", october);
    await store.updateSession("a", { sessionId: original[2]!.sessionId, capacity: 9 }, "owner");
    await store.cancelSession("a", original[3]!.sessionId, "Holiday", "owner");
    await store.updateSession(
      "a",
      {
        sessionId: original[1]!.sessionId,
        repeatScope: "following",
        capacity: 20,
        startAt: "2026-10-26T19:00:00.000Z",
        endAt: "2026-10-26T20:00:00.000Z",
      },
      "owner",
    );
    const next = await store.listSessions("a", october);
    expect(next.map((row) => row.sessionId)).toEqual(original.map((row) => row.sessionId));
    expect(next[0]!.capacity).toBe(12);
    expect(next[1]!.capacity).toBe(20);
    expect(next[2]!.capacity).toBe(9);
    expect(next[3]!.status).toBe("cancelled");
    const later = await store.listSessions("a", {
      from: "2027-01-01T00:00:00.000Z",
      to: "2027-01-31T23:59:59.000Z",
    });
    expect(later.every((row) => row.capacity === 20 && row.startAt.includes("T19:00:"))).toBe(true);
  });
  it("stops future repetition while retaining this date and never revives cancelled occurrences", async () => {
    const store = createInMemoryScheduleStore();
    await store.createSession("a", seed, "owner");
    const original = await store.listSessions("a", october);
    await expect(
      store.updateSession("a", { sessionId: original[1]!.sessionId, repeatWeekly: false }, "owner"),
    ).rejects.toThrow("following");
    await store.updateSession(
      "a",
      { sessionId: original[1]!.sessionId, repeatWeekly: false, repeatScope: "following" },
      "owner",
    );
    const next = await store.listSessions("a", october);
    expect(next[1]).toMatchObject({ status: "scheduled", repeatWeekly: false });
    expect(next.slice(2).every((row) => row.status === "cancelled")).toBe(true);
    expect(
      await store.listSessions("a", {
        from: "2027-01-01T00:00:00.000Z",
        to: "2027-01-31T23:59:59.000Z",
      }),
    ).toEqual([]);
  });
});

it("edits and stops a series with more than 400 saved occurrences", async () => {
  const store = createInMemoryScheduleStore();
  const first = await store.createSession("large", seed, "owner");
  for (let offset = 0; offset < 600; offset += 12) {
    const start = Date.parse(seed.startAt) + offset * 7 * 86400000;
    await store.listSessions("large", {
      from: new Date(start).toISOString(),
      to: new Date(start + 83 * 86400000).toISOString(),
    });
  }
  const updated = await store.updateSession(
    "large",
    { sessionId: first.sessionId, capacity: 30, repeatScope: "following" },
    "owner",
  );
  expect(updated.capacity).toBe(30);
  const tailStart = Date.parse(seed.startAt) + 590 * 7 * 86400000;
  const query = {
    from: new Date(tailStart).toISOString(),
    to: new Date(tailStart + 7 * 86400000).toISOString(),
  };
  expect((await store.listSessions("large", query)).every((row) => row.capacity === 30)).toBe(true);
  await store.updateSession(
    "large",
    { sessionId: first.sessionId, repeatWeekly: false, repeatScope: "following" },
    "owner",
  );
  expect(
    (await store.listSessions("large", query)).every((row) => row.status === "cancelled"),
  ).toBe(true);
});

it.each(["completed", "cancelled"] as const)(
  "repeats a %s historical session without changing that date's status or cancelling future dates",
  async (status) => {
    const store = createInMemoryScheduleStore();
    const first = await store.createSession("history", { ...seed, repeatWeekly: false }, "owner");
    await store.__seedSessionId!(
      "history",
      {
        ...first,
        status,
        cancellationReason: status === "cancelled" ? "Historical removal" : null,
      },
      first.sessionId,
    );
    const result = await store.updateSession(
      "history",
      { sessionId: first.sessionId, repeatWeekly: true },
      "administrator",
      true,
    );
    expect(result.status).toBe(status);
    const rows = await store.listSessions("history", october);
    expect(rows[0]!.status).toBe(status);
    expect(
      rows.slice(1).every((row) => row.status === "scheduled" && row.cancellationReason === null),
    ).toBe(true);
    await store.updateSession(
      "history",
      { sessionId: first.sessionId, repeatScope: "following", capacity: 25 },
      "administrator",
      true,
    );
    expect((await store.getSession("history", first.sessionId))!.status).toBe(status);
    expect(
      (await store.listSessions("history", october))
        .slice(1)
        .every((row) => row.status === "scheduled" && row.capacity === 25),
    ).toBe(true);
  },
);
